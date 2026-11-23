# Pre-alpha extension expansion: UI, processes and editor APIs

This implementation covers the requested roadmap items 2, 3 and 4.
API changes are allowed during pre-alpha. Existing document ownership, native
trust, cancellation, Undo, package isolation and resource bounds still apply.

## Required scope

- [x] Native text-input prompts with submit/cancel, validation and Stop cleanup.
- [x] Native status items with live updates, optional commands and disposal.
- [x] Left-rail and library tabs backed by declared isolated extension views.
- [x] Additional application and timeline menus using scoped native actions.
- [x] Managed stdout/stderr streaming with bounded queues and exact bytes.
- [x] Binary captured output, deadlines, cancellation and process-tree cleanup.
- [x] Persistent local helper servers owned by the activation, readiness checks,
  explicit stop and shutdown/reload cleanup.
- [x] Project create/open/save/close through existing native document workflows,
  preserving unsaved work and refusing busy or stale owners.
- [x] Explicit Undo through the editor history path.
- [x] GIF import through the ordinary verified media/adoption pipeline.
- [x] Rich typed caption styling using the editor's existing style contract.
- [x] SDK declarations, feature discovery, author examples and current guide.
- [x] Contract/runtime regressions and real Electron workflows with retained
  receipts, including failure/cancellation and restart behavior.

Implementation and contract/runtime/native verification are retained below.
Cross-platform release verification, custom shaders and custom timeline types
are outside this request.

## Native UI contract

`ui.showInput({title,prompt?,value?,placeholder?,password?,minLength?,maxLength?,timeoutMs?}, {signal?})`
returns the submitted string or `undefined` on cancel, expiry or Stop. Text is
single-line, at most 4096 characters, validated again in the host. Prompts share
the existing message ownership/rate/queue bounds and focus restoration. A forged
owner or a regular message response cannot submit input. Password input is masked
in the form; its submitted value goes only to the requesting trusted extension.

`ui.registerStatus({id,title,command?,alignment?,tooltip?,order?,icon?,enabled?,disabledReason?})`
returns an updatable registration. Up to sixteen items per activation occupy the
editor's bottom status row, ordered on the left or right. Updates use the exact
registration instance; old handles and old rendered invocations cannot affect a
same-ID replacement. Empty command fields render plain text. Stop removes items.

`ui.registerView` accepts `placement: 'workbench' | 'left-rail' | 'library'`,
optional vector artwork and order. The latter placements receive native rail or
media-library navigation. They use the existing isolated preload/protocol/session
host. Switching tabs hides the native view and retains its page state. Each dock
lays out only its own views, including modal/menu masking, resize and keyboard
focus return. Opening a view before activation still requires a manifest view
declaration and package trust. Runtime tabs appear only during activation.

Action locations add `menu.project` and `menu.timeline`. Commands receive the
location, and timeline entries also receive the current time/range context.
Enabled state and registration-instance checks are the same as toolbar actions.

## Managed processes

`processes.spawn` accepts `output: 'capture' | 'stream' | 'both'` and
`encoding: 'utf8' | 'bytes'`. Existing calls capture text. Byte encoding returns
`Uint8Array` for captured stdout/stderr; stdin accepts text or bytes up to 1 MiB.
`process.output` is an async iterable of `{stream, data}` with exact byte chunks
up to 64 KiB. It has one consumer and one outstanding read. Capture and unread
stream queues each use `maxOutputBytes` (1 MiB default, 8 MiB maximum). Overflow
terminates the process with an error; output never silently drops. Stream-only
mode does not accumulate the complete output and returns empty captured values.

Breaking out of the iterator closes its subscription, not the process. `kill`
stops the process/tree; `result` reports its actual completion. Cancellation of a
pending read releases that read without killing an independently owned helper.
Normal process deadlines remain bounded to thirty minutes. Direct-child exit
and output-pipe close remain separate, as documented by [Node's child-process
contract](https://github.com/nodejs/node/blob/v24.22.2/doc/api/child_process.md).

`processes.startServer` adds required `ready: {url, timeoutMs?}`. The host polls a
loopback HTTP URL, refuses redirects/credentials/nonlocal hosts and waits for a
successful status while the child remains alive. The readiness deadline defaults
to ten seconds, bounded to 100 ms–60 s. Failure, cancellation or Stop terminates
the starting child. A successful result includes the endpoint URL and ordinary
process controls. The caller must choose an unused port and a readiness endpoint
belonging to its helper.

Servers default to streamed output and no execution deadline (`timeoutMs: 0`);
an optional positive deadline uses the existing bound. They remain owned by the
activation after their creating command returns. Save/export hook, managed job
and agent-edit scopes cannot create persistent helpers; start those from
activation or ordinary commands. Explicit Stop, worker failure, disable/reload
and normal application shutdown terminate managed helpers. Uncatchable OS
termination of the main process is outside this cleanup guarantee. Raw Node
subprocesses remain the author's responsibility.

## Project and media contract

`projects.status` works on Home and in the editor. Create/open require the current
`documentId` (or explicit null on Home); Save/close require an open document.
Requests serialize lifecycle changes, check extension/execution ownership and
refuse stale document lifetimes, active gestures, agent edits, exports and pending
recovery decisions. Native Open/Save pickers, JSON normalization, media relocation,
file bindings, save hooks, sidecars and durable media pins remain authoritative.
An explicit save path cannot overwrite another existing file.

Before switching, the SDK requires a successful file/slot flush and a forced
native snapshot for the open project. This protects empty, marker-only and
settings-only documents that the ordinary content-based autosave may skip.
Failed persistence refuses the switch. Closing returns to Home and retains its
slot; there is no implicit discard. Side effects already published to disk cannot
be revoked by a later cancellation. Lifecycle calls cannot run in save/export
hooks or managed agent edits.

`editor.undo({documentId,projectRevision})` checks the current document scope,
acquires a native commit reservation and mints a private history token. The reducer
checks the exact history/ownership/gesture state at application time and uses its
real Undo path. Its event origin names the requesting extension. An unavailable
Undo returns `applied: false`; a stale or stopped request cannot undo another edit.

GIF import shares the editor's animated-image semantics: decode verification,
normal artifact ownership, durable adoption and native GIF looping in export.
`captions.write` adds a default `style` and per-cue styles using `CaptionStyle`:
all builtin fonts, effects/colours, backgrounds, stroke/shadow, highlighting and
text animations. Nested overrides inherit write-level values. Validation happens
before any write; the existing cue timing, track locks, overlap rules and atomic
Undo still apply. Pack-owned font dependencies continue through their existing
creative-pack/editor-tool APIs.

## Verification and remaining work

Local macOS checks on 2026-11-18:

- The real Electron workflow passed 39 checks across an application run and cold
  restart, covering input, status, menus, native views, project preservation,
  Undo, captions, GIF adoption/export, Stop and normal-quit helper cleanup.
- Video-only decoding of the GIF export produced 16 sampled frames with 8
  distinct frames, confirming motion survived the pipeline.
- The plugin/core selection completed 137 suites: 136 passed and one settings
  smoke failed because it clicked Install while activation still disabled it.
  After adding an enabled-control wait, that suite passed its rerun across
  English, French and Spanish. Product source was unchanged after the selection.
- All nine SDK verification suites passed with an empty source-change list.
  Renderer build, structure and localization checks passed.

The exact receipts, source checksums and earlier failed runs are retained under
`extensionExpansion` in [the validation ledger](plugin-validation.json).
Main-window screenshots were inspected. Two quiet native child-view captures
returned `UnknownVizError`; direct native bounds, visibility, page-content and
interaction checks passed. This does not claim visible child-view screenshot QA.

The subsequent [open extension surfaces](plugin-open-extension-surfaces.md)
implementation covers overlays/windows/docking, broader property bindings,
custom shaders and clip/track types, native MOV/Matroska/WebM exports and custom
and native lifecycle hooks. Its evidence is separate from this earlier batch.
Installed/platform verification remains open. Current capability limits are in
[the API guide](plugin-extension-api.md#5-what-an-extension-cannot-do-yet).
No full app battery, installer, commit, push or publication was performed.
