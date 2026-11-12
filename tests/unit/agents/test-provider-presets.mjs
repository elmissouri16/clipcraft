// The AI provider preset table (shared/providers.json, docs/agents/ai-providers.md): one row per provider over
// one of four wire protocols; both helper modules read the same rows; the invariants every row must keep so
// that adding a provider is a row and nothing else. Usage: node tests/unit/agents/test-provider-presets.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { PRESETS, providerById, providerShortName, nativeAgentName } from '../../../src/features/agent/providers.js';
const main = createRequire(import.meta.url)('../../../electron/agents/providers.cjs');

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const PROTOCOLS = new Set(['openai', 'anthropic', 'gemini', 'ollama', 'native']);
check('both sides read the same rows', JSON.stringify(PRESETS) === JSON.stringify(main.PRESETS) && PRESETS.length >= 10);
check('ids are unique, lower-case slugs', new Set(PRESETS.map((p) => p.id)).size === PRESETS.length && PRESETS.every((p) => /^[a-z][a-z0-9-]*$/.test(p.id)));
check('every row names a known protocol', PRESETS.every((p) => PROTOCOLS.has(p.protocol)));
const en = JSON.parse(fs.readFileSync(new URL('../../../shared/i18n/en.json', import.meta.url), 'utf8'));
check('every row has a short name, and its display name and hint live in the dictionary', PRESETS.every((p) => p.short && typeof en[`providers.${p.id}.name`] === 'string' && typeof en[`providers.${p.id}.hint`] === 'string' && en[`providers.${p.id}.hint`].length > 10));
check('OpenAI-compatible rows carry their address, except Custom which the user supplies', PRESETS.filter((p) => p.protocol === 'openai').every((p) => p.id === 'custom' ? p.baseUrl === '' : /^https?:\/\/\S+\/v1$/.test(p.baseUrl)));
check('API rows that store a key link to a key page over https with a dictionary label; natives link to setup', PRESETS.filter((p) => p.needsKey && p.id !== 'custom').every((p) => /^https:\/\//.test(p.keyUrl) && en[`providers.${p.id}.key_label`]) && PRESETS.filter((p) => p.protocol === 'native').every((p) => p.sdk && !p.needsKey && p.agentName && /^https:\/\//.test(p.keyUrl)));
check('defaultModel is a string on every row and empty only where the service or agent picks', PRESETS.every((p) => typeof p.defaultModel === 'string') && PRESETS.filter((p) => !p.defaultModel).every((p) => p.id === 'custom' || p.protocol === 'native'));
check('reasoningField, when set, is one of the two OpenAI-style spellings', PRESETS.every((p) => !p.reasoningField || ['reasoning_effort', 'reasoning.effort'].includes(p.reasoningField)));
check('headers, when set, are a flat string map', PRESETS.every((p) => !p.headers || Object.values(p.headers).every((v) => typeof v === 'string')));
// main helpers
check('openAiLike covers every OpenAI-protocol row and nothing else', PRESETS.every((p) => main.openAiLike(p.id) === (p.protocol === 'openai')) && main.openAiLike('nope') === false);
check('keyed() lists exactly the rows that store a key', JSON.stringify(main.keyed()) === JSON.stringify(PRESETS.filter((p) => p.needsKey).map((p) => p.id)));
check('toolProviders() is the keyed API rows in order with Ollama last and no native agent', main.toolProviders().at(-1) === 'ollama' && main.toolProviders().every((id) => main.protocolOf(id) !== 'native') && main.toolProviders().slice(0, -1).join() === PRESETS.filter((p) => p.protocol !== 'native' && p.id !== 'ollama').map((p) => p.id).join());
check('defaultModels() has every id', Object.keys(main.defaultModels()).length === PRESETS.length && main.defaultModels().groq === 'openai/gpt-oss-120b');
check('OpenRouter is the only row with the nested reasoning field and the attribution headers', main.reasoningField('openrouter') === 'reasoning.effort' && main.reasoningField('xai') === 'reasoning_effort' && main.headers('openrouter')['x-title'] === 'ClipCraft' && Object.keys(main.headers('xai')).length === 0);
// renderer helpers
check('renderer names match the table', providerShortName('xai') === 'Grok' && providerShortName('codex-sdk') === 'Codex SDK' && providerShortName('zzz') === 'zzz' && nativeAgentName('claude-agent-sdk') === 'Claude' && nativeAgentName('gemini') === 'the agent' && providerById('mistral').baseUrl === 'https://api.mistral.ai/v1');
console.log(`provider presets: ${checks.length} checks passed`);
