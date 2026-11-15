# Read-only editor context

SDK 0.5.0 additionally exposes optional `main: {index, transition, overlap_sec}`
on main clips and `timeline.main_total`. The transition flag includes dormant
incoming records, while overlap reports actual timing. Lists remain bounded
and selection-first; sort by main index. These fields support
[main-track reordering](plugin-main-reorder.md) without exposing expressions.

SDK 0.2.0 adds the optional `editor.read` permission to host API 1. Existing
project summaries and installed plugins keep their existing contracts. Panel
approval and command approval explicitly describe access to selection, playback
and timeline metadata. Panel and command grants are independent.

`editor.read()` returns a versioned snapshot with a document-scoped opaque ID,
monotonic revision, playhead, selected clip handles, and bounded tracks/clips.
Handles survive ordinary edits and Undo in the same loaded document; opening any
document, including reopening the same project, resets their scope. They are
references for read-only correlation, not mutation targets.

Clips expose only their handle, track, start/end seconds and gap flag. Tracks
expose lane, layer and lock/hide/mute/solo state. Names, source identifiers,
paths, URLs, text/captions, expressions, media bytes and provider data are omitted.
At most 256 clips, 128 tracks and 64 selected handles are returned, with explicit
totals. Selected clips take priority. Returned clips always reference returned
tracks, and returned selections always reference returned clips. Totals can
exceed returned lengths; this API is not full-project serialization.

Panels subscribe with `editor.onChanged(callback)`. Each event contains the latest
snapshot and a `changes` array (`timeline`, `selection`, `playhead`). The owner
samples at most ten times per second while an approved panel is open; unchanged
snapshots produce no event. Intermediate playback positions may be skipped.
Callbacks are not a render clock. Read after subscribing to obtain initial state.
Subscription disposal is idempotent and SDK client disposal removes all listeners.
Closing, disabling, development reload, document replacement and app teardown
destroy the panel generation and stop its events. Native validation rejects
cross-document or stale revisions. Commands receive a frozen-at-start snapshot
and no subscriptions; existing stale-project cancellation still applies.

Implementation steps:

1. Add a canonical strict snapshot schema and a renderer projection using the
   editor's actual timing/layer helpers. Cache timeline projection between edits.
2. Gate native panel reads/events and command snapshots on `editor.read`; extend
   consent text without granting mutation or privileged editor IPC.
3. Add SDK types, capability detection and lifecycle-aware subscriptions. Keep
   host API 1 and report unsupported optional editor APIs on older hosts.
4. Verify strict limits, sensitive-field exclusion, document scopes, transitions,
   subscriptions, permission denial and frozen command context in unit checks.
5. Compile a typed SDK fixture and exercise real selection, seek/playback, edits,
   Undo, close/reopen and document replacement in hidden Electron. Verify no
   context read changes project history and no test window is shown.

Edit transactions, UI registration, source/media access and plugin rendering
hooks remain later stages.

SDK 0.7.0 adds optional opaque `link: {groupId, partnerId, members_total}`
metadata. Group counts include unsupported members; a null partner means there
is no returned supported partner. Selected partners get priority within existing
bounds. Native validation checks reciprocal handles, topology and consistent
counts. Private raw link bindings remain renderer-only. See
[linked transactions](plugin-linked-edits.md) for explicit write authority.
