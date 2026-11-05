// Model metadata wins over documented fallbacks. Never infer effort support from
// a model name substring or show every level for every provider.
const API_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const SDK_LEVELS = {
  'codex-sdk': ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'],
  'claude-agent-sdk': ['low', 'medium', 'high', 'xhigh', 'max'],
};
const OPENAI = {
  // https://developers.openai.com/api/docs/models (exact families, dated snapshots allowed)
  'gpt-5': ['minimal', 'low', 'medium', 'high'],
  'gpt-5-mini': ['minimal', 'low', 'medium', 'high'],
  'gpt-5-nano': ['minimal', 'low', 'medium', 'high'],
  'gpt-5.1': ['none', 'low', 'medium', 'high'],
  'gpt-5.2': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  o3: ['low', 'medium', 'high'], 'o3-mini': ['low', 'medium', 'high'], 'o4-mini': ['low', 'medium', 'high'],
};
const GEMINI = {
  // https://ai.google.dev/gemini-api/docs/generate-content/thinking
  'gemini-3-pro-preview': ['low', 'high'],
  'gemini-3.1-pro-preview': ['low', 'medium', 'high'],
  'gemini-3-flash-preview': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.1-flash-lite-preview': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.5-flash': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.6-flash': ['minimal', 'low', 'medium', 'high'],
  'gemini-3.7-flash': ['low', 'medium', 'high'],
  'gemini-3.8-flash': ['low', 'medium', 'high'],
  'gemini-4-argon': ['low', 'medium', 'high'],
};
const exactOpenAIModel = (id) => String(id || '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
const unique = (values) => [...new Set(values)];
function filterLevels(provider, values) {
  const allowed = SDK_LEVELS[provider];
  return unique((Array.isArray(values) ? values : []).map((value) => provider === 'gemini' && typeof value === 'string' ? value.toLowerCase() : value)
    .filter((value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) && (!allowed || allowed.includes(value))));
}
function documentedLevels(provider, model) {
  if (provider === 'openai') return Object.hasOwn(OPENAI, exactOpenAIModel(model)) ? OPENAI[exactOpenAIModel(model)] : [];
  if (provider === 'gemini') return Object.hasOwn(GEMINI, model) ? GEMINI[model] : [];
  // https://console.groq.com/docs/reasoning
  if (provider === 'groq' && ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(model)) return ['low', 'medium', 'high'];
  if (provider === 'groq' && model === 'meta-models/muse-spark-open') return ['low', 'medium', 'high', 'xhigh'];
  return [];
}
function metadataLevels(provider, entry = {}) {
  if (provider === 'claude') {
    const effort = entry.capabilities?.effort;
    if (effort?.supported === false) return [];
    const advertised = Object.entries(effort || {}).filter(([, capability]) => capability?.supported === true).map(([level]) => level);
    return filterLevels(provider, [...API_LEVELS.filter((level) => advertised.includes(level)), ...advertised.filter((level) => !API_LEVELS.includes(level))]);
  }
  const levels = filterLevels(provider, entry.reasoning?.supported_efforts || entry.supported_reasoning_efforts || entry.supportedThinkingLevels);
  return entry.reasoning?.mandatory ? levels.filter((level) => level !== 'none') : levels;
}
const usesResponses = (cfg) => cfg.provider === 'openai' && Object.hasOwn(OPENAI, exactOpenAIModel(cfg.model))
  && (!!cfg.reasoningEffort || /^gpt-6[.-]/.test(cfg.model));
module.exports = { SDK_LEVELS, filterLevels, documentedLevels, metadataLevels, usesResponses };
