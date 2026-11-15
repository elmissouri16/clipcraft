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
const providerIds = () => providerPresets.ids();
const defaultModels = () => providerPresets.defaultModels();

function settingsFile() {
  // UI tests must never touch the real settings.
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'settings-test') : app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.json');
}

// Getters are called often (several per preview request); the file is read again only when it
// changed on disk. Each read still parses its own object: callers edit what they get.
let cached = null; // { file, mtimeMs, size, text }
function read() {
  try {
    const file = settingsFile(), st = fs.statSync(file);
    if (!cached || cached.file !== file || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
      cached = { file, mtimeMs: st.mtimeMs, size: st.size, text: fs.readFileSync(file, 'utf8') };
    }
    return JSON.parse(cached.text);
  } catch {
    cached = null;
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

// ---- Keychain policy ----
// safeStorage reaches the operating system's keychain: macOS asks the user to allow each new app
// binary, and a slow keychain stalls whoever calls it. So nothing here touches it at launch unless
// the settings hold an encrypted key. Those keys are decrypted once, off the main thread
// (warmKeys, called by main after start-up), into a small in-memory cache that the synchronous
// getters read; the blocking calls remain only as the fallback for a key needed before that
// finished, and for the moment the user saves a key.
let encryptionRefused = false; // the last probe said no (a refused prompt, no secret service): shown in Settings
const decrypted = new Map(); // ciphertext (base64) -> the key
const asyncKeychain = () => typeof safeStorage.isAsyncEncryptionAvailable === 'function' && typeof safeStorage.decryptStringAsync === 'function';
// Asked only when a key is saved or must be read outside the cache; never cached, so a refused
// prompt is asked again the next time the user needs a key.
function encryptionAvailable() {
  const ok = safeStorage.isEncryptionAvailable();
  encryptionRefused = !ok;
  return ok;
}
// The key behind a stored entry, from the cache or (blocking) from the keychain; '' when it cannot be
// read (saved under another account, or the keychain refused).
function decryptEntry(entry) {
  if (!entry?.enc) return '';
  if (decrypted.has(entry.enc)) return decrypted.get(entry.enc);
  if (!encryptionAvailable()) return '';
  try {
    const key = safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    decrypted.set(entry.enc, key);
    return key;
  } catch { return ''; }
}
const encryptEntry = (key) => {
  const enc = safeStorage.encryptString(key).toString('base64');
  decrypted.set(enc, key);
  return { enc, hint: `…${key.slice(-4)}` };
};
const storedEntries = (data) => [...Object.values(data.ai?.keys || {}), ...Object.values(data.services || {})].filter((e) => e?.enc);
let warming = null;
// Decrypts every stored key in the background so the first agent request finds them ready.
// Without stored keys it returns at once and the keychain is left alone.
function warmKeys() {
  if (warming) return warming;
  const entries = storedEntries(read());
  if (!entries.length || !asyncKeychain()) return (warming = Promise.resolve());
  warming = (async () => {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return;
      for (const { enc } of entries) {
        if (decrypted.has(enc)) continue;
        try {
          const value = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'));
          const key = typeof value === 'string' ? value : value?.result; // Electron 45 returns { result, shouldReEncrypt }
          if (typeof key === 'string') decrypted.set(enc, key);
        } catch { /* unreadable: the getter reports it as unset */ }
      }
    } catch { /* the keychain is unavailable right now: the getters ask again when a key is needed */ }
  })();
  return warming;
}

// Native agents' own web search ("web research"): Codex had it from the start, Claude starts without.
const WEB_RESEARCH_DEFAULTS = require('../agents/research.cjs').DEFAULTS;
const webResearchOf = (ai, provider) => provider in WEB_RESEARCH_DEFAULTS
  ? (typeof ai.webResearch?.[provider] === 'boolean' ? ai.webResearch[provider] : WEB_RESEARCH_DEFAULTS[provider]) : false;
const subagentsOf = (ai, provider) => provider in WEB_RESEARCH_DEFAULTS && ai.subagents?.[provider] === true;
const SUBAGENT_LIMITS = require('../../shared/subagentLimits.json');
const subagentConcurrencyOf = (ai, provider) => Number.isInteger(ai.subagentConcurrency?.[provider]) && ai.subagentConcurrency[provider] >= 1 && ai.subagentConcurrency[provider] <= SUBAGENT_LIMITS.maxConcurrent
  ? ai.subagentConcurrency[provider] : SUBAGENT_LIMITS.concurrent;

// What the renderer may see.
function pluginProviderApproved(provider){return read().ai?.pluginProviderConsents?.[provider]===true;}
function approvePluginProvider(provider){
 const row=providerPresets.byId(provider);if(!row?.plugin)throw Error('Plugin provider is unavailable.');
 const data=read();data.ai={...(data.ai||{}),pluginProviderConsents:{...(data.ai?.pluginProviderConsents||{}),[provider]:true},pluginProviderLabels:{...(data.ai?.pluginProviderLabels||{}),[provider]:row.name}};write(data);
}
function assertPluginProvider(provider,model,baseUrl){
 if(!providerPresets.isPlugin(provider))return;
 const row=providerPresets.byId(provider);
 if(!row?.plugin)throw Error('This plugin provider is unavailable. Enable its exact installed version in Settings.');
 if(!pluginProviderApproved(provider))throw Error('Approve this plugin provider in Settings before using it.');
 if(model&&!row.models.some(m=>m.id===model))throw Error('Choose a model declared by this plugin provider.');
 if(baseUrl&&baseUrl!==row.baseUrl)throw Error('Plugin provider endpoints cannot be overridden.');
}
function pluginProviderPublic(ai){
 const rows=providerPresets.all().filter(p=>p.plugin).map(p=>({...p,approved:ai.pluginProviderConsents?.[p.id]===true}));
 const missing=new Set([ai.provider,...Object.keys(ai.keys||{})].filter(id=>providerPresets.isPlugin(id)&&!rows.some(p=>p.id===id)));
 for(const id of missing)rows.push({id,name:ai.pluginProviderLabels?.[id]||'Unavailable plugin provider',short:ai.pluginProviderLabels?.[id]||'Unavailable plugin provider',plugin:true,unavailable:true,needsKey:true,models:[],defaultModel:'',baseUrl:''});
 return rows;
}
function getPublic() {
  const ai = read().ai || {};
  const keys = {};
  for (const p of [...providerIds(),...Object.keys(ai.keys||{}).filter(providerPresets.isPlugin)]) if (ai.keys && ai.keys[p]) keys[p] = ai.keys[p].hint;
  return {
    provider: providerIds().includes(ai.provider)||providerPresets.isPlugin(ai.provider) ? ai.provider : 'gemini',
    models: { ...defaultModels(), ...(ai.models || {}) },
    baseUrls: ai.baseUrls || {},
    executablePaths: ai.executablePaths || {},
    reasoningEfforts: ai.reasoningEfforts || {},
    webResearch: Object.fromEntries(Object.keys(WEB_RESEARCH_DEFAULTS).map((p) => [p, webResearchOf(ai, p)])),
    subagents: Object.fromEntries(Object.keys(WEB_RESEARCH_DEFAULTS).map(p => [p, subagentsOf(ai, p)])),
    subagentConcurrency: Object.fromEntries(Object.keys(WEB_RESEARCH_DEFAULTS).map(p => [p, subagentConcurrencyOf(ai, p)])),
    keys, // provider -> "…abcd" for providers that have a saved key
    providerPlugins: pluginProviderPublic(ai),
    defaultModels: defaultModels(),
    // Not probed here (this runs at launch): assumed available until a save or a read proves otherwise,
    // in which case that save fails with the secure-storage message and the next read reports false.
    encryption: !encryptionRefused,
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
  if (!SERVICES.includes(name)) return '';
  return decryptEntry(read().services?.[name]);
}

function saveServiceKey(name, key) {
  if (!SERVICES.includes(name)) throw new Error(t('main.unknown_service'));
  const k = String(key || '').trim();
  if (!k) throw new Error(t('main.paste_a_key_first'));
  if (!encryptionAvailable()) throw new Error(t('main.secure_storage_not_available'));
  const data = read();
  data.services = { ...(data.services || {}), [name]: encryptEntry(k) };
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
  if(providerPresets.isPlugin(provider))assertPluginProvider(provider);
  const key = String(value || '').trim();
  if (!key) throw new Error(t('main.paste_a_key_first'));
  if (!encryptionAvailable()) throw new Error(t('main.secure_storage_not_available'));
  const data = read();
  data.ai = { ...(data.ai || {}), keys: { ...(data.ai?.keys || {}), [provider]: encryptEntry(key) } };
  write(data);
  return getPublic();
}

// Active configuration for the main process, including the decrypted key.
function getActive(providerOverride) {
  const ai = read().ai || {};
  const provider = providerOverride || (providerIds().includes(ai.provider)||providerPresets.isPlugin(ai.provider) ? ai.provider : 'gemini');
  const model = (ai.models && ai.models[provider]) || defaultModels()[provider];
  assertPluginProvider(provider,model);
  const effort = ai.reasoningEfforts?.[provider]?.[model];
  const apiKey = decryptEntry(ai.keys && ai.keys[provider]); // '' when saved under another account or corrupted
  return {
    provider,
    model,
    baseUrl: providerPresets.isPlugin(provider)?providerPresets.byId(provider).baseUrl:(ai.baseUrls && ai.baseUrls[provider]) || '',
    apiKey,
    executablePath: (ai.executablePaths && ai.executablePaths[provider]) || '',
    reasoningEffort: typeof effort === 'string' ? effort : '',
    reasoningEfforts: ai.reasoningEfforts?.[provider] || {},
    webResearch: webResearchOf(ai, provider),
    subagents: subagentsOf(ai, provider),
    subagentConcurrency: subagentConcurrencyOf(ai, provider),
  };
}

// patch: { provider, model, baseUrl, apiKey } (apiKey optional: omitted keeps the saved key).
function save(patch) {
  const data = read();
  const ai = data.ai || {};
  if(providerPresets.isPlugin(patch.provider)&&!providerPresets.byId(patch.provider))throw Error('Plugin provider is unavailable.');
  const provider = providerIds().includes(patch.provider) ? patch.provider : ai.provider || 'gemini';
  assertPluginProvider(provider, (patch.model||'').trim()||defaultModels()[provider],patch.baseUrl);
  ai.provider = provider;
  ai.models = { ...(ai.models || {}), [provider]: (patch.model || '').trim() || defaultModels()[provider] };
  ai.baseUrls = { ...(ai.baseUrls || {}), [provider]: providerPresets.isPlugin(provider)?providerPresets.byId(provider).baseUrl:(patch.baseUrl || '').trim().replace(/\/+$/, '') };
  if (['codex-sdk', 'claude-agent-sdk'].includes(provider) && patch.executablePath !== undefined) {
    ai.executablePaths = { ...(ai.executablePaths || {}), [provider]: String(patch.executablePath || '').trim() };
  }
  if (provider in WEB_RESEARCH_DEFAULTS && typeof patch.webResearch === 'boolean') ai.webResearch = { ...(ai.webResearch || {}), [provider]: patch.webResearch };
  if (provider in WEB_RESEARCH_DEFAULTS && typeof patch.subagents === 'boolean') ai.subagents = { ...(ai.subagents || {}), [provider]: patch.subagents };
  if (provider in WEB_RESEARCH_DEFAULTS && patch.subagentConcurrency !== undefined) {
    if (!Number.isInteger(patch.subagentConcurrency) || patch.subagentConcurrency < 1 || patch.subagentConcurrency > SUBAGENT_LIMITS.maxConcurrent) throw Error(t('subagents.invalid_concurrency', { max: SUBAGENT_LIMITS.maxConcurrent }));
    ai.subagentConcurrency = { ...(ai.subagentConcurrency || {}), [provider]: patch.subagentConcurrency };
  }
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    if (!encryptionAvailable()) {
      throw new Error(t('main.secure_storage_not_available'));
    }
    ai.keys = { ...(ai.keys || {}), [provider]: encryptEntry(patch.apiKey.trim()) };
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
  if (!providerIds().includes(provider) || typeof model !== 'string') throw new Error(t('main.invalid_ai_model_selection'));
  const data = read();
  const ai = data.ai || {};
  assertPluginProvider(provider,model);
  const active = providerIds().includes(ai.provider)||providerPresets.isPlugin(ai.provider) ? ai.provider : 'gemini';
  if (active !== provider) throw new Error(t('main.ai_provider_changed'));
  ai.models = { ...(ai.models || {}), [provider]: model.trim() || defaultModels()[provider] };
  data.ai = ai;
  write(data);
  return getPublic();
}

function setReasoningEffort(provider, model, effort, allowedLevels) {
  const levels = allowedLevels || require("../agents/thinking.cjs").SDK_LEVELS[provider] || [];
  if (!providerIds().includes(provider) || typeof model !== 'string' || typeof effort !== 'string' || (effort && (!model || !levels.includes(effort)))) throw new Error(t('main.invalid_thinking_effort'));
  const data = read();
  const ai = data.ai || {};
  if (ai.provider !== provider || (ai.models?.[provider] || defaultModels()[provider]) !== model) throw new Error(t('main.ai_provider_or_model_changed'));
  ai.reasoningEfforts = { ...(ai.reasoningEfforts || {}),
    [provider]: { ...(ai.reasoningEfforts?.[provider] || {}), [model]: effort },
  };
  data.ai = ai;
  write(data);
  return getPublic();
}

// Composer changes update only delegation preferences, never model, endpoint or keys.
function setSubagents(provider, patch = {}) {
  if (!(provider in WEB_RESEARCH_DEFAULTS) || !patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some(key => !['enabled', 'concurrency'].includes(key))
    || patch.enabled !== undefined && typeof patch.enabled !== 'boolean'
    || patch.concurrency !== undefined && (!Number.isInteger(patch.concurrency) || patch.concurrency < 1 || patch.concurrency > SUBAGENT_LIMITS.maxConcurrent)) throw Error(t('subagents.invalid_concurrency', { max: SUBAGENT_LIMITS.maxConcurrent }));
  const data = read(), ai = data.ai || {};
  if (ai.provider !== provider) throw Error(t('main.ai_provider_changed'));
  if (patch.enabled !== undefined) ai.subagents = { ...(ai.subagents || {}), [provider]: patch.enabled };
  if (patch.concurrency !== undefined) ai.subagentConcurrency = { ...(ai.subagentConcurrency || {}), [provider]: patch.concurrency };
  data.ai = ai;write(data);return getPublic();
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

module.exports = { warmKeys, getLanguagePreference, setLanguagePreference, getWindowState, setWindowState, getShortcuts, setShortcuts, getQuality, setQuality, getPerfMode, setPerfMode, PERF_MODES, getPublic, getActive, save, setModel, setReasoningEffort, setSubagents, clearKey, saveProviderKey, getServiceKey, saveServiceKey, clearServiceKey, getMcpServers, setMcpServers, getExternalAgents, setExternalAgents, externalToken, getVoiceDefault, setVoiceDefault, getVoiceStudio, setVoiceStudio, getFirstRun, setFirstRun, pluginProviderApproved,approvePluginProvider,get PROVIDERS(){return providerIds();},get DEFAULT_MODELS(){return defaultModels();} };
