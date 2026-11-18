# Static plugin clip properties

This first property-editing slice keeps SDK 0.8.0, host API 1 and ClipCraft 2.0.0.
`clips.properties` requires `editor.read`. Existing move, range, lifecycle, ripple
and pair grants gain no property-write authority. A property transaction contains
only property operations, with at most 64 operations and 64 changed records.

```ts
import type {ClipPropertyEdit} from '@clipcraft/plugin-sdk';
const snapshot = await context.editor.read();
const picture = snapshot.timeline.clips.find(c =>
  c.trackId.startsWith('overlay:') && !c.link && !c.gap);
if (!picture) throw new Error('Select an unlinked overlay picture.');
const operation: ClipPropertyEdit = {
  type: 'set-transform', clipId: picture.id, partnerClipId: null,
  transform: {scale: 0.5, x: 0.25, rot: 90},
};
await context.editor.stage({documentId: snapshot.documentId,
  revision: snapshot.revision, operations: [operation]});
```

The snapshot remains the existing bounded selection/timeline projection; it does
not expose a full clip object, current caption words, style or source paths.
Authors supply absolute typed values. Older host builds may reject the new
permission while the pre-v1 support matrix remains unfinished.

## Target and partner scope

Every operation requires `clipId` and `partnerClipId`, including explicit `null`
for unlinked targets. A linked picture/audio target additionally requires
`clips.links` and the other returned handle. The host verifies the whole private
group, exact source/timeline offsets, equal speed/duration and both locks,
including members omitted from the public slice. Missing, duplicate or ambiguous
private clip identities reject. A gap is never a property target.

Partner declaration grants validation scope, not an implicit partner write.
Only the named target receives its requested properties. Picture/audio source
windows, offsets, speed, track placement, duration, transitions, marker timing,
other clips and layer states remain unchanged. Untouched links are protected
from incidental source-window repairs through the private prepared-array path.

## Typed operations

| Operation | Targets | Required payload |
| --- | --- | --- |
| `set-text` | Text clips | `text`, `measuredWords:'reject'|'invalidate'` |
| `set-text-style` | Text clips | Nonempty typed `style` object |
| `set-transform` | Main/overlay pictures | Nonempty typed `transform` object |
| `set-opacity` | Main/overlay pictures or text | `opacity` from 0 to 1 |
| `set-audio` | Actual sound-capable main/overlay/audio media | Nonempty typed `audio`, `fadePolicy:'replace-edges'` |

Unknown fields, arbitrary patches, raw IDs/paths and nested extra properties
reject. Each payload is validated by the same canonical schema in the SDK and
host, followed by private project validation. No operation accepts source,
timing, link topology, layer, track, effect, keyframe or animation mutations.

### Text and style

Text is nonblank plain content up to 2,000 characters. Newline/tab are supported;
control bytes are refused. Changing measured caption wording with `reject`
fails the full transaction. With `invalidate`, the existing editor timing helper
clears measured words and marks timing estimated. Same wording preserves the
measurement and creates no edit. Style-only writes keep measured words intact.

The bounded style fields are:

- Font: bundled `montserrat`, `poppins`, `anton`, `oswald` or `roboto`. Other
  existing fonts remain untouched; this API cannot load a font or URL.
- Size: 8–600; bold, italic, underline and uppercase: booleans.
- Color: six-digit `#RRGGBB`; align: left, center or right.
- Letter spacing: -10–50; line height: 0.5–3; maximum width: 0.05–1.
- Text x/y: -1–2 frame fractions; rotation: -180–180 degrees; opacity: 0–1.
- Stroke: width 0–24 and hex color.
- Shadow: on, hex color, blur 0–100, x/y -100–100 and opacity 0–1.
- Background: on, hex color, opacity 0–1, radius 0–100, padding 0–2 and
  mode block/line.

Nested objects are partial typed edits. The host merges them with the effective
current style so unmentioned settings and legacy outline/background defaults
retain their existing appearance. Empty nested objects reject. Existing text
animations, highlights and other unsupported style fields remain intact.

### Picture geometry and opacity

Transform fields are scale, scaleX and scaleY (0.05–4), uniform (boolean), x/y
(-2–2 frame fractions measured from the centered picture) and rot (-180–180
degrees). Text uses its own style coordinates and rotation field instead.
Unspecified transform properties remain unchanged. Opacity is 0–1.

A changed static property with an existing curve for that property rejects;
the host never silently erases keyframes or claims to override an animated
value. Unrelated curves remain byte-for-byte intact. Existing edge animations
continue composing with the static base. Changing keyframes or speed uses the separate
[source-automation contract](plugin-automation.md).

### Audio, mute and fades

Audio fields are volume (0–2), muted (boolean), fadeIn_sec and fadeOut_sec
(0–5 seconds, each no longer than the target clip). An image or silent video
cannot receive audio writes. Volume scales the existing source-time volume
curve; the curve is neither removed nor replaced.

`fadePolicy:'replace-edges'` explicitly restarts only the requested fade edge at
the current clip boundary. Its sliced offset resets to zero. Unmentioned edge
durations and offsets remain unchanged. Requesting the same fade duration can
therefore be a real edit when it resets a prior trim offset. Both edges may
overlap and multiply, following the existing audio engine. No source extension,
retiming, normalization or partner muting happens implicitly.

This slice also fixes an existing export inconsistency: preview honored the
free-audio clip's mute flag, while the video and audio-only export mixers still
included it. The shared render projection now omits muted free audio without
changing the saved project, and both raw export builders independently skip
muted inputs. Direct measured video/audio-only regressions retain an unmuted
control tone while removing the muted tone.

## Commit, no-ops and safeguards

The planner verifies exact original bindings and main metadata, valid resources,
source windows, whole private groups and locks. Pins on changed clips or omitted
followers reject the whole transaction. No UI relayering or timeline collision
resolution is invoked because positions and lengths never change.

Repeated operations are evaluated in order, but a record counts only once in
`clips_changed`. Effective-default and net no-ops create no history. A successful
batch has one Undo step; Undo restores measured words and all previous property
values, and Redo restores the exact result. The receipt is derived from committed
host state, never a plugin's message.

Settings, registered menus, allowlisted same-package panel commands and CraftAI
share the normal native consent and ownership path. Confirmation names the new
grant and defaults to Cancel. Refusal, Stop, stale revisions/project changes,
worker failure, panel closure and package revocation discard staged writes.
Saving/reopening does not replay the command or require its package enabled.
Existing rendering dependencies retain their usual package/version requirements.

## Verification and remaining scope

The `staticProperties` entry in [plugin-validation.json](plugin-validation.json)
retains contract/native/SDK checks, hidden real Electron workflows, fresh-process
persistence, actual preview pixels and text/geometry/audio exports. A native
macOS screenshot is tagged Display P3; its embedded profile is converted to sRGB
with ColorSync before applying the original pixel thresholds. Original and
converted captures remain available. No comparison threshold is relaxed.

These are selected macOS development checks with scripted native approvals,
not installed-release, Windows/Linux, foreground focus or performance certification.
Speed, keyframe and effect-slot editing now have a separate
[source-automation contract](plugin-automation.md). Other capabilities and release
gates remain open. No version increment, installer,
publication, commit or push is included.


The fixed-source run passed 78 selected suites. Contract checks passed
43 cases including 240 generated independent-oracle combinations; native
runtime passed 86 checks. The public SDK-built real-app fixture passed
36 checks and 13 in a fresh process, with zero shown test windows and zero
recorded renderer exceptions. The six-second export sampled transformed red/
green pixels at [125, 0, 0]/[0, 189, 0] (targets [128,0,0]/[0,191,0], tolerance
16 per channel). Preview/export detected 404/454 blue title pixels in the
requested region, with none in the excluded region. Active tone RMS measured
0.062425 against a 0.0625 target, with a 550 Hz tone. Fade-in/out RMS
ratios were 0.152867/0.350721; pre-onset and muted samples had zero RMS. Restart
exports reproduced the measurements. SDK/renderer builds and structure/
whitespace checks passed.
