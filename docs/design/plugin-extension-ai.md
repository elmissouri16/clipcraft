# CraftAI through ordinary extension services

An executable extension still has one trusted Node entry. To integrate with
CraftAI it registers an ordinary service and a general native integration:

```ts
await context.services.register('chat', {models, generate});
await context.ui.registerIntegration({
  id: 'craft-ai', title: 'My connection', point: 'ai.engines', service: 'chat'
});
```

An optional `activationEvents: ["ui:ai.engines"]` makes a previously trusted
package discoverable when native Assistant settings request its catalog. Install
and inspection never execute it. There is no `aiProviders` declaration, SDK
provider kind, endpoint allowlist or wire protocol in this integration. The
extension owns its transport, credential storage and native configuration.

## Application service contract

`models(input, {signal})` returns `{models, defaultModel?, description?, enabled?}`.
There must be one to 100 distinct model objects `{id, name, vision?,
reasoningEfforts?}`. IDs/names are nonempty plain strings up to 200 characters.
Thinking levels are up to twelve distinct plain strings, each at most 80
characters. A default must belong to the catalog. Catalog calls have a
25-second deadline. A bad or disabled service appears unavailable; it cannot
silently replace another selected engine.

`generate(input, {signal})` receives:

- `model`, `system`, `contents`, `tools`, `maxTokens`, `timeoutMs`, `reasoningEffort`.
- `contents` uses CraftAI's existing canonical turns: `{role:'user'|'model',
  parts:[{text}|{functionCall:{name,args}}|{functionResponse:{name,response}}]}`.
  Image-capable models may also receive `inlineData` parts. These are semantic
  conversation values; translate them into the service's own transport format.
- Tool declarations contain `{name, description, parameters}`. Their schema
  types can be uppercase. The extension converts them for its transport.

The host copies and bounds the request to 32 MiB of plain finite data/bytes, with
existing depth/dense-array limits. A generation budget is 1000–300000 ms and
1–131072 output tokens. The model must belong to the current service catalog;
image input and thinking choices must match its capabilities. Core API keys,
native executable paths and saved endpoint fields are never included.

The response is `{text:string, calls:{name:string,args:object}[], state?:unknown}`.
The bridge bounds it to 1 MiB using the shared plain-data copier and permits at
most 64 calls. Core constructs the canonical model turn from this result and validates
**all** tool names/arguments against the loaded tool declarations before any
tool from that response can execute. Returning arbitrary canonical `content` is
not allowed. Truncated or invalid transport responses must reject in the
extension rather than be represented as a partial success.

Optional opaque `state` is stored in the returned turn's `extensionState` with
engine/model ownership. It is passed back only to the same engine/model.
Other engines' continuation state is removed before dispatch. This is useful for
vendor continuation metadata without putting a vendor protocol in core.

The host checks the exact integration, service owner, generation and running
activation before and after a call. Native cancellation reaches the service's
signal. A late result from a replaced/stopped activation is refused. General
service request cancellation semantics still apply; raw Node work is the
extension's responsibility. Native background text research and provider fallback
are not automatically enabled for an extension engine.

## Native behavior and example

Models appear in Assistant settings and CraftAI's existing model picker. Endpoint
and credential setup links to the extension's Plugins settings. The core saves
the selected engine/model and its display label, with no endpoint/key copy.
An explicitly selected stopped, removed or disabled engine remains selected and
unavailable; it does not fall back to a built-in service, including after restart.
Package trust is the Node authorization; no specialized per-provider approval is
added on top of it.

`examples/extensions/local-ai-provider` is the Node replacement for the old
local AI recipe, with its ID/version unchanged. Its own fetch implementation
speaks OpenAI-compatible Chat Completions, replays matched tool results, bounds
response bytes, rejects truncated answers and disables redirects/retries. Its
model is configured in Plugins settings; catalog discovery does not contact the
network. No model/server is installed by the example.

Extensions can also use the selected native AI connection through the ordinary
`clipcraft.ai` application service. The chapter-marker and caption-translation
Node examples use that service with explicit sharing and result review; see
[application services](plugin-extension-host-services.md). Historical provider recipes are retired; their saved selections remain
unavailable without fallback. See [compatibility rules](plugin-legacy-retirement.md).
