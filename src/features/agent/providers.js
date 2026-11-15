// The AI provider presets for the renderer (shared/providers.json, docs/agents/ai-providers.md): the
// same rows the main process reads (electron/agents/providers.cjs), for the Settings dialog, the API
// keys page and the names the chat shows. Keep the two helper files in step; the table is the one source.
import PRESETS from '../../../shared/providers.json' with { type: 'json' };

export { PRESETS };
let pluginRows=[];
export const registerPluginProviderMetadata=rows=>{pluginRows=Array.isArray(rows)?rows:[];};
export const providerById = (id) => [...PRESETS,...pluginRows].find((p) => p.id === id) || null;
// Short names for the chat ("switched to Grok") and the fallback notes.
export const providerShortName = (id) => providerById(id)?.short || id;
// What a native agent is called in the runtime controls ("Download Codex").
export const nativeAgentName = (id) => providerById(id)?.agentName || 'the agent';
