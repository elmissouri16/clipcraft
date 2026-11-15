// The AI provider presets (shared/providers.json, docs/agents/ai-providers.md), for the main process.
// A provider is a row of data over one of four wire protocols: openai (chat completions, also
// Groq, OpenRouter, xAI, Mistral, DeepSeek, Custom), anthropic, gemini and ollama; native agents
// (Codex, Claude, OpenCode) are runtimes, not APIs. Adding an OpenAI-compatible service is one row.
const PRESETS = require('../../shared/providers.json');
let pluginRows=[];
const isPlugin=id=>typeof id==='string'&&id.startsWith('plugin-provider:');
const all=()=>[...PRESETS,...pluginRows];
const setPluginProviders=rows=>{pluginRows=rows;};
const byId = (id) => all().find((p) => p.id === id) || null;
const ids = () => all().map((p) => p.id);
const protocolOf = (id) => byId(id)?.protocol || null;
// Speaks the OpenAI chat API (Custom included, whose address the user supplies).
const openAiLike = (id) => protocolOf(id) === 'openai';
const baseUrlOf = (id) => byId(id)?.baseUrl || '';
const defaultModels = () => Object.fromEntries(all().map((p) => [p.id, p.defaultModel || '']));
// Providers that store an API key.
const keyed = () => all().filter((p) => p.needsKey).map((p) => p.id);
// API providers that can run the editing tools, in fallback order: keyed ones as listed, Ollama last.
const toolProviders = () => [...PRESETS.filter((p) => p.protocol !== 'native' && p.id !== 'ollama').map((p) => p.id), ...(byId('ollama') ? ['ollama'] : [])];
const shortNames = () => Object.fromEntries(all().map((p) => [p.id, p.short || p.name]));
// Extra request headers a service wants (OpenRouter's app attribution).
const headers = (id) => ({ ...(byId(id)?.headers || {}) });
// Where the reasoning effort goes in an OpenAI-style body: the flat field, or OpenRouter's nested one.
const reasoningField = (id) => byId(id)?.reasoningField || 'reasoning_effort';
module.exports = { PRESETS,all,isPlugin,setPluginProviders, byId, ids, protocolOf, openAiLike, baseUrlOf, defaultModels, keyed, toolProviders, shortNames, headers, reasoningField };
