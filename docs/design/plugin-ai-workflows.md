# Stage 3b: caption-based AI chapter suggestions

This first AI slice adds a fixed host-owned `ai.chapters({count})` service to command plugins. It uses existing timeline caption clips only: no transcription, source indexing, media upload, plugin-provided prompt, URL, credential, provider override or arbitrary model tools. The plugin sandbox remains network/file isolated. The second slice adds [caption translation](plugin-caption-translation.md), enum inputs and a separately reviewed new caption track. Broader AI services and edit operations still need separate contracts.

## Permissions and data

Executable packages may request `captions.read` and `ai.chapters` in addition to existing permissions. `ai.chapters` requires `captions.read` and `markers.write`. `context.transcript.read()` returns only validated caption cues `{start_sec,end_sec,text}`. At most 1,000 cues / 24,000 text characters are accepted; oversized input fails explicitly rather than silently truncating. Non-caption text, media paths/bytes, chat, credentials and full projects are excluded. Missing captions fail before code execution or any model request.

ClipCraft captures the selected AI provider, model and endpoint before native approval. The approval names that destination, the caption count/character count and the fact that caption text will be sent there, potentially using the user's account. Settings changes after approval do not change the destination. Credentials stay in the main process. There is no automatic provider fallback. Native agents use their configured account with editing/web tools disabled; an Ollama or custom address is described by its configured origin, without assuming it is local.

## Bounded service

One chapter service call per command run; `count` is an integer from 1 to 20. The host constructs the prompt and uses only the captured captions. Replies must be JSON `{chapters:[{time,label}]}`, with at most `count` entries, plain nonempty labels up to 80 characters, unique ascending timestamps anchored to caption starts, and no other properties. A malformed reply fails without an automatic retry. The API request asks for at most 2,048 output tokens; received text is limited to 8 KiB. Native SDKs may not enforce an output-token quota, so they also have an abort deadline and the same reply validation. No hard billing or OS resource quota is claimed.

AI commands have a fixed 90-second execution limit (ordinary commands retain 15 seconds), with a 60-second model deadline. Cancellation aborts the host model request and destroys the worker. Provider errors are shown as safe host messages without exposing credential-bearing diagnostics to plugins. Text and model output remain untrusted data.

## Review and apply

Any command requesting `ai.chapters` must pass a host-owned review, even if its executable skips the model service. After successful worker completion, the host stops the sandbox, validates staged markers and shows all proposed timestamps/titles in a native review dialog. Apply is explicit; Discard is the default. The editor remains unchanged until approval. Package integrity/activation is rechecked after review; cancellation, removal/disablement, project/ownership changes or late approval discard proposals. Accepted markers still pass the existing renderer and reducer guards and form one Undo step (or the owning CraftAI transaction).

Both Settings and CraftAI use this path. CraftAI cannot approve text sharing or marker review for the user. Review refusal follows the existing no-retry permission-denial policy for that request. The example **AI chapter markers** reads caption text, requests host chapter suggestions, stages them and waits for host review. Dev loading never runs it.

## Acceptance

Use the actual Electron Settings and CraftAI UI with scripted model responses and dialog choices. Check precise consent/destination, caption-only inputs, suggested titles/timestamps, zero edits before review, explicit apply, one-step Undo/Redo, refusal, no captions/oversized inputs, malformed model output, invalid/undeclared calls, repeat-call limits, cancellation/timeouts, stale projects and package revocation. Re-run existing command and CraftAI regression suites. Real paid-model output quality, other platforms and the full battery are separate checks and must not be implied by fixture results.
