# Local AI through a normal service

Build and install this source, then Trust & activate in Plugins settings. Configure
the OpenAI-compatible base address and an already installed model ID in its native
**Local AI connection** settings. The default is a separately running local Ollama
service at `http://localhost:11434/v1` with `qwen2.5:7b`. No server/model is installed
or downloaded, and installation/activation/catalog discovery send no requests.

Open Assistant settings, select **Local AI (extension)** and its configured model,
then Test connection and Save. CraftAI can now use that service for the existing
editor tool loop, including matching tool replies and Undo. The example advertises
text/tool calling, with no images or custom thinking levels. Configure a different
model in Plugins settings before selecting it in Assistant settings.

An optional API key belongs to the extension's encrypted secret store. Core
Assistant keys and endpoint fields are not copied or sent into the extension.
The extension owns its HTTP(S) transport, JSON schema conversion and conversation
mapping. Requests have bounded time/response size, no redirect following and no
automatic retry. A missing/truncated answer or invalid tool arguments fail the
request. Full Node trust grants network/program/file access; this is not an OS
sandbox or a vendor-specific SDK permission.

The service uses `services.register` plus the generic `ui.registerIntegration`
point `ai.engines`. Its manifest contains no `aiProviders` contribution. The full
application-side contract is documented in
`docs/design/plugin-extension-ai.md` in the repository.

Stop, disable or remove the package to make it unavailable. An explicitly selected
engine stays selected so a conversation is never silently sent to another service.
This also applies after restart.

The ID/version match the old declarative example; remove that installed package
before installing the replacement's different immutable bytes. Select this new
service explicitly in Assistant settings. Old keys/settings are not deleted or
silently transferred. App 2.0.0, SDK 0.8.0, host API 1 and example 1.0.0 are unchanged.
