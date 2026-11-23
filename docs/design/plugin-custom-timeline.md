# Custom clip and track types

Packages declare `contributes.trackTypes` and `contributes.clipTypes`. Installed
types receive fingerprinted IDs; projects save IDs and typed JSON data, never
extension code or temporary rendering inputs. API changes are allowed during
pre-alpha.

## Definitions and rendering

A track declares `id`, `name` and `kind: 'visual' | 'audio' | 'metadata'`.
Optional `color` is a six-digit hex color; `height` is 40–160 pixels.
A clip declares `trackType`, referring to a track in the same package, and one
render recipe:

- `{kind: 'shader', effect, parameters?}` uses a same-package GLSL effect.
  `parameters` maps effect parameter IDs to root numeric data properties. With
  no media source, the input is a host-owned transparent image rasterized at
  project dimensions. A supplied source uses its ordinary native media path.
- `{kind: 'media'}` requires an existing project media ID and uses native visual
  composition or audio mixing, according to the track kind.
- `{kind: 'none'}` stores timed metadata and is valid only on metadata tracks.

Both definitions accept an object `schema`, `defaults` and root-property
`labels`. Schemas support JSON objects, arrays, strings/enums, finite numbers,
integers, booleans and null. Defaults must satisfy the schema. Clip definitions
can also set `color` and a string `labelField` for their native timeline label.
Packages may declare 32 track and 64 clip types.

Custom visual tracks compose above ordinary picture overlays in their declared
order. Audio tracks use native mixing and mute/solo behavior. Metadata produces
no pixels or audio and does not extend export duration. Hidden or disabled AV
items preserve their timeline extent. Shader time follows source offset and
speed through split, trim and range export. Player, hidden frame composition
and export share the same render projection.

## Editing API

`timeline.types({kind?, pluginId?, cursor?, limit?})` discovers installed types.
Use returned `typeId` values rather than constructing fingerprinted IDs.
Catalog pages allow up to 64 items; document pages allow up to 128. Both replies
are bounded to 256 KiB.

```ts
const types = await context.timeline.types({pluginId: context.extension.id});
const track = types.items.find(type => type.category === 'track');
const clip = types.items.find(type => type.category === 'clip');
if (!track || !clip) throw new Error('Required custom types are missing');
const scope = await context.timeline.read({section: 'clips'});
const trackId = crypto.randomUUID();
await context.timeline.apply({
  documentId: scope.documentId,
  projectRevision: scope.projectRevision,
  operations: [
    {type: 'create-track', id: trackId, typeId: track.typeId},
    {type: 'create-clip', id: crypto.randomUUID(), typeId: clip.typeId,
      trackId, start_sec: 0, duration_sec: 2},
  ],
});
```

The track and clip types must belong to the same package fingerprint and match
the declared `trackType`. Choose the intended pair when a package declares more
than one type. The [SDK workbench](../../examples/extensions/sdk-workbench/README.md)
contains a runnable shader scene command.

`timeline.read({section: 'tracks' | 'clips', trackId?, ...scope})` returns typed
saved rows and the current document/revision. Continue pages with that exact
scope. `timeline.apply` accepts 1–64 operations in one atomic Undo step:
create/update/delete/move track, and create/update/delete/duplicate/split clip.
Data patches merge by default; `replaceData: true` replaces the complete object.
The editor refuses stale revisions, active native gestures, locked targets,
invalid data, unavailable types and out-of-bounds source windows before commit.
These edits also join the private draft inside native save/export preparation,
including nested custom hooks. Validation phases remain read-only; failed or
canceled preparation publishes none of its custom edits.

A project permits 64 custom tracks and 1,000 custom clips, with at most 64 KiB
per data object and 4 MiB for the custom timeline. Clip durations are 0.02–86,400
seconds; speed is 0.25–4. Source and timeline positions are nonnegative. Entity
IDs are unique across native and custom rows.

## Native controls and persistence

Custom rows use native clip selection, drag, trim, split, duplicate and delete.
The inspector edits timing, source offset, speed, opacity, transform and typed
data. Nested arrays and objects use expandable native forms; Apply commits a
data draft once. Track controls support rename, reorder, locking, visibility,
mute and removal. Native track flags survive Undo/Redo as ordinary editor guard
state does.

Save, autosave and reopen preserve custom rows and exact type dependencies.
Missing definitions preserve saved data, show a player error and block export.
Reinstall the exact package, or explicitly disable/remove the affected clips.
Disabling preserves timing and data; it does not silently substitute a renderer.

Verification receipts are retained under `extensionCustomTimeline` in the
[validation ledger](plugin-validation.json). Local tests use real Electron,
actual GPU composition and decoded native export bytes. Pointer automation uses
DOM events; it does not establish operating-system pointer or focus behavior.

## Local verification

The macOS native workflow passed 25 checks and 3 cold-restart checks.
These cover native typed/nested property editing, dragging/trimming, stale
revision and gesture refusal, locks through Undo, save/reopen, transparent
shader composition, range export, actual audio mixing/mute and missing-type
errors with explicit bypass. The main-window screenshot was inspected.

The plugin/core regression selection ran 143 suites: 141 passed;
the custom native and showcase fixtures initially failed. Correcting the
FFmpeg seek literal and the expected contribution categories made both reruns
pass. The native workflow passed again after inspector button wrapping.
All 9 SDK verification suites passed with no source changes. Renderer,
structure, localization and whitespace checks passed. Installed/platform testing
and the remaining property/export/hook work stay open in the
[scope tracker](plugin-open-extension-surfaces.md).
