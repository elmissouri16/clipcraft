# VoiceStudio extension

This optional Node extension connects ClipCraft to a separately installed
VoiceStudio app. It is not bundled or enabled by default. It uses the general SDK:
commands, scoped settings, native UI, services, jobs and verified media artifacts.
No speech-provider extension type is required.

From the ClipCraft checkout, compile and package it with the local SDK:

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs check examples/extensions/voicestudio
node packages/plugin-sdk/dist/cli.cjs build examples/extensions/voicestudio
node packages/plugin-sdk/dist/cli.cjs pack examples/extensions/voicestudio/dist /tmp/clipcraft-voicestudio.tgz
```

In Settings > Plugins, install that archive and trust its Node access. Trust
allows the extension to use Node, files, network and installed tools. Installing
or inspecting it alone does not execute code. In Settings > Voice, enable
VoiceStudio, enter its address and test the connection. The extension's voices
then appear in the default voice selector, Text to speech and CraftAI's
`list_voices`/`add_voiceover` tools. Models and advanced profile management remain
in the VoiceStudio app.

Voice cloning is an agent tool, discovered through the ordinary plugin command
catalog. Tell CraftAI, for example: “Clone this reference voice and create a
voiceover saying … at 3 seconds.” The agent supplies the existing timeline or library ID, matching reference
transcript and new narration as command arguments; there is no cloning form, file picker or cloning
action in Voice settings. The host's normal agent-command approval still applies.

- `clone-voice`: required `name` and exactly one of `reference_clip_id` (timeline
  clip ID from `get_project`), `reference_media_id` (media-library ID), or
  `reference_path` (external audio file). Prefer IDs for existing project audio;
  the plugin resolves the source path itself. Required `transcript` (exact reference words); optional `language` (`Auto`).
  First use `transcribe` with `clip_ids: [id]` to isolate the reference speech.
  Match the transcript to the chosen source window, not the entire project mix.
  Returns `voiceId`, usable with `extension:clipcraft.voicestudio.speech`.
- `set-voice-transcript`: required `voice_id` and `transcript`. Uses VoiceStudio’s
  `PUT /profiles/{id}` with only `ref_text` to update an existing saved profile.
  Use its actual reference words, then reuse the same ID with `add_voiceover`;
  this creates no new profile.
- `clone-and-voiceover`: the same reference arguments plus required `text`;
  optional `start_sec` (default 0), `speed` (0.5–2) and `style`. Saves the cloned
  profile, generates speech with its returned ID, verifies the generated audio
  and inserts it into the current project through the normal agent transaction.

For timeline clips the plugin reads the saved source in/out range and extracts
the first 15 seconds (or the full clip if shorter) with managed FFmpeg. It can
extract audio from audio, main-video and overlay clips. Library IDs work for local
audio or video media too. `reference_offset_sec` is an offset within that source
window; optional `reference_duration_sec` is 0.1–30 seconds and is bounded by the
clip's remaining source range. The captured audio is verified before upload;
stale/ambiguous/missing IDs fail without guessing or asking for a file path.

Use a short, clean reference (ideally 5–15 seconds). Direct file references accept
WAV, MP3, M4A, FLAC, OGG, AIFF, AAC or Opus up to 20 MiB. Timeline/library samples
are converted into mono 24 kHz WAV; temporary extracted files are removed.

Reference transcripts are required by this connector so cloning does not depend
on VoiceStudio having a separate speech-to-text model installed. Missing
transcripts fail before uploading or creating a profile. The new narration is
never used as the reference transcript.

Omit `style` unless requested. OmniVoice accepts speaker attributes rather than
free-form delivery prose. When style is supplied, the extension uses VoiceStudio’s
`POST /design/describe` to resolve its supported attributes. Unmatched requests
fail before cloning or synthesis; no requirements are silently discarded. Saved
profiles need no style override. Other engines receive their requested style
unchanged. Each synthesis calls the API afresh because profile data can change.

API references: [profiles](https://github.com/debpalash/voicestudio/blob/main/backend/api/routers/profiles.py),
[speech](https://github.com/debpalash/voicestudio/blob/main/backend/api/routers/openai_compat.py),
[voice attributes](https://github.com/debpalash/voicestudio/blob/main/backend/api/routers/describe_voice.py).

The command sends reference audio through VoiceStudio's `POST /profiles` API.
Neither command changes the default voice. One agent Undo removes the added
narration and preserves pre-existing project audio. The saved VoiceStudio profile
is an external effect and remains after Undo. If speech generation or insertion
fails after cloning, the error identifies the saved voice ID so CraftAI can reuse
it instead of creating another clone. Cancellation after upload can also leave a
saved profile: inspect VoiceStudio before retrying. Requests are never
automatically retried or redirected, and temporary reference handles are released.

Existing built-in connector preferences are adopted on first activation: enabled
state, address and the saved default voice. Later extension settings take
precedence. Disabling or removing the extension keeps the saved voice choice and
already-generated project audio. An unavailable explicitly selected engine shows
an error instead of silently changing the speaker.

The plugin fills a missing or blank address with `http://127.0.0.1:3900` on
activation, so the native settings field shows the same default used by its
transport. Existing custom addresses are preserved.

The service is `clipcraft.voicestudio.speech`, consumed through the host's general
`voice.engines` integration point. Protocol discovery and synthesis live entirely
in this package. Generated WAVs are imported and verified by the host before they
can be inserted into a project. Cancellation reaches the service request and
managed job signals.
