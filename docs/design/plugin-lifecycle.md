# Bounded clip lifecycle and track placement

This pre-v1 extension keeps SDK 0.8.0, host API 1 and ClipCraft 2.0.0. It adds
`clips.manage` for explicit creation, duplication and deletion, and `tracks.write`
for appending free-track layers and placing existing clips. Both require
`editor.read`; existing permissions gain no additional writes. Older host builds
may reject the new grants while the pre-v1 support matrix remains unfinished.
Linked lifecycle
also requires `clips.links` and both returned handles.

The editor has fixed main, overlay, audio, text and effect lanes. Tracks are
numbered layers within those lanes. Only overlay/audio/text support extra layers;
main and effect remain single-layer lanes. A lifecycle transaction contains only
lifecycle operations, evaluated in order against one captured document/revision.
It cannot mix with move/trim, range, reorder, ripple, link-management, marker,
caption, AI or export proposals. Packages may declare other bounded edit grants,
but each staged transaction still follows its own operation-family rules.

```ts
import type {LifecycleEdit} from '@clipcraft/plugin-sdk';
const snapshot = await context.editor.read();
const operations: LifecycleEdit[] = [
  {type: 'create-track', trackId: 'text:1'}, // only if this is the next layer
  {type: 'create-text', trackId: 'text:1', start_sec: 2,
    duration_sec: 1, text: 'A new title'},
  {type: 'duplicate-clip', clipId: freeSound.id, trackId: 'audio:0',
    start_sec: 5, gaps: 'preserve-time', transitions: 'reject'},
];
await context.editor.stage({documentId: snapshot.documentId,
  revision: snapshot.revision, operations});
```

Choose actual returned destination tracks or explicitly create the next layer
before using it. The example assumes sufficient captured project duration and
empty destination time. Track IDs are canonical lane/index identifiers, not
plugin-defined aliases. Clip handles remain opaque and document-scoped.

## Operations and permissions

| Operation | Required grants beyond editor.read | Contract |
| --- | --- | --- |
| `create-track` | tracks.write | Append exactly the next overlay/audio/text layer using explicit trackId. |
| `create-media` | clips.manage | Returned sourceClipId, compatible destination trackId, start_sec, offset_sec, duration_sec and preserve-time/reject policies. |
| `create-text` | clips.manage | Text trackId, start_sec, duration_sec and bounded plain text. |
| `create-effect` | clips.manage | Returned effect sourceClipId, effect:0, start_sec and duration_sec. |
| `duplicate-clip` | clips.manage | Returned unlinked clipId, destination trackId on its existing lane, start_sec and preserve-time/reject policies. |
| `delete-clip` | clips.manage | Returned unlinked clipId and preserve-time/reject policies. |
| `place-clip` | clips.manage + tracks.write | Existing unlinked clip, named destination on its current lane, explicit time and preserve-time/reject policies. |
| `duplicate-linked` | clips.manage + clips.links | Both returned pair handles, pictureTrackId, audioTrackId, picture start_sec and preserve-time/reject policies. |
| `delete-linked` | clips.manage + clips.links | Both returned pair handles and preserve-time/reject policies. |
| `place-linked` | clips.manage + tracks.write + clips.links | Both returned handles, destination tracks on their existing lanes, picture start_sec and preserve-time/reject policies. |

All fields in each shape are required. Unknown fields, raw IDs/paths, arbitrary
patches and plugin-chosen clip/link IDs reject. `gaps` is exactly `preserve-time`;
`transitions` is exactly `reject` wherever those fields are present.

## Creation, duplication and resource boundaries

`create-media` uses a returned main/overlay/audio clip as a reference to its
existing project resource. `offset_sec` and `duration_sec` are timeline seconds
within that clip's current source window, respecting its positive speed. Source
media must exist and have compatible type and valid bounds. Picture resources
can create main/overlay clips; audio resources remain audio. Motion graphics
remain overlays. No file path or library media ID crosses this API.

Creation produces an independent clip with host defaults, the selected source
window and the source clip's speed. It copies neither links, pins, look/transform
settings, captions nor keyframes. Overlay media uses the host's centered default
scale (full-frame for motion graphics, half-size otherwise). Main creation keeps
the current canvas and settings. A linked resource can be read to create an
independent media clip; this does not modify or clone its partner.

`create-text` accepts nonblank plain text up to 2,000 characters, with newline/tab
support and no control bytes. Style uses the host's normal new-title defaults.
`create-effect` reuses the effect identity and saved plugin reference/parameters of a
returned effect clip, with other instance fields at their defaults. Existing effect dependencies
still need their referenced package/version. This operation cannot supply new
code, an arbitrary effect ID or an external dependency.

Duplication retains the original clip's source, speed, settings, animation,
caption timing, curves, fades and saved effect references. It generates a new
host ID and preserves the source's lane. Linked duplication creates an independent
host link ID plus two host clip IDs; both stored offsets and source windows are
preserved exactly. Shifted audio follows the new picture start, including
negative offsets when the resulting audio onset remains nonnegative.

Creating from library-only media, importing/processing files, and editing resource
or clip properties remain the separate pre-v1 service/property contracts. New
clips are not returned as target handles during this batch: read another snapshot
after commit before targeting them. A removed original handle cannot be reused
later in the same batch. Existing command surfaces still require a nonempty
captured timeline; creating the first empty-project sequence is not added here.

## Main gaps, placement and deletion

All operations preserve the main clock and marker times, regardless of magnets.
New/duplicated main clips and main placement consume existing empty gap time.
They cannot overwrite real pictures, append/extend the sequence, retime unrelated
pictures, change transition boundaries or normalize other gaps. Consumed gaps may
be replaced by new host-owned head/tail pieces; partial retained gaps must be at
least 0.1 seconds. Whole neighboring gap records may be consumed together.

Main deletion replaces the shot with a new explicit gap of the same visible
length. Main placement leaves a gap at the source before consuming destination
gap time. Linked main operations additionally remove/duplicate/place the explicitly
named audio companion. Incoming, outgoing and dormant transition records reject
incompatible deletion, copying or placement. No transition-clearing policy exists.

Free deletion never ripples or removes its layer. Placement preserves source and
other clip fields, and keeps the clip's lane while changing its named layer/time.
Unlisted free clips, link groups, markers and settings stay fixed. No automatic
collision resolution or relayering is allowed. A destination may be an existing
returned track or an explicitly appended layer created earlier in this batch.

Track creation appends one default layer, without renaming, shifting, deleting
or reordering existing tracks. It refuses pre-existing state on the unused index.
An empty new layer is a real undoable document change even with zero clip edits.
Undo of individual placement keeps track toggles on their original tracks;
structural native track reorder continues to remap them. Undo removes toggles
on a disappearing appended layer, preventing invisible locks on future layers.

## Validation, limits and receipts

The private planner checks original bindings, full-project topology and omitted
members, source bounds, destination existence, both pair locks, collisions,
motion-pin dependencies and actual main timings. It preserves untouched link
groups from incidental source-window repairs. The prepared-array mechanism may
also carry privately validated `layers` counts; external JSON cannot mint its
tokens or arbitrary project fields.

- At most 64 operations and 64 affected clip/track records per transaction.
  Deleted originals, consumed gaps, new fragments/clips and created layers count.
- At most eight appended layers per transaction and 128 total projected tracks.
  A requested destination index is below 128; full private counts are authoritative.
- Created/duplicated media windows retain at least 0.1 seconds, remain within
  source bounds and stay inside the original captured project duration.
- Both source and destination locks apply. Pins on copied/placed clips and
  dependencies on deleted/changed sources reject. Neither side is silently unlinked.
- Clips and links receive host-owned IDs reserved across all existing namespaces.
- Real commit reports `clips_changed` and optional `tracks_changed` to panels and
  CraftAI. Settings displays both counts. A track-only edit reports zero clips,
  its actual created-track count, one Undo step and `changed:true` to CraftAI.

Native per-run confirmation names the new grants with Cancel as default. Exact
fingerprint, owner/revision, single-use authorization, revocation and private
commit receipts remain required. Settings, menus, allowlisted panel commands and
CraftAI use the same transaction path. Refusal, Stop, worker failure, stale
context, panel closure and package revocation discard the whole staged batch.
A no-op placement creates no history. Undo/Redo retain new IDs and saved edits
remain ordinary project data independent of the command package. Existing
rendering dependencies retain their usual package/version requirements.

## Verification

The retained `clipLifecycle` entry in [plugin-validation.json](plugin-validation.json)
records contract/native/SDK checks, real Electron acceptance, fresh-process
reopening and source-frame/tone exports. These are selected macOS development
checks with scripted native approval and hidden windows. They do not certify
installed release artifacts, Windows/Linux, foreground focus, large-project
performance or v1 readiness. Remaining pre-v1 capabilities and release gates
remain open; no version increment, installer, publication, commit or push is
part of this extension.


The fixed-candidate run passed 71 selected suites. The contract suite passed
59 checks including 108 independent-oracle source/placement cases; native
runtime passed 75 checks and panel receipts passed 31. Hidden Electron
acceptance passed 37 checks plus 11 after a real process restart, with zero shown
test windows and zero recorded renderer exceptions in each phase. The 12-second
export sampled the created main window at source times 1.25/1.75 seconds with
mean absolute channel errors 2.578125/2.618634 against a threshold of 12.
The shifted-pair tone measured 546.67 Hz and duplicated/placed sound measured
326.67 Hz (expected 550/330 Hz, tolerance 20 Hz). Active RMS exceeded
.01; the deleted pair's former position had zero RMS. Restart exports reproduced
these measurements. SDK/renderer builds and structure/whitespace checks passed.


[Picked media jobs](plugin-media-jobs.md) now import/process one user-picked source
into the library as a separate guarded Undo action. They do not expand lifecycle
`sourceClipId` into arbitrary library IDs or implicitly insert timeline clips.
