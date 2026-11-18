# Stage 4b: declarative AI providers

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


An API-1 package can contribute `aiProviders` without an executable entry or command
permissions. The first slice adapts the existing OpenAI Chat Completions transport.
Each provider declares a local ID, name, description, `protocol: "openai"`, `baseUrl`,
`needsKey`, `defaultModel` and 1–32 models `{id,name,vision}`. All declared models
must support function tools. Additional wire formats are optional integrations
requiring a named unsupported provider/use case; they are not a v1 requirement.
Custom headers remain unsupported.

Install adds metadata only. No model discovery, probing or requests occur at
startup. The model catalog and vision flags come from the package; they are
capability declarations by an unverified publisher, not a compatibility guarantee.
A user selects and tests the provider in Settings before using it in CraftAI.

Provider identity is `plugin-provider:<plugin-id>/<local-id>@<package-digest>`.
Settings retain exact version selection, including when it becomes unavailable.
Disable/removal/tampering fails closed; it never silently chooses a built-in or
new plugin version. Re-enabling the exact original package restores that selection.
Updates have separate model preferences, consent and encrypted credential slots;
credentials are never copied between versions or endpoints. Orphaned keys can be
removed from Settings. Packages and project files contain no credentials.

Before saving configuration, storing a credential or sending a test, a host-owned
native prompt names the unverified publisher, version, exact endpoint and data
sent (conversation, tool results and images only for vision models). Declining
persists no consent, selection or credential. Approval applies to the exact
installed snapshot. Endpoint overrides, embedded credentials, query strings,
fragments, custom headers and redirects are forbidden. HTTPS is required except
HTTP on literal loopback addresses or `localhost`. No automatic fallback enters
or leaves a plugin provider, even when other saved keys exist.

Only the host constructs requests and decrypts that provider's scoped key. The
request gate revalidates package integrity, activation, model and endpoint before
and after each request. Disabling/changing packages aborts active plugin-provider
requests. A watch detects on-disk tampering while a request is pending. Late results
cannot commit edits. Network calls are limited to the approved base URL plus
`/chat/completions`; response bodies are bounded. Existing tool schemas, cancellation,
activity and edit ownership remain in effect. Caption workflows use the same gate.

The original local example targets an OpenAI-compatible local Ollama endpoint and
declares one model; install that model separately before a live connection test.
Tests use isolated local protocol fixtures and temporary credential storage.
No executable provider code, installation scripts, downloads or direct plugin
network/credential access are introduced. Streaming follows the existing CraftAI
transport behavior; token-level streaming is not added by this slice.


Example shape (the base URL and model IDs must match your actual service):

```json
{
  "id": "my-publisher.provider-pack",
  "name": "My provider pack",
  "publisher": "My publisher",
  "version": "1.0.0",
  "apiVersion": 1,
  "permissions": [],
  "contributes": {
    "aiProviders": [{
      "id": "chat",
      "name": "My AI service",
      "protocol": "openai",
      "baseUrl": "https://api.example.com/v1",
      "needsKey": true,
      "defaultModel": "my-tool-model",
      "models": [{"id":"my-tool-model","name":"My tool model","vision":false}]
    }]
  }
}
```

Validate/package through the existing plugin helper and install in Settings →
Plugins. Then choose the provider under Assistant, approve the displayed
endpoint, add its key through Manage API key if needed, test the connection and
save the selection. Changing package content requires a version increment.
The local development example is `examples/plugins/local-ai-provider/plugin.json`.
No local service or model is installed by this package.

Transport reference: [official Chat Completions function-tool contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
