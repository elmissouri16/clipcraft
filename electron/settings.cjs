// App settings stored in <userData>/settings.json.
// API keys are encrypted with Electron safeStorage (Windows DPAPI: only this Windows user on this PC can
// decrypt them). They are never written in plain text, never logged and never sent to the renderer;
// the UI only gets a short hint (last 4 characters).
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { app, safeStorage } = require('electron');

const PROVIDERS = ['gemini', 'groq', 'ollama', 'openai', 'openrouter', 'claude', 'custom', 'codex-sdk', 'claude-agent-sdk'];
const DEFAULT_MODELS = {
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  ollama: 'qwen2.5:7b',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  claude: 'claude-haiku-5-5',
  custom: '',
  'codex-sdk': '',
  'claude-agent-sdk': '',
};

function settingsFile() {
  // UI tests must never touch the real settings.
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'settings-test') : app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function write(data) {
  const file = settingsFile();
  const tmp = `${file}.${randomUUID()}.part`;
  let fd;
  let owned = false;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    owned = true;
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Same-directory rename leaves the previous settings intact until the new
    // encrypted payload is complete. The on-disk JSON format stays unchanged.
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (owned) { try { fs.unlinkSync(tmp); } catch {} }
  }
}

// What the renderer may see.
function getPublic() {
  const ai = read().ai || {};
  const keys = {};
  for (const p of PROVIDERS) if (ai.keys && ai.keys[p]) keys[p] = ai.keys[p].hint;
  return {
    provider: PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini',
    models: { ...DEFAULT_MODELS, ...(ai.models || {}) },
    baseUrls: ai.baseUrls || {},
    executablePaths: ai.executablePaths || {},
    reasoningEfforts: ai.reasoningEfforts || {},
    keys, // provider -> "…abcd" for providers that have a saved key
    defaultModels: DEFAULT_MODELS,
    encryption: safeStorage.isEncryptionAvailable(),
    serviceKeys: Object.fromEntries(SERVICES.filter((n) => read().services?.[n]).map((n) => [n, read().services[n].hint])),
    mcpServers: getMcpServers(),
  };
}

// ---- MCP servers (external tool servers the agent may call) ----
// Stored as plain config (name + command + args): no secrets live here.
function getMcpServers() {
  const list = read().mcpServers;
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.name === 'string' && typeof s.command === 'string' && s.command.trim())
    .map((s) => ({ name: s.name, command: s.command, args: Array.isArray(s.args) ? s.args.map(String) : [] }));
}

function setMcpServers(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((s) => s && String(s.name || '').trim() && String(s.command || '').trim())
    .map((s) => ({ name: String(s.name).trim(), command: String(s.command).trim(), args: Array.isArray(s.args) ? s.args.map(String) : [] }));
  const data = read();
  data.mcpServers = clean;
  write(data);
  return getPublic();
}

// ---- Keys of other services (stock media). Same encryption, same rules as the AI keys. ----
const SERVICES = ['pixabay', 'soundza', 'elevenlabs', 'cap-groq', 'cap-openai', 'cap-deepgram', 'cap-elevenlabs'];

function getServiceKey(name) {
  const entry = read().services?.[name];
  if (!SERVICES.includes(name) || !entry || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
  } catch {
    return '';
  }
}

function saveServiceKey(name, key) {
  if (!SERVICES.includes(name)) throw new Error('Unknown service');
  const k = String(key || '').trim();
  if (!k) throw new Error('Paste a key first.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this PC, so the key was not saved.');
  const data = read();
  data.services = { ...(data.services || {}), [name]: { enc: safeStorage.encryptString(k).toString('base64'), hint: `…${k.slice(-4)}` } };
  write(data);
  return getPublic();
}

function clearServiceKey(name) {
  const data = read();
  if (data.services) delete data.services[name];
  write(data);
  return getPublic();
}

// Active configuration for the main process, including the decrypted key.
function getActive(providerOverride) {
  const ai = read().ai || {};
  const provider = providerOverride || (PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini');
  const model = (ai.models && ai.models[provider]) || DEFAULT_MODELS[provider];
  const effort = ai.reasoningEfforts?.[provider]?.[model];
  let apiKey = '';
  const entry = ai.keys && ai.keys[provider];
  if (entry && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    } catch {
      apiKey = ''; // saved under another Windows account or corrupted: treat as not set
    }
  }
  return {
    provider,
    model,
    baseUrl: (ai.baseUrls && ai.baseUrls[provider]) || '',
    apiKey,
    executablePath: (ai.executablePaths && ai.executablePaths[provider]) || '',
    reasoningEffort: typeof effort === 'string' ? effort : '',
    reasoningEfforts: ai.reasoningEfforts?.[provider] || {},
  };
}

// patch: { provider, model, baseUrl, apiKey } (apiKey optional: omitted keeps the saved key).
function save(patch) {
  const data = read();
  const ai = data.ai || {};
  const provider = PROVIDERS.includes(patch.provider) ? patch.provider : ai.provider || 'gemini';
  ai.provider = provider;
  ai.models = { ...(ai.models || {}), [provider]: (patch.model || '').trim() || DEFAULT_MODELS[provider] };
  ai.baseUrls = { ...(ai.baseUrls || {}), [provider]: (patch.baseUrl || '').trim().replace(/\/+$/, '') };
  if (['codex-sdk', 'claude-agent-sdk'].includes(provider) && patch.executablePath !== undefined) {
    ai.executablePaths = { ...(ai.executablePaths || {}), [provider]: String(patch.executablePath || '').trim() };
  }
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this PC, so the key was not saved.');
    }
    const key = patch.apiKey.trim();
    ai.keys = {
      ...(ai.keys || {}),
      [provider]: { enc: safeStorage.encryptString(key).toString('base64'), hint: `…${key.slice(-4)}` },
    };
  }
  data.ai = ai;
  write(data);
  return getPublic();
}

function clearKey(provider) {
  const data = read();
  if (data.ai && data.ai.keys) delete data.ai.keys[provider];
  write(data);
  return getPublic();
}

// Quick model changes from CraftAI must not rewrite provider credentials,
// endpoints, executable paths, or other preferences from a stale UI snapshot.
function setModel(provider, model) {
  if (!PROVIDERS.includes(provider) || typeof model !== 'string') throw new Error('Invalid AI model selection.');
  const data = read();
  const ai = data.ai || {};
  const active = PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini';
  if (active !== provider) throw new Error('The AI provider changed. Reopen the model picker and try again.');
  ai.models = { ...(ai.models || {}), [provider]: model.trim() || DEFAULT_MODELS[provider] };
  data.ai = ai;
  write(data);
  return getPublic();
}

function setReasoningEffort(provider, model, effort, allowedLevels) {
  const levels = allowedLevels || require('./thinking.cjs').SDK_LEVELS[provider] || [];
  if (!PROVIDERS.includes(provider) || typeof model !== 'string' || typeof effort !== 'string' || (effort && (!model || !levels.includes(effort)))) throw new Error('Invalid thinking effort.');
  const data = read();
  const ai = data.ai || {};
  if (ai.provider !== provider || (ai.models?.[provider] || DEFAULT_MODELS[provider]) !== model) throw new Error('The AI provider or model changed. Reopen the picker and try again.');
  ai.reasoningEfforts = { ...(ai.reasoningEfforts || {}),
    [provider]: { ...(ai.reasoningEfforts?.[provider] || {}), [model]: effort },
  };
  data.ai = ai;
  write(data);
  return getPublic();
}

// Playback quality (which scaled copy the player uses; the export always reads the originals).
// Stored as `quality`; the old boolean `proxy` is migrated (on -> 'medium', off -> 'full') and
// kept in sync for anything that still reads it. See quality.cjs.
const { qualityFromStored, isQuality } = require('./quality.cjs');
const getQuality = () => qualityFromStored(read());
function setQuality(q) {
  const data = read();
  data.quality = isQuality(q) ? q : 'full';
  data.proxy = data.quality !== 'full';
  write(data);
  return data.quality;
}
const getProxy = () => getQuality() !== 'full';
function setProxy(on) {
  return setQuality(on === true ? 'medium' : 'full') !== 'full';
}

// Performance mode (perf program, 2026-11-01): a bundle of resource knobs — the
// playback-quality default, how many background media jobs run at once, and whether
// exports yield CPU to the rest of the PC. It never touches export quality settings.
const PERF_MODES = ['low-end', 'balanced', 'high-performance'];
const getPerfMode = () => { const m = read().perfMode; return PERF_MODES.includes(m) ? m : 'balanced'; };
function setPerfMode(m) {
  const data = read();
  data.perfMode = PERF_MODES.includes(m) ? m : 'balanced';
  write(data);
  return data.perfMode;
}

// ---- First-run experience: the welcome card shows exactly once. Its seen-flag
// lives here, alongside the other settings. ----
const FIRST_RUN_KEYS = ['tourSeen'];
const getFirstRun = () => {
  const f = read().firstRun || {};
  return Object.fromEntries(FIRST_RUN_KEYS.map((k) => [k, f[k] === true]));
};
function setFirstRun(patch) {
  const data = read();
  const cur = { ...(data.firstRun || {}) };
  for (const k of FIRST_RUN_KEYS) if (typeof patch?.[k] === 'boolean') cur[k] = patch[k];
  data.firstRun = cur;
  write(data);
  return getFirstRun();
}

module.exports = { getProxy, setProxy, getQuality, setQuality, getPerfMode, setPerfMode, PERF_MODES, getPublic, getActive, save, setModel, setReasoningEffort, clearKey, getServiceKey, saveServiceKey, clearServiceKey, getMcpServers, setMcpServers, getFirstRun, setFirstRun, PROVIDERS, DEFAULT_MODELS };
