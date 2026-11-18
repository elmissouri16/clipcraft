# Managed local speech tools and models

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


SDK 0.8.0 / host API 1 adds the separate `local.run` command permission. This
permission may be combined only with `project.read`. Installation executes and
downloads nothing. The first curated adapter is `speech.whisper`: the host owns
FFmpeg audio preparation and a separately approved whisper.cpp CLI. Plugins
cannot supply executable paths, URLs, arguments, shell commands or model bytes.

```json
{"permissions":["local.run"],"entry":"commands.js","contributes":{
  "localTools":[{"id":"speech","name":"Local speech","adapter":"speech.whisper","models":["base"]}],
  "commands":[{"id":"transcribe","name":"Transcribe audio","parameters":[]}]
}}
```

```js
await context.local.run({toolId:'speech',operation:'transcribe',model:'base',
  start_sec:0,duration_sec:5,language:'auto'});
```

The method stages one recipe. The worker exits before the host asks for a source
and runs the native job. The host offers a transcript review and an exclusive new
SRT destination. It returns actual cue/character counts and whether a file was
saved; the worker receives no source path, audio, transcript or output path.
Settings commands, registered actions, CraftAI and panel command allowlists retain
their existing approval and ownership rules. The project and Undo history are
unchanged. SRT timing starts at zero for the requested source section; importing
that file into an editor timeline remains a separate normal user action.

## Setup and storage

Select the plugin in Settings, or start its development session. Local tools and
models shows the current platform, bundled FFmpeg availability and the approved
speech executable. Choose a trusted, already installed `whisper-cli`; the host
asks for separate approval before its bounded help probe, pins its SHA-256,
platform/architecture and file identity, and checks integrity before every run.
The CLI and its native dependencies must already be installed. Native programs
run as the desktop user, outside the plugin Worker sandbox. This is a separately
trusted host-tool boundary, not an OS sandbox for arbitrary plugin code; the
plugin controls neither executable identity nor environment/arguments. No engine archive
installer or arbitrary executable download is exposed to plugins.

Models are the host's existing pinned Base, Turbo and Darija catalog. Each adapter
declares a subset. Download, offline import and removal each require native
consent. Imports and downloads use the same exact size/SHA-256 validation, private
partial files and atomic publication; a failed replacement preserves a previous
model. HTTPS redirects stay within the host-approved Hugging Face domains and
carry no credentials. A model is rehashed before inference. Setup progress and
cancellation are available in Settings. Models are shared by enabled adapters
inside the host-owned `plugin-local` cache, separate from the editor caption cache.
Removal affects every adapter using that cached model; the global local-job lock
prevents removal during inference. Removing a plugin retains the explicitly
installed shared model cache; use the model removal control before removal when
you want those bytes deleted.

Supported platform decisions are macOS/Linux/Windows x64 and arm64. Tool
availability is checked separately; no successful Windows/Linux run is implied
by the platform table. Current native inference evidence is macOS/Base.

## Bounds and revocation

- One setup/inference job globally; ten-minute deadline and a 30-second stream
  stall bound. One recipe per command, at most 120 seconds of picked audio.
- Source: regular, nonsymlink file up to 512 MiB, copied before probing or decoding.
  Local-file protocols only, external MOV/MP4 data references disabled.
- Native stdout is bounded; the host kills excessive output, bounds transcript
  JSON to 2 MiB, validates at most 1,000 cues and 64,000 text characters, and
  removes its private source/WAV/JSON workspace after every outcome.
- Cancellation, disabled/removed packages, development reload/end and editor
  navigation/crash/closure abort work. Every native dialog is followed by an
  ownership/integrity recheck. Final SRT publication is exclusive and synchronous
  after verification; a completed file is retained and reported truthfully.
- Panel jobs recheck the exact live panel and retain host-owned completion
  receipts; panel content cannot forge cue counts or saved status.

Example: [local-speech](../../examples/plugins/local-speech/plugin.json).
Verification is recorded in `managedLocalAndAuthoring` in
[plugin-validation.json](plugin-validation.json). These bounded adapters grant no
general terminal, filesystem, arbitrary model loader or background daemon API.

Scaffold this capability with `clipcraft-plugin create /tmp/local-speech --id
studio.speech --name "Local speech" --publisher "Studio" --template local-tool`.
