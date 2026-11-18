# External-service API keys

Settings > API keys is the single credential-management page. Providers are
searchable and grouped by name, with separate usage rows for Assistant, Voice
generation, Caption transcription and media libraries where applicable. Rows use
the same masked input, test, save/replace and remove actions. Saved status means a
credential is stored; it does not claim that a connection has been tested.

Voice keeps voice selection and the VoiceStudio connector. Assistant keeps model, endpoint
and native-agent configuration. Captions keeps provider/model selection. These
features display key status and link to the matching provider in API keys, rather
than rendering their own password fields. Openverse, the local VoiceStudio connector and
Ollama do not require API keys; native-agent sign-in remains in Assistant.

The renderer owns navigation and editing in `ServiceConnections.jsx`, sharing the
settings layout primitives in `SettingsLayout.jsx`. `SettingsDialog.jsx` handles
`services:<provider-or-service-id>` targets (including `services:assistant:gemini`,
`services:gemini-tts` and `services:cap-groq`), and accepts the old `stock` target as
a link to Pixabay. Closing Settings refreshes the feature panels' saved status.

Credentials retain their existing encrypted settings namespaces: `ai.keys` for
assistant providers and `services` for voices, captions and media. No existing key
is migrated, combined or overwritten automatically. A provider key may be entered
for multiple features if its permissions allow it. Saved secrets are never sent
back to the renderer; it receives only the existing short hints.

`settings:saveProviderKey` updates only a named assistant credential, preserving
the active assistant, models, endpoints and other profile settings. It uses the
same safeStorage encryption and atomic-write path as existing settings saves.
`settings:saveServiceKey` and the existing test/remove IPC methods remain in use.
Connection tests are explicit actions; opening a provider does not call its API.

Validation:

- `node tests/unit/system/test-settings.cjs`: encryption availability, key-only
  updates, public hints, unchanged profiles and atomic failure handling.
- `node tests/unit/system/test-service-connections-ui.cjs`: hidden real Electron
  UI using isolated settings, synthetic credentials and stubbed provider tests.
- `node tests/unit/audio/test-gemini-tts-ui.cjs`: simulated provider, real speech
  rendering, agent placement and key setup through the unified page.
- `npm run test:structure`: ownership and import boundaries.

The hidden UI suite does not call `show()` or request desktop focus. Focus-dependent
clipboard/native-menu tests remain separate from these credential checks.
