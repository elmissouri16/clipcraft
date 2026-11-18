# Bounded speed, source curves and effect editing

This pre-v1 extension keeps SDK 0.8.0, host API 1 and ClipCraft 2.0.0. It adds
three command grants, each requiring `editor.read`:

- `clips.retime`: playback-rate edits at fixed timeline duration.
- `clips.automation`: replace or clear source-time picture/volume curves.
- `clips.effects`: attach, update, remove and reorder existing effect resources.

Existing `clips.properties` and other edit permissions gain no new authority.
Older host builds can reject these grants; the v1 support matrix remains open.
Source-automation transactions contain only the operations in this contract,
evaluated in order. Static properties, lifecycle, ripple, range, marker, AI and
export jobs cannot mix into the same batch. Packages may declare compatible
bounded edit grants, but each operation still checks its own permission.

```ts
import type {ClipAutomationEdit} from '@clipcraft/plugin-sdk';
const snapshot = await context.editor.read();
const operations: ClipAutomationEdit[] = [
  {type: 'set-speed', clipId: picture.id, partnerClipId: sound.id,
    speed: 2, timeline: 'preserve-time', source: 'within-media',
    automation: 'preserve-source'},
  {type: 'set-keyframes', clipId: picture.id, partnerClipId: sound.id,
    property: 'opacity', timebase: 'source', points: [
      {source_sec: 0, value: 0.25, easing: 'linear'},
      {source_sec: 8, value: 0.75, easing: 'linear'},
    ]},
];
await context.editor.stage({documentId: snapshot.documentId,
  revision: snapshot.revision, operations});
```

The example assumes returned complete picture/audio handles, a four-second
picture with source in-point zero and sufficient source media for the requested
speed. Unlinked operations require `partnerClipId:null`. Linked operations also
require `clips.links`, both returned handles, whole private topology and both
locks. A speed edit updates both named members; other operations affect only the
named target. Neither selection expansion nor a previous pair declaration
implicitly grants collateral writes.

The public snapshot remains bounded handles/timing metadata, not a full clip,
curve, effect-list or source-file read API. Authors supply explicit values and
known current slot indexes. No operation accepts a raw media/effect ID, file
path, new package reference, arbitrary patch or shader expression.

## Fixed-duration speed

`set-speed` requires speed 0.25–4 and all three explicit policies shown above.
It preserves each clip's start and timeline length. Source in-points stay fixed;
new source out-points are `in + duration * speed`. This may extend or crop the
previous source window, but never beyond the existing media's bounds.

For a complete shifted pair, both members use the picture's timeline length
and the same new speed. Independent source in-points, stored timeline/source
offsets and exact pair identity remain intact. The audio source window changes
with its picture rather than drifting to a new start. An audio-initiated pair
operation has the same picture-relative meaning.

Main sequence order, duration, overlap, gaps, transitions, free-track positions
and markers remain unchanged. The host rechecks the full main layout after the
batch; no implicit ripple, gap filling or transition clamping is permitted.
Timeline fades and their sliced offsets stay unchanged. Existing source-time
keyframes, volume automation, effects and other clip fields are retained.

Changed speed needs actual moving video/audio media with enough remaining
source. It rejects still images, motion-graphic sources and active enhanced-audio
caches that would need separate managed reprocessing. A same-speed no-op makes
no edit. This contract does not add reverse playback, ramps or source-window-
preserving duration changes; those cannot be inferred from a speed value.

## Source-time curves

`set-keyframes` takes a property, `timebase:'source'` and a complete replacement
`points` array. Empty points explicitly clear that one curve. Other curves and
static base values are preserved. Clearing an absent curve is a no-op.

Picture properties are scale (0.05–4), x/y (-2–2 frame fractions), rot (-180–180
degrees) and opacity (0–1). Main/overlay picture targets support these curves.
Volume (0–2) requires an actual sound-capable main/overlay/audio resource.
Text/effect clips have no curve API in this slice.

Each point has exactly `source_sec`, `value` and `easing`. Source times must be
finite, increase by at least one microsecond and lie inside the target's current
source window. Picture easing supports linear, in, out, inout and continuous.
Continuous uses the existing monotone interpolation; arbitrary easing code and
overshoot presets are not accepted. Volume curves use linear easing only.

Host storage uses the editor's existing source-time curve representation.
Volume continues multiplying the clip's static volume and edge fades. Speed
and curve order matters: a curve after a speed edit may use the new source
window; an earlier curve cannot assume a future window. A later speed change
retains curves in source time, including points outside its newly cropped
window, just as existing trim operations do. It never rewrites those points.

## Existing effect slots and resources

Effect operations use zero-based indexes into the current ordered picture
`effects` array. Free-effect targets use `effectIndex:null` for `set-effect`.
Indexes are evaluated after earlier operations in the same transaction. There
may be at most 32 unique attached effects; malformed or ambiguous slots reject.

| Operation | Fields beyond clipId/partnerClipId | Behavior |
| --- | --- | --- |
| `attach-effect` | sourceClipId, beforeIndex, strength, params | Copy the identity/reference of a returned free-effect resource into an explicit picture slot. |
| `set-effect` | effectIndex, enabled, strength, params | Set the current slot's bounded strength and validated parameters, or update a free effect. |
| `remove-effect` | effectIndex | Remove one attached effect and its own saved parameter/strength/region entries. |
| `move-effect` | effectIndex, beforeIndex | Move the existing effect to that final index; keep its metadata unchanged. |

For attachment, `beforeIndex` can append at the current list length. For moving,
it is the final index after removing the original item. Same-index moves are
no-ops. Attachment refuses a duplicate effect identity and never chooses an
automatic slot. The returned free-effect source is read, not removed or retimed.
Its identity and saved plugin parameters are reused; region and other instance
fields are not implicitly copied. The destination strength is explicit.

Strength is 0–1. Built-in effects and known filter resources support strength
with `params:{}`. Plugin parameters are partial numeric updates validated against
the exact installed definition, including known keys and declared ranges. Existing
unmentioned parameters remain; no operation chooses a new shader or silently
upgrades a package fingerprint/version. Empty/default-equivalent updates produce
no record change where the stored canonical values already match.

Disabling an attached effect sets its strength to zero. Disabling a free effect
sets its clip disabled flag; enabling it clears that flag. Plugin instance
bypass flags are cleared only when a valid exact definition is available for
an explicit update/enable. A broken plugin effect can still be disabled with
empty parameters or removed, without looking up a replacement definition.
New attachment or parameter updates require the exact available dependency.
Existing rendering dependencies retain their normal package/version requirements.

Effect preparation captures the renderer's catalog revision. A private reducer
commit guard rejects an effect plan after that catalog changes, including a
revoke/restore cycle. Command approval is not authority to keep using an old
catalog. This supplements the command's package/owner/revision cancellation
and single-use native authorization checks.

## Limits and atomic commit

At most 64 operations and 64 changed clip records are allowed. A linked speed
edit counts both changed members. Repeated operations on a record count it once.
Each curve has at most 64 points and a transaction may supply at most 256 points
total. Effect parameters have at most eight finite numeric entries, bounded
further by their installed definition; effect expressions remain host-owned.

The private planner checks exact original bindings, omitted group members,
source bounds, positive speeds, locks, dependencies and the actual main clock.
A changed clip with a motion pin, or a pinned follower depending on it, rejects
without implicit pin repair. Preserved-link tokens keep incidental normalizer
repairs from changing source windows or unnamed partners.

Settings, registered menus, allowlisted panel commands and CraftAI share this
path. Native per-run consent names the separate capabilities and defaults to
Cancel. Successful edits have one Undo step, with actual `clips_changed` receipts.
No-ops have none. Refusal, worker failure, Stop, stale context, panel closure,
command revocation and effect-catalog changes discard staging before commit.
Undo/Redo and native save/reopen retain exact source windows, curves and effect
references. Reopening never replays command code.

## Verification and boundaries

The `sourceAutomation` entry in [plugin-validation.json](plugin-validation.json)
retains unit/native/SDK evidence, hidden Electron workflows, actual moving-source
and tone exports and a real process restart. The fixture uses a separate installed
effect resource package; after restart the command package stays disabled while
the required rendering dependency remains enabled. This distinguishes command
persistence from effect dependency availability.

These are selected macOS development checks with scripted native consent and
hidden windows. Installed release artifacts, Windows/Linux, foreground focus,
large-project performance and the other pre-v1 capabilities/release gates remain
open. No SDK/application version increment, installer, publication, commit or
push is included.


The fixed-source run passed 83 selected suites. The contract suite passed
55 checks including 135 generated independent-oracle combinations; native
runtime passed 119 checks. Hidden real-app acceptance passed 38 checks and
12 after restart, with zero shown test windows and zero recorded renderer
exceptions. The preview used playback rate 2 and opacity 0.4375 at the
retimed source position, with source-frame mean absolute error 2.872685.
The unchanged eight-second export compared retained source frames with errors
2.171875/2.313730 against a threshold of 12. The parameterized moving overlay
measured [0, 157, 0]/[0, 157, 1] at its two requested positions, with
red control pixels outside it. Retimed linked tone samples identified
330/770 Hz at their new source positions with volume RMS
0.039110/0.064084/0.089094; the independent slow sound
retained its location and source curve with RMS 0.064877. The pre-onset
sample had zero RMS. Restart exports reproduced these measurements. SDK/renderer
builds and structure/whitespace checks passed.
