# AI providers: one table, four protocols

CraftAI's API providers are rows of `shared/providers.json`, read by `electron/agents/providers.cjs`
(main process) and `src/features/agent/providers.js` (renderer). A row is data: id, short name, the wire
protocol, whether it stores a key, the default address, the default model, the key page, and two
optional quirks (extra request headers, where the reasoning effort goes). The display name, the hint and
the key-page label are user-interface text, so they live in the dictionaries as `providers.<id>.name`,
`providers.<id>.hint` and `providers.<id>.key_label` (docs/design/localization.md). Everything that used to list
providers by hand reads the table: the API client, the settings store and its key allowlist, the fallback
order, the names the chat shows, the Settings dialog and the API keys page. Key pages open through the one help-link rule: any https URL, nothing else.

## Protocols

| Protocol | Rows | Code |
|---|---|---|
| `openai` (chat completions; the Responses API for OpenAI reasoning models) | OpenAI, Groq, OpenRouter, xAI Grok, Mistral, DeepSeek, Custom | `openaiAgentStep`, `responsesAgentStep` in `ai.cjs` |
| `anthropic` (messages) | Claude | `anthropicAgentStep` |
| `gemini` (generateContent, AI Studio or Vertex express keys) | Gemini | `geminiGenerate` and the Gemini branch of `agentStepOnce` |
| `ollama` (OpenAI endpoint, native endpoint when thinking is on) | Ollama | `openaiAgentStep`, `ollamaAgentStep` |
| `native` (an installed agent runtime with its own loop) | Codex, Claude, OpenCode | `localAgents.cjs` and `adapters/` |

Capability differences (tool support, reasoning levels, vision) are per model, not per provider:
`modelCapabilities` asks the service about the chosen model and `thinking.cjs` holds the documented
levels for models whose services do not report them.

## Adding a provider

- **It speaks the OpenAI chat API** (most do): add one row with `"protocol": "openai"`, its `/v1`
  address, key page and a sensible default model, plus the three `providers.<id>.*` strings in each
  dictionary. No code. The row shows up in the Settings
  provider list, on the API keys page and in the fallback chain, and
  `tests/unit/agents/test-provider-presets.mjs` checks the row's shape. Add a mocked-fetch case to
  `tests/unit/agents/test-ai-providers.mjs` when the service has a quirk (a header, a different
  reasoning field) so the quirk is pinned.
- **It has a different wire format**: that is a new protocol, about the size of `anthropicAgentStep`
  plus message conversion tests, and it then serves every service that speaks it. Do not add a
  vendor SDK for it; the conversion to the internal Gemini-style conversation has to exist anyway.
- **Users can already reach it through Custom** with the service's address and key, so a row is a
  convenience (name, hint, key page, default model), never a prerequisite.

Default model ids in new rows are the services' stable aliases at the time of writing; "Load models"
in Settings lists what the user's key can really use, and the connection test proposes one when the
default is refused.


## Installed provider plugins

Stage 4b adds `contributes.aiProviders` over the existing OpenAI Chat Completions
transport. Installed snapshots appear in the Assistant provider selector beside
the built-in table. Their namespaced, fingerprinted identities have separate
preferences, encrypted keys and destination consent. Only enabled, intact versions
can send requests; a missing selected version remains explicitly unavailable.
Plugin providers neither participate in nor leave through automatic fallback.
Their model lists and vision flags are declared metadata; they do not trigger
remote catalog requests. See [the author and security contract](../design/plugin-ai-providers.md).
