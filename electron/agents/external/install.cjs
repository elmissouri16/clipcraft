// One-click setup of ClipCraft's MCP server in the agents installed on this computer
// (docs/design/external-agent-mcp.md): Claude Code, Codex and OpenCode. Each gets the URL and the
// token in its own user-level config, through its own CLI where the CLI can do it:
// - Claude Code: `claude mcp add --transport http -s user` (~/.claude.json or $CLAUDE_CONFIG_DIR).
// - Codex: a [mcp_servers.clipcraft] table in config.toml ($CODEX_HOME or ~/.codex); its CLI cannot
//   set a literal header.
// - OpenCode: `opencode mcp add --global`; it has no remove command, so removal edits its JSON.
// No Electron imports: tests run it against temporary homes (tests/unit/agents/test-external-install.cjs).
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const NAME = 'clipcraft';
const AGENTS = [
  { id: 'claude', name: 'Claude Code', cli: 'claude' },
  { id: 'codex', name: 'Codex', cli: 'codex' },
  { id: 'opencode', name: 'OpenCode', cli: 'opencode', dirs: (home) => [path.join(home, '.opencode', 'bin')] },
];

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const readJson = (file) => { const text = readText(file); if (text === null) return {}; return JSON.parse(text); };
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch { /* new file */ }
  const tmp = `${file}.clipcraft-${process.pid}.part`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

// Codex config.toml: the [mcp_servers.clipcraft] table and its sub-tables, found by their headers.
const CODEX_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:clipcraft|"clipcraft")\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
function codexSection(text) {
  const lines = String(text || '').split('\n'), kept = [], section = [];
  let inside = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) inside = CODEX_HEADER.test(line);
    (inside ? section : kept).push(line);
  }
  return { rest: kept.join('\n'), section: section.join('\n') };
}
const codexBlock = (url, token) => `[mcp_servers.${NAME}]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }\ntool_timeout_sec = 900\n`;

// opts: { home, env, searchDirectories(env, home) -> dirs, platform }
function createInstaller({ home, env = process.env, searchDirectories, platform = process.platform }) {
  const files = {
    claude: path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
    codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
    opencode: path.join(home, '.config', 'opencode', 'opencode.json'),
  };
  const childEnv = () => ({ ...env, HOME: home, PATH: searchDirectories(env, home).join(platform === 'win32' ? ';' : ':') });

  function find(agent) {
    const names = platform === 'win32' ? [`${agent.cli}.exe`, `${agent.cli}.cmd`] : [agent.cli];
    for (const dir of [...searchDirectories(env, home), ...(agent.dirs?.(home) || [])]) {
      for (const name of names) {
        const file = path.join(dir, name);
        try { if (fs.statSync(file).isFile()) { if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK); return file; } } catch { /* keep looking */ }
      }
    }
    return null;
  }
  // Arguments are ClipCraft's own (a fixed name, a local URL, a hex token): safe for a .cmd shim's shell.
  const run = (file, args) => new Promise((resolve, reject) => {
    fs.mkdirSync(home, { recursive: true }); // the working folder (a missing cwd also reads as ENOENT)
    execFile(file, args, { cwd: home, env: childEnv(), timeout: 60000, windowsHide: true, shell: platform === 'win32' && /\.(cmd|bat)$/i.test(file) },
      (error, stdout, stderr) => error ? reject(new Error(String(stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ').slice(0, 400))) : resolve(stdout));
  });

  // What the agent has for ClipCraft now: { url, authorization } or null.
  function configured(id) {
    if (id === 'claude') { const entry = readJson(files.claude).mcpServers?.[NAME]; return entry ? { url: entry.url, authorization: entry.headers?.Authorization } : null; }
    if (id === 'codex') {
      const { section } = codexSection(readText(files.codex));
      if (!section.trim()) return null;
      return { url: /^\s*url\s*=\s*"([^"]*)"/m.exec(section)?.[1], authorization: /Authorization"?\s*=\s*"([^"]*)"/.exec(section)?.[1] };
    }
    const mcp = readJson(files.opencode).mcp || {}, entry = mcp.servers?.[NAME] || mcp[NAME];
    return entry ? { url: entry.url, authorization: entry.headers?.Authorization } : null;
  }

  async function list({ url, token }) {
    return AGENTS.map((agent) => {
      const executable = find(agent);
      let entry = null, error = null;
      try { entry = configured(agent.id); } catch (e) { error = `Could not read ${files[agent.id]}: ${e.message}`; }
      return { id: agent.id, name: agent.name, found: !!executable, configFile: files[agent.id], installed: !!entry,
        current: !!entry && entry.url === url && entry.authorization === `Bearer ${token}`, ...(error ? { error } : {}) };
    });
  }

  async function remove(id) {
    const agent = AGENTS.find((a) => a.id === id);
    if (!agent) throw new Error('Unknown agent.');
    if (id === 'claude') {
      if (!configured('claude')) return;
      const exe = find(agent);
      if (!exe) throw new Error('Claude Code was not found on this computer.');
      await run(exe, ['mcp', 'remove', '-s', 'user', NAME]);
    } else if (id === 'codex') {
      const text = readText(files.codex);
      if (text === null) return;
      const { rest, section } = codexSection(text);
      if (section.trim()) writeText(files.codex, `${rest.replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`);
    } else {
      if (readText(files.opencode) === null) return;
      const config = readJson(files.opencode);
      let changed = false;
      if (config.mcp?.servers?.[NAME]) { delete config.mcp.servers[NAME]; changed = true; }
      if (config.mcp?.[NAME]) { delete config.mcp[NAME]; changed = true; }
      if (changed) writeText(files.opencode, `${JSON.stringify(config, null, 2)}\n`);
    }
  }

  async function install(id, { url, token }) {
    const agent = AGENTS.find((a) => a.id === id);
    if (!agent) throw new Error('Unknown agent.');
    const exe = find(agent);
    if (!exe) throw new Error(`${agent.name} was not found on this computer.`);
    await remove(id);
    if (id === 'claude') await run(exe, ['mcp', 'add', '--transport', 'http', '-s', 'user', NAME, url, '-H', `Authorization: Bearer ${token}`]);
    else if (id === 'codex') {
      const { rest } = codexSection(readText(files.codex) || '');
      writeText(files.codex, `${rest.replace(/\s*$/, '')}${rest.trim() ? '\n\n' : ''}${codexBlock(url, token)}`);
    } else await run(exe, ['mcp', 'add', '--global', '--url', url, '--header', `Authorization=Bearer ${token}`, NAME]);
    const entry = configured(id);
    if (!entry || entry.url !== url || entry.authorization !== `Bearer ${token}`) throw new Error(`${agent.name} did not save the ClipCraft server in ${files[id]}.`);
  }

  return { list, install, remove, files };
}

module.exports = { createInstaller, codexSection, AGENTS, NAME };
