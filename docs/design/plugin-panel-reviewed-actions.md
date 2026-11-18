# Reviewed AI, caption and GIF panel actions

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


This pre-v1 extension keeps SDK 0.8.0, host/manifest API 1 and app 2.0.0.
Panels can now allowlist same-package commands using the existing chapter AI,
caption translation/write and GIF export capabilities. There is no direct panel
transcript, model, file, destination or export API. Commands still run in their
separate worker, with canonical permission combinations, inputs and limits.

A panel declares at most eight unique command IDs using its existing `commands`
allowlist. Panel-level permissions remain `project.read`, `editor.read` and
`storage.local`; command capabilities belong to the package permissions. Panel
opening approves its local interface and declared read/storage access. Each
command needs a fresh, single-use trusted click and separate native Run once
consent. Opening, installation, heartbeat, project updates and synthetic clicks
do not execute a command. Denial, including discarded review, blocks new action
requests for that panel opening; reopening allows a new explicit request.

```ts
// Inside the panel's trusted click handler. The command and parameters must be
// declared in the same package, with its required package permissions.
const result = await panel.commands.run('translate-captions', {
  language: 'es', source_track: 2,
});
if (result.status === 'completed' && result.captions_added !== undefined) {
  showResult(`${result.captions_added} captions on track ${result.caption_track}`);
}
```

## Chapters and translated captions

Chapter commands retain `captions.read`, `ai.chapters` and `markers.write`.
Native sharing approval names the configured service/model/destination and amount
of caption text. The existing host service allows one bounded request. Proposals
must pass the host chapter review before any markers commit. The receipt reports
actual deduplicated `markers_added`, never a worker's claimed result.

Caption commands retain `captions.read` and `captions.write`, plus
`ai.translateCaptions` when they request the host model. They keep the supported
language enum and optional 1-based `source_track`; only that source track is shared
for translation. The host review shows original and translated cues with their
times. Apply creates a separate named, hidden caption track, preserving original
text, word timing, locks and cue times. The existing cue/text limits and destination
track limits/locks apply; a denied, failed or stale proposal adds nothing.

After review, the editor validates the proposal and asks main for final panel
authorization. It then rechecks document identity, load generation, edit ownership
and cancellation before committing one reducer/Undo transaction. Closure or
revocation while authorization is pending cannot apply a late result. Once an
atomic commit is authorized and applying, cancellation cannot promise rollback.

Caption receipts add `captions_added`, 1-based `caption_track`,
`caption_track_hidden: true` and `language`. Only bounded integer counts and the
approved language are accepted. No caption text, private clip IDs, provider
credentials or untrusted worker messages are added to the panel receipt.
`markers_added: 0` remains present for compatibility.

## GIF publication

GIF packages retain the standard four parameters and `export.gif`, optionally
with read permissions. GIF permissions cannot be combined with AI or editor writes.
The native prompt approves the resolved bounded recipe. Only successful staging
and worker completion can start the host exporter. The user chooses a fresh GIF
filename in a separate native save dialog; the panel and worker choose no paths.

The host renders the frozen composition, verifies source fingerprints, dimensions,
frame count, duration and full decode, and revalidates the package and exact live
panel immediately before exclusive publication. Stop, panel closure, project
replacement/editing or revocation before publication cancels the job and removes
temporary output. Save Cancel reports `canceled`. An existing destination is never
overwritten. GIF export adds no timeline edit or Undo entry.

The native runtime records publication before passing the result back to the
editor. Only that record can produce a successful panel artifact; a supplied
renderer/page receipt cannot forge it. Cancellation or closure after publication
preserves the actual successful result and releases the action. Published files
remain on disk; export consent explicitly distinguishes that from timeline Undo.
A disposed SDK client still rejects further/in-flight use under its existing
lifetime contract; disposal does not delete an already published artifact.

A successful panel result contains `markers_added: 0` and `artifact`:

```ts
interface PanelGifArtifact {
  type: 'image'; format: 'gif'; bytes: number;
  start_sec: number; end_sec: number; width: number; height: number;
  fps: number; frame_count: number; duration_sec: number;
}
```

There is no `path`, staged recipe flag, file handle or filesystem capability in
the public receipt. The host dock retains the native artifact path for its Open
and Show in folder buttons. Worker messages cannot claim an artifact or destination.

## Progress, lifetime and boundaries

`PanelProgress.phase` now includes `review`. Events contain only bounded phase
and fraction, keeping the existing subscription and request limits. The host dock
shows the actual progress/results and supports Cancel through permission, running
and review. Native panel views are masked behind host review dialogs and menus.
Main owns action/run identity, single claims, exact command/input binding and
same-opening denial state. Existing panel crash, disable/removal, development
reload, project replacement and Stop behavior still applies.

Existing panel marker/clip commands and action surfaces retain their contracts.
The [picked media and reviewed upload contract](plugin-media-jobs.md) now extends
this same command allowlist separately. New model/provider protocols, transcription,
arbitrary caption patches, background jobs, unrestricted worker APIs and
cross-version preferences remain separate pre-v1 capabilities.

Verification uses three public-SDK-built packages installed through Settings into
an isolated hidden Electron profile, the actual workers and GIF renderer/encoder,
scripted native approval, a deterministic model stub and a fresh second process.
Evidence is retained under `reviewedPanelActions` in
[plugin-validation.json](plugin-validation.json). Model payload/review behavior is
verified without calling a live service. Hidden trusted-click injection, scripted
native dialogs and host captures do not certify native OS focus or real provider
compatibility. Full release-battery, packaged-runtime and platform gates remain open.
