// Windows launches, simulated on any platform (no cmd.exe is run):
// - a .cmd/.bat or bare command goes through cmd.exe with a line in which every argument survives cmd.exe's
//   caret pass and the C runtime's argument parser unchanged (a header with spaces, a profile path with a
//   space, quotes, & and trailing backslashes), with no shell option;
// - the one-click installer and user MCP servers use it, hide the console window and stop the whole tree;
// - MCP servers removed or changed in Settings are stopped;
// - an npm-installed Codex / Claude Code nested platform package is found, and a bare shell shim is never chosen.
// Usage: node tests/unit/agents/test-windows-launch.cjs
const assert = require('node:assert/strict');
// mcp.cjs takes spawn when it loads: record what it starts (and what stops it) while capture is on.
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const realSpawn = childProcess.spawn, spawned = [];
let capture = false;
childProcess.spawn = (command, args, options) => {
  if (!capture) return realSpawn(command, args, options);
  spawned.push({ command, args, options });
  const proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.stdin = new PassThrough(); proc.pid = 900 + spawned.length;
  proc.kill = () => spawned.push({ killed: proc.pid });
  return proc;
};
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchSpec, stopProcessTree } = require('../../../electron/system/windowsCommands.cjs');
const { createInstaller } = require('../../../electron/agents/external/install.cjs');
const { McpClient, createRegistry } = require('../../../electron/agents/mcp.cjs');
const { findExecutable, unwrapShim } = require('../../../electron/agents/localAgents.cjs');
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };

// What Windows does with `cmd.exe /d /s /c "<line>"`, for a line whose quotes are all escaped: /s drops the
// outer quotes, the caret pass makes each ^x a literal x, then the program's C runtime splits the line.
function caretPass(line) { let out = ''; for (let i = 0; i < line.length; i++) out += line[i] === '^' ? line[++i] ?? '' : line[i]; return out; }
function argvOf(line) {
  const args = []; let i = 0;
  while (i < line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (i >= line.length) break;
    let arg = '', quoted = false;
    for (; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\') { let n = 0; while (line[i] === '\\') { n++; i++; } if (line[i] === '"') { arg += '\\'.repeat(n >> 1); if (n % 2) { arg += '"'; continue; } i--; continue; } arg += '\\'.repeat(n); i--; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (!quoted && (ch === ' ' || ch === '\t')) break;
      arg += ch;
    }
    args.push(arg);
  }
  return args;
}
const windowsArgv = (spec) => { assert.deepEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']); const line = spec.args[3]; assert.ok(line.startsWith('"') && line.endsWith('"')); return argvOf(caretPass(line.slice(1, -1))); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-winlaunch-test-'));
  try {
    // ---- The command line itself.
    const shim = 'C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\claude.cmd';
    const tricky = ['mcp', 'add', '-H', 'Authorization: Bearer ab12cd34', 'say "hi" & exit', 'C:\\dir with space\\', '50%', 'a^b|c<d>e', ''];
    const spec = launchSpec(shim, tricky, { platform: 'win32', env: {} });
    check('a .cmd shim runs through cmd.exe with verbatim arguments, not a shell option', spec.command === 'cmd.exe' && spec.options.windowsVerbatimArguments === true && !('shell' in spec.options));
    check('every argument and the spaced shim path arrive unchanged', JSON.stringify(windowsArgv(spec)) === JSON.stringify([shim, ...tricky]));
    check('ComSpec is honoured', launchSpec('npx', [], { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } }).command === 'C:\\Windows\\System32\\cmd.exe');
    check('a bare command (npx) goes through cmd.exe too', JSON.stringify(windowsArgv(launchSpec('npx', ['-y', '@scope/server', '--root', 'C:\\My Files'], { platform: 'win32', env: {} }))) === JSON.stringify(['npx', '-y', '@scope/server', '--root', 'C:\\My Files']));
    check('an .exe starts directly', launchSpec('C:\\tools\\server.exe', ['x y'], { platform: 'win32', env: {} }).command === 'C:\\tools\\server.exe');
    check('other platforms are unchanged', launchSpec('npx', ['a b'], { platform: 'linux' }).command === 'npx');
    const killers = [];
    stopProcessTree({ pid: 4321, kill() { killers.push('kill'); } }, { platform: 'win32', spawnImpl: (file, args, options) => { killers.push([file, ...args, options.windowsHide]); return { on() {} }; } });
    check('stopping on Windows ends the whole process tree', JSON.stringify(killers) === JSON.stringify([['taskkill', '/pid', '4321', '/T', '/F', true]]));

    // ---- The one-click installer on Windows with an npm shim in a profile path with a space.
    const home = path.join(root, 'Jane Doe'), bin = path.join(home, 'AppData', 'Roaming', 'npm');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n');
    const runs = [];
    const installer = createInstaller({ home, env: { PATH: '' }, platform: 'win32', searchDirectories: () => [bin],
      execFileImpl: (command, args, options, callback) => { runs.push({ command, args, options }); callback(null, '', ''); } });
    await installer.install('claude', { url: 'http://127.0.0.1:39217/mcp', token: 'ab12cd34' }).catch(() => {}); // the fake CLI writes no config
    const add = runs.find((r) => windowsArgv(r).includes('add'));
    check('Connect passes the Authorization header as one argument and the shim path whole', add && JSON.stringify(windowsArgv(add)) === JSON.stringify([path.join(bin, 'claude.cmd'), 'mcp', 'add', '--transport', 'http', '-s', 'user', 'clipcraft', 'http://127.0.0.1:39217/mcp', '-H', 'Authorization: Bearer ab12cd34']));
    check('the installer never asks for a shell and hides the window', runs.every((r) => !r.options.shell && r.options.windowsHide === true && r.options.windowsVerbatimArguments === true));

    // ---- User MCP servers: Windows launch options, tree stop, and pruning of removed or changed servers.
    capture = true;
    const client = new McpClient({ name: 'files', command: 'npx', args: ['-y', 'server', 'C:\\My Files'] }, { platform: 'win32', timeoutMs: 50 });
    await client.start().catch(() => {}); // nobody answers the handshake: the start fails and the client stops
    capture = false;
    const launch = spawned[0];
    check('an npx MCP server on Windows is launched through cmd.exe with quoted arguments', launch.command === 'cmd.exe' && JSON.stringify(windowsArgv(launch)) === JSON.stringify(['npx', '-y', 'server', 'C:\\My Files']));
    check('it opens no console window and passes the line verbatim', launch.options.windowsHide === true && launch.options.windowsVerbatimArguments === true && !launch.options.shell);
    check('stopping it ends the whole tree', spawned.some((r) => r.command === 'taskkill' && r.args.join(' ') === `/pid ${900 + 1} /T /F`));
    let servers = [{ name: 'A', command: 'a', args: [] }, { name: 'B', command: 'b', args: ['1'] }];
    const stopped = [], list = McpClient.prototype.listTools, stop = McpClient.prototype.stop;
    McpClient.prototype.listTools = async function () { return [{ name: 't', description: '', inputSchema: {} }]; };
    McpClient.prototype.stop = function () { stopped.push(this.server.name + ':' + this.server.args.join(',')); };
    try {
      const registry = createRegistry(() => servers);
      await registry.declarations();
      servers = [{ name: 'B', command: 'b', args: ['2'] }];
      registry.prune();
      check('a removed server and the old version of an edited one are stopped', stopped.sort().join(' ') === 'A: B:1');
      await registry.declarations();
      registry.stopAll();
      check('quitting stops the current servers', stopped.includes('B:2'));
    } finally { McpClient.prototype.listTools = list; McpClient.prototype.stop = stop; }

    // ---- npm-installed Codex and Claude Code on Windows (nested platform packages), no bare shell shims.
    const npm = path.join(root, 'npm'), w = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    w(path.join(npm, 'codex.cmd'), '@ECHO off\r\n'); w(path.join(npm, 'codex'), '#!/bin/sh\n');
    const codexPkg = path.join(npm, 'node_modules', '@openai', 'codex');
    w(path.join(codexPkg, 'package.json'), '{"name":"@openai/codex"}');
    const nested = path.join(codexPkg, 'node_modules', '@openai', 'codex-win32-x64');
    w(path.join(nested, 'package.json'), '{"name":"@openai/codex-win32-x64"}');
    const codexExe = path.join(nested, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'); w(codexExe, 'MZ');
    const empty = path.join(root, 'emptyhome'); fs.mkdirSync(empty);
    check('an npm Codex with a nested platform package resolves to codex.exe', fs.realpathSync(findExecutable('codex-sdk', '', { env: { PATH: npm }, home: empty, platform: 'win32', arch: 'x64', runtimeRoot: null })) === fs.realpathSync(codexExe));
    w(path.join(npm, 'claude.cmd'), '@ECHO off\r\n'); w(path.join(npm, 'claude'), '#!/bin/sh\n');
    const claudeExe = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe'); w(claudeExe, 'MZ');
    check('an npm Claude Code with a nested platform package resolves to claude.exe', fs.realpathSync(unwrapShim(path.join(npm, 'claude.cmd'), 'claude-agent-sdk', 'win32', 'x64')) === fs.realpathSync(claudeExe));
    const shOnly = path.join(root, 'shonly'); w(path.join(shOnly, 'codex'), '#!/bin/sh\n');
    assert.throws(() => findExecutable('codex-sdk', '', { env: { PATH: shOnly }, home: empty, platform: 'win32', arch: 'x64', runtimeRoot: null }), /could not find/);
    assert.throws(() => findExecutable('codex-sdk', path.join(shOnly, 'codex'), { env: { PATH: '' }, home: empty, platform: 'win32', arch: 'x64', runtimeRoot: null }), /shell script/);
    check('a bare POSIX shell shim is never selected on Windows', true);
    console.log(`windows launch OK: ${checks.length} checks`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
