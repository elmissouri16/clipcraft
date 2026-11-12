// App settings stored in <userData>/settings.json.
// API keys are encrypted with Electron safeStorage (Windows DPAPI: only this Windows user on this PC can
// decrypt them). They are never written in plain text, never logged and never sent to the renderer;
// the UI only gets a short hint (last 4 characters).
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { app, safeStorage } = require('electron');

// The provider list and each one's default model come from the preset table (shared/providers.json).
const providerPresets = require('../agents/providers.cjs');
const PROVIDERS = providerPresets.ids();
const DEFAULT_MODELS = providerPresets.defaultModels();

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

// Native agents' own web search ("web research"): Codex had it from the start, Claude starts without.
const WEB_RESEARCH_DEFAULTS = require('../agents/research.cjs').DEFAULTS;
const webResearchOf = (ai, provider) => provider in WEB_RESEARCH_DEFAULTS
  ? (typeof ai.webResearch?.[provider] === 'boolean' ? ai.webResearch[provider] : WEB_RESEARCH_DEFAULTS[provider]) : false;

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
    webResearch: Object.fromEntries(Object.keys(WEB_RESEARCH_DEFAULTS).map((p) => [p, webResearchOf(ai, p)])),
    keys, // provider -> "…abcd" for providers that have a saved key
    defaultModels: DEFAULT_MODELS,
    encryption: safeStorage.isEncryptionAvailable(),
    serviceKeys: Object.fromEntries(SERVICES.filter((n) => read().services?.[n]).map((n) => [n, read().services[n].hint])),
    mcpServers: getMcpServers(),
    externalAgents: getExternalAgents(),
    voiceDefault: getVoiceDefault(),
    voiceStudio: getVoiceStudio(),
    shortcuts: getShortcuts(),
    language: getLanguagePreference(),
  };
}

// UI language: 'system' (follow the OS), 'en', 'fr' or 'es' (electron/system/i18n.cjs). Applies after a restart.
const { LANGUAGE_IDS, t } = require('./i18n.cjs');
function getLanguagePreference() { const v = read().language; return LANGUAGE_IDS.includes(v) ? v : 'system'; }
function setLanguagePreference(value) {
  if (!LANGUAGE_IDS.includes(value)) throw new Error(t('main.unknown_language'));
  const data = read(); data.language = value; write(data);
  return getPublic();
}

// ---- Keyboard shortcuts: only the user's changes from the defaults ----
// { actionId: ["Ctrl+B", "S"] }; the renderer owns the action list and defaults.
const COMBO = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([^+\s]+|\+)$/;
function cleanShortcuts(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, combos] of Object.entries(value).slice(0, 100)) {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(id) || !Array.isArray(combos)) continue;
    out[id] = [...new Set(combos.filter((c) => typeof c === 'string' && c.length <= 40 && COMBO.test(c)))].slice(0, 4);
  }
  return out;
}
const getShortcuts = () => cleanShortcuts(read().shortcuts);
function setShortcuts(value) {
  const data = read();
  data.shortcuts = cleanShortcuts(value);
  write(data);
  return getPublic();
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

// ---- Default voice (Settings > Voice): the speech engine and voice used when none is named, by CraftAI and
// as Text to speech's starting choice. 'auto' keeps the built-in order (Gemini, then VoiceStudio, then ElevenLabs).
const VOICE_ENGINES = ['auto', 'gemini', 'voicestudio', 'eleven'];
function getVoiceDefault() {
  const v = read().voiceDefault || {};
  return { engine: VOICE_ENGINES.includes(v.engine) ? v.engine : 'auto', voice: typeof v.voice === 'string' ? v.voice.trim().slice(0, 100) : '' };
}
function setVoiceDefault(value) {
  const data = read();
  data.voiceDefault = { engine: VOICE_ENGINES.includes(value?.engine) ? value.engine : 'auto', voice: typeof value?.voice === 'string' ? value.voice.trim().slice(0, 100) : '' };
  write(data);
  return getPublic();
}

// ---- VoiceStudio connector (Settings > Voice): off by default. When on, ClipCraft speaks through the VoiceStudio
// app running on this computer at `url` (empty: its default address, electron/audio/tts.cjs).
function getVoiceStudio() {
  const v = read().voiceStudio || {};
  return { enabled: v.enabled === true, url: typeof v.url === 'string' ? v.url.trim().slice(0, 200) : '' };
}
function setVoiceStudio(patch) {
  const data = read(), current = getVoiceStudio();
  data.voiceStudio = { enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : current.enabled,
    url: typeof patch?.url === 'string' ? patch.url.trim().slice(0, 200) : current.url };
  write(data);
  return getPublic();
}

// ---- External agents (docs/design/external-agent-mcp.md): off by default; the MCP port; the agents
// (by the name their MCP client reports) the user allowed to edit once. The token outside agents
// send lives here too, created once, and never goes to the renderer (getPublic).
const EXTERNAL_PORT = 39217;
const cleanNames = (list) => [...new Set((Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 60)))].slice(0, 20);
function getExternalAgents() {
  const value = read().externalAgents || {};
  const port = Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 ? value.port : EXTERNAL_PORT;
  return { enabled: value.enabled === true, approved: cleanNames(value.approved), port };
}
function setExternalAgents(patch) {
  const data = read(), current = data.externalAgents || {};
  data.externalAgents = { ...current,
    enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : current.enabled === true,
    approved: cleanNames(Array.isArray(patch?.approved) ? patch.approved : current.approved) };
  write(data);
  return getPublic();
}
function externalToken() {
  const data = read(), current = data.externalAgents || {};
  if (typeof current.token === 'string' && /^[0-9a-f]{64}$/.test(current.token)) return current.token;
  data.externalAgents = { ...current, token: require('node:crypto').randomBytes(32).toString('hex') };
  write(data);
  return data.externalAgents.token;
}

// ---- Keys of other services (stock media). Same encryption, same rules as the AI keys. ----
const SERVICES = ['pixabay', 'soundza', 'elevenlabs', 'gemini-tts', 'cap-groq', 'cap-openai', 'cap-deepgram', 'cap-elevenlabs'];

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
  if (!SERVICES.includes(name)) throw new Error(t('main.unknown_service'));
  const k = String(key || '').trim();
  if (!k) throw new Error(t('main.paste_a_key_first'));
  if (!safeStorage.isEncryptionAvailable()) throw new Error(t('main.secure_storage_not_available'));
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

// Manage credentials without changing the selected assistant, its model or endpoint.
function saveProviderKey(provider, value) {
  if (!providerPresets.keyed().includes(provider)) throw new Error(t('main.provider_does_not_use_api_key'));
  const key = String(value || '').trim();
  if (!key) throw new Error(t('main.paste_a_key_first'));
  if (!safeStorage.isEncryptionAvailable()) throw new Error(t('main.secure_storage_not_available'));
  const data = read();
  data.ai = { ...(data.ai || {}), keys: { ...(data.ai?.keys || {}), [provider]: { enc: safeStorage.encryptString(key).toString('base64'), hint: `…${key.slice(-4)}` } } };
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
    webResearch: webResearchOf(ai, provider),
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
  if (provider in WEB_RESEARCH_DEFAULTS && typeof patch.webResearch === 'boolean') ai.webResearch = { ...(ai.webResearch || {}), [provider]: patch.webResearch };
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(t('main.secure_storage_not_available'));
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
  if (!PROVIDERS.includes(provider) || typeof model !== 'string') throw new Error(t('main.invalid_ai_model_selection'));
  const data = read();
  const ai = data.ai || {};
  const active = PROVIDERS.includes(ai.provider) ? ai.provider : 'gemini';
  if (active !== provider) throw new Error(t('main.ai_provider_changed'));
  ai.models = { ...(ai.models || {}), [provider]: model.trim() || DEFAULT_MODELS[provider] };
  data.ai = ai;
  write(data);
  return getPublic();
}

function setReasoningEffort(provider, model, effort, allowedLevels) {
  const levels = allowedLevels || require("../agents/thinking.cjs").SDK_LEVELS[provider] || [];
  if (!PROVIDERS.includes(provider) || typeof model !== 'string' || typeof effort !== 'string' || (effort && (!model || !levels.includes(effort)))) throw new Error(t('main.invalid_thinking_effort'));
  const data = read();
  const ai = data.ai || {};
  if (ai.provider !== provider || (ai.models?.[provider] || DEFAULT_MODELS[provider]) !== model) throw new Error(t('main.ai_provider_or_model_changed'));
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
const { qualityFromStored, isQuality } = require("../media/quality.cjs");
const getQuality = () => qualityFromStored(read());
function setQuality(q) {
  const data = read();
  data.quality = isQuality(q) ? q : 'full';
  data.proxy = data.quality !== 'full';
  write(data);
  return data.quality;
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
// Window placement, restored on the next launch (normal bounds + maximized flag).
function getWindowState() {
  const w = read().window;
  if (!w || typeof w !== 'object') return null;
  const n = v => Number.isFinite(v) ? Math.round(v) : null;
  const b = { x: n(w.x), y: n(w.y), width: n(w.width), height: n(w.height) };
  if (!(b.width >= 640 && b.height >= 480)) return null;
  return { ...b, maximized: !!w.maximized, fullScreen: !!w.fullScreen };
}
function setWindowState(state) {
  const data = read();
  data.window = state;
  write(data);
}
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

module.exports = { getLanguagePreference, setLanguagePreference, getWindowState, setWindowState, getShortcuts, setShortcuts, getQuality, setQuality, getPerfMode, setPerfMode, PERF_MODES, getPublic, getActive, save, setModel, setReasoningEffort, clearKey, saveProviderKey, getServiceKey, saveServiceKey, clearServiceKey, getMcpServers, setMcpServers, getExternalAgents, setExternalAgents, externalToken, getVoiceDefault, setVoiceDefault, getVoiceStudio, setVoiceStudio, getFirstRun, setFirstRun, PROVIDERS, DEFAULT_MODELS };
