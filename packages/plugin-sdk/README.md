# ClipCraft plugin SDK

`@clipcraft/plugin-sdk` **0.7.0** targets **host API 1** and ClipCraft **2.0.0+**.
It is a local development package in this repository; it has not been published
to npm. SDK version, plugin package version and manifest `apiVersion` are separate.

## Start a plugin

From the ClipCraft repository, install the SDK's pinned tools and build its distribution:

```sh
npm install --prefix packages/plugin-sdk --ignore-scripts
npm run sdk:build
node packages/plugin-sdk/dist/cli.cjs create /tmp/my-plugin \
  --id studio.my-plugin --name "My plugin" --publisher "Studio" --template panel
```

Then, from the generated project:

```sh
npm install --ignore-scripts
npm run check
npm run build
npm run validate
npm run pack
```

Install **dist/** through ClipCraft Settings → Plugins → Developer mode → Load
folder, or install the generated `.tgz`. The project root contains development
files and cannot be installed directly. The scaffold points to the local SDK
installation; keep that location available, or share a built SDK tarball and update
the dependency. Registry installation will require a separately published SDK.

Available templates: `panel`, `command`, `effect`, `transition`, `export-preset`,
`ai-provider`. Templates are minimal extension starting points; they do not run
commands or make connections on installation. The panel/command starter makes no
project edits. Provider metadata is declarative; configure a real destination/model
before use. Every contribution still passes the editor's exact validators.

## Project layout

```text
plugin.json           API 1 manifest; source of truth for permissions/contributions
src/commands.ts       optional command entry; must export run
src/panel.ts          optional panel entry; uses the isolated SDK client
src/panel.html        optional panel HTML, external script and style only
src/panel.css         optional panel stylesheet
package.json          author-only dependencies and scripts
tsconfig.json        editor language-service configuration
dist/                 generated installable payload; no dependencies or source maps
.clipcraft-build.json SDK ownership/fingerprint record; outside the installable payload
```

The CLI checks required TypeScript entry files with fixed strict settings, ES2022,
and the correct DOM or WebWorker library. Its check cannot be bypassed by changing
`include`/`exclude` in tsconfig. Additional imported source is checked and bundled.
The generated tsconfig provides editor completion; arbitrary tsconfig transforms,
compiler plugins and source-entry overrides are not a supported build extension.
Type checking uses the pinned TypeScript 7 native CLI; keep its platform-specific
optional dependency installed. Standalone JavaScript validation uses Acorn rather
than the removed TypeScript JavaScript compiler API.
Declare every runtime asset in plugin.json. Only the fixed declared root files are
emitted. Commands are bundled ESM; panel scripts are bundled IIFE. Dependencies
must be browser-compatible and fully bundled; Node imports and unresolved imports
fail the build. Build/validation do not execute authored modules or package scripts.

## CLI

```sh
clipcraft-plugin --help
clipcraft-plugin --version
clipcraft-plugin check .
clipcraft-plugin build .
clipcraft-plugin watch .
clipcraft-plugin validate dist --json
clipcraft-plugin inspect dist --json
clipcraft-plugin validate plugin.clipcraft-plugin.tgz --app-version 2.0.0
clipcraft-plugin pack dist a-new-output.clipcraft-plugin.tgz
```

`--json` returns `{ok:true,...}` or `{ok:false,error:{code,message,details?}}`.
Failures exit nonzero. Watch emits newline-delimited build/error events and stays
alive after a failed build. Stop it with Ctrl-C. It watches `src/` and the manifest,
not installed packages or dependencies under node_modules. It never launches an
editor, grants permission or bypasses package identity checks.

A build publishes only after compilation and canonical validation pass. It refuses
to overwrite an unowned/modified dist directory. A successful build records ownership
outside dist; keep `.clipcraft-build.json` for subsequent local builds. Do not edit
dist by hand. Packaging writes a new archive from validated byte snapshots and
refuses an existing destination. It preserves plugin version and fingerprint.

**Increment plugin.json version before installing changed bytes.** Watch warns
`VERSION_REUSED` if local bytes change under the same version. It supports author
iteration, not live mutation of an installed immutable snapshot. For command/panel iteration, use **Settings → Plugins → Developer mode → Start
session** and choose the built source project or its dist folder. **Reload snapshot**
captures changed bytes without installing or bumping the package version. **Watch
compiled builds** pairs with the SDK watch command. Each generation still needs
fresh approval before execution, and reload closes its old panel. The Settings
session log shows lifecycle records, worker/panel console messages and errors.
Session preferences are temporary and separate from installed-plugin preferences.
End the session when finished. Static rendering/provider contributions continue
using normal installation, so temporary dependencies cannot enter saved projects. Stored panel preferences belong
to the exact package fingerprint and panel, so new versions start with empty data.

## Commands

```ts
import {defineCommand, type CommandContext} from '@clipcraft/plugin-sdk';

export const run = defineCommand({
  async run(context, input) {
    await context.progress(1, 'Ready');
    return {message: 'Completed.'};
  },
});
```

A function is also accepted: `defineCommand(async (context, input) => { ... })`.
A handler map dispatches by the host's `context.command.id` and rejects undeclared
handler IDs. A manifest declares command IDs and typed numeric/enum parameters;
the host validates and supplies defaults before calling run. Command context methods
are promise-based. Type availability does **not** grant permission. Staged proposals
are not committed edits; only the host can approve/apply them and report the result.
There is no command lifecycle beyond one invocation: the host terminates its worker
on completion, cancellation, timeout or revocation. No persistent background daemon,
Node, filesystem, network, direct reducer or editor API is provided.

## Panels and lifecycle

```ts
import {connectPanel, PluginError} from '@clipcraft/plugin-sdk';

const client = await connectPanel();
console.log(client.info.apiVersion, client.info.commands);

if (client.supports('project.read')) {
  const summary = await client.project.read();
  const off = client.project.onChanged(summary => { /* render plain data */ });
  off();
}
if (client.supports('storage.local')) {
  await client.storage.set('preferences', {density: 'compact'});
  const preferences = await client.storage.get('preferences');
}

// Bind synchronously to a trusted click; keep UI disabled until connected.
button.addEventListener('click', async () => {
  const result = await client.commands.run('run', {});
  // Only status=completed includes the host-verified markers_added count.
});
client.commands.onProgress(({phase, progress}) => { /* update status while pending */ });
window.addEventListener('pagehide', () => client.dispose(), {once: true});
```

`connectPanel({signal})` supports AbortController-based cleanup. Connect once per
panel opening. `dispose()` unsubscribes registered callbacks, rejects further calls
and requests cancellation only if this client started a pending action. Explicit
unsubscribe functions are idempotent. Progress is delivered only while this client
has a pending action; late progress does not replace its settled result. In-flight results are rejected after disposal;
already accepted writes/commits are not undone. `client.info` is a snapshot. Host
boot data is private; the SDK never exposes IPC, tokens, source, credentials or paths.
Do not call `connectPanel` for every click. The trusted-click permit lasts 1.5 seconds;
do not await unrelated work before commands.run. The main process still owns consent.

Stable SDK errors: `MANIFEST_INVALID`, `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`,
`HOST_UNAVAILABLE`, `API_MISMATCH`, `PERMISSION_DENIED`, `HOST_REJECTED`, `DISPOSED`,
`BUSY`. Existing host errors become `HOST_REJECTED` with the host's bounded message;
the SDK does not guess machine-readable host codes from localized strings. Inspect
`error instanceof PluginError` and `error.code`, not message substrings.

## Read-only editor context

Declare `editor.read` in the panel's permissions or the package's command
permissions. These grants are separate and appear in native consent. SDK 0.2.0
keeps manifest API 1; older hosts can lack this optional capability.

```ts
const panel = await connectPanel();
if (panel.supports('editor.read')) {
  // Subscribe first, then read initial state. Ignore older revisions when rendering.
  let revision = 0;
  const render = (snapshot: import('@clipcraft/plugin-sdk').EditorSnapshot) => {
    if (snapshot.revision <= revision) return;
    revision = snapshot.revision;
    // Render selection.clipIds, playhead and timeline metadata as plain data.
  };
  const off = panel.editor.onChanged(({changes, snapshot}) => render(snapshot));
  render(await panel.editor.read());
  // off() or panel.dispose() removes the subscription.
}

export const run = defineCommand(async context => {
  const snapshot = await context.editor.read(); // Requires command editor.read.
  // This snapshot is captured before the native permission prompt, with no events.
});
```

Snapshots contain `version: 1`, an opaque `documentId`, monotonic `revision`,
`playhead: {time_sec, playing}`, `selection: {clipIds, total}`, and `timeline`.
The timeline includes at most **256 clips** and **128 tracks**, with `clips_total`
and `tracks_total`; selection includes at most **64 handles**, with `total`.
Selected clips take priority. A returned clip always references a returned track,
and a selected handle always references a returned clip. Returned ordering is not
chronological; sort by `start_sec` when needed. Always check totals before treating
these lists as complete.

Tracks expose lane/layer and locked/hidden/muted/solo flags. Clips expose opaque
ID, track ID, start/end seconds and gap flag. Handles persist through edits and
Undo within one loaded document. Reopening even the same project resets their
scope and closes old panels. SDK 0.5.0 adds optional main-track metadata
`main: {index, transition, overlap_sec}` and `timeline.main_total`. Sort main clips
by `main.index`; `transition` includes dormant incoming records, while
`overlap_sec` reports actual overlap. No transition expressions are exposed.
No source paths, media IDs/bytes, names, text,
captions, expressions, conversations or credentials are included.

`onChanged` reports `changes: ('timeline'|'selection'|'playhead')[]` with the
latest snapshot. Updates are coalesced to at most **10 Hz** while the panel is
open. Intermediate positions may be skipped; this is not a render clock. Timeline
projection is cached between project edits. Metadata changes outside the bounded
slice can leave totals/projection unchanged and therefore produce no event.
Subscription callbacks receive separate snapshot copies. Subscribe then read,
and use revisions to avoid rendering an older initial read after a newer event.
`supports('editor.read')` detects both the grant and optional panel bridge support.
An ungranted SDK call throws `PERMISSION_DENIED`; a declared capability on an old
host throws `API_MISMATCH`. Closing, disabling, developer reload or document
replacement destroys that panel generation. This capability cannot edit, seek,
select, decode media or access the privileged editor API.

## Atomic clip edits

Command permission `clips.write` requires `editor.read`. It may be combined with
`project.read`, `timeline.reorder`, `timeline.edit` and `clips.linked`; marker, caption, AI and
export permissions use separate contracts.
A panel runs an allowlisted command with normal trusted-click/native approval;
it does not receive a direct editing API.

```ts
import {defineCommand} from '@clipcraft/plugin-sdk';

export const run = defineCommand(async context => {
  const snapshot = await context.editor.read();
  const clip = snapshot.timeline.clips.find(c => c.trackId === 'text:0');
  if (!clip) throw new Error('No supported clip in this snapshot.');
  await context.editor.stage({
    documentId: snapshot.documentId,
    revision: snapshot.revision,
    operations: [{type: 'move', clipId: clip.id, start_sec: 5}],
  });
});
```

`stage` accepts one batch of **1–64** ordered operations per command run:

- `{type:'move', clipId, start_sec}` keeps the clip length and source window.
- `{type:'trim', clipId, start_sec, end_sec}` shortens its current timeline range.

Use handles from that command's captured snapshot. Operations may address one clip
more than once; each sees the timing resulting from earlier operations. Final
placement checks permit swaps. All targets must be returned overlay, audio, text
or effect clips for move/trim. Ranges stay within the captured project and retain at least 0.1 s.
Tracks/layers stay fixed. Linked clips, extension and overlap
are unsupported for move/trim. Trims preserve speed-scaled source windows,
audio fade envelopes and cropped measured text timing; a caption crop cannot
remove every measured word. Keyframes retain their source times. The contract is
non-ripple even when the track's magnet is enabled.

The host validates the complete project, including clips absent from the bounded
snapshot. Staging changes nothing. Successful command completion, fresh package
verification and a single-use authorization precede one atomic reducer batch.
Any invalid operation rejects the whole transaction. Worker failure, Stop,
revocation, stale documents and an unapproved/closed panel action prevent commit.
Playback/selection changes alone do not invalidate the frozen command context.
A no-op batch creates no history entry. Otherwise one Undo restores the whole
batch; CraftAI includes it as one step in its owning edit. Results expose the
host-verified `clips_changed` (panel) or `clips_changed` tool result; manual editor
status reports the same count. Plugin-authored success messages are not proof of
application. No native commit token or raw project ID is exposed to plugin code.

## Main-track reorder

SDK 0.5.0 adds command permission `timeline.reorder`, requiring `editor.read`.
It may be combined with `clips.write` and `project.read`. Native approval names
main-track reordering separately. Use the same `context.editor.stage()` method:

```ts
const snapshot = await context.editor.read();
const main = snapshot.timeline.clips.filter(c => c.main)
  .sort((a, b) => a.main!.index - b.main!.index);
if (!main[0] || !main[1] || main[1].gap) throw new Error('No movable target.');
await context.editor.stage({
  documentId: snapshot.documentId, revision: snapshot.revision,
  operations: [{type: 'reorder', clipId: main[1].id, beforeClipId: main[0].id,
    gaps: 'preserve', transitions: 'reject'}],
});
```

`beforeClipId: null` appends. Both handles must be returned main clips; only a
non-gap clip may move, while a gap may be an anchor. Handles cannot match.
Already-adjacent/already-last moves are no-ops. Operations run in order and may
mix free-track edits when both permissions are granted.

Every gap retains its identity, duration and relative order to other gaps,
even if gaps become adjacent or trailing. No gap normalization occurs.
`transitions: 'reject'` refuses incoming transitions whose predecessor changes;
`'clear-boundaries'` explicitly removes those records after each reorder.
Other transitions, source windows, speed, effects and keyframes stay intact.
Clearing overlap can lengthen the sequence. Main timing is recomputed; free
clips and markers retain absolute timing, without ripple.

The 64-operation limit also has a **64 affected clip** limit, including gaps
and collateral timing changes. A locked main track, affected linked main clip
or motion-pin dependency rejects the entire batch, including mixed free edits.
The host checks omitted clips too. Snapshot lists remain bounded; use totals
before assuming a complete sequence. Main splitting/trimming uses the separate `timeline.edit` grant described below.
Explicit linked split/trim uses `clips.linked` below. Ripple remains unavailable. Approval, stale-context checks, cancellation,
host-verified counts and one-step Undo use the same atomic transaction contract.

## Main-track split and trim

SDK 0.6.0 adds `timeline.edit`, requiring `editor.read`. It may combine with
`timeline.reorder`, `clips.write` and `project.read`. Existing grants do not gain
split/trim access. These operations use the same command-only staging method:

```ts
const snapshot = await context.editor.read();
const clip = snapshot.timeline.clips.find(c => c.main && !c.gap);
if (!clip || clip.end_sec - clip.start_sec < 1) throw new Error('No suitable clip.');
await context.editor.stage({
  documentId: snapshot.documentId, revision: snapshot.revision,
  operations: [{type: 'split', clipId: clip.id,
    at_sec: (clip.start_sec + clip.end_sec) / 2,
    gaps: 'preserve-time', transitions: 'reject'}],
});
// Another command may crop a returned main clip:
// {type:'trim-main', clipId, start_sec, end_sec,
//  gaps:'preserve-time', transitions:'preserve-overlap'}
```

Times are absolute timeline seconds evaluated in batch order. Splits keep the
original handle on the left piece and require at least 0.1 seconds on both sides.
Right pieces have host-created IDs; read a new context to obtain their opaque
handles. Plugins cannot choose raw IDs or target new pieces in this batch.
`trim-main` crops the current window, keeps at least 0.1 seconds and cannot extend
source media. A full-range trim is a no-op.

Both operations preserve later main clip times, independent of magnet settings.
Trimming adds gaps for removed time beyond any overlap, including a trailing gap
at sequence end. Existing gaps keep their identity and duration; gaps are never
merged or normalized. Free tracks and markers retain absolute timing. Source
windows respect speed, keyframes stay in source time and audio fade envelopes
are sliced continuously. A split keeps entry animation on the left and exit
animation on the right. Cropping an animated edge removes its edge animation.

`transitions:'reject'` refuses edits touching incoming/outgoing non-none records,
including a dormant first transition. `'preserve-overlap'` retains exterior
split overlap and crops trim overlap with the removed head/tail. Exhausted
transitions are removed; remaining overlap is pinned so automatic duration caps
cannot move neighbors. Splits have no internal transition. A piece must contain
its retained overlap; a cut inside that overlap is refused. A new leading gap
cannot activate a dormant first transition. Other transition settings are retained.

The host checks the whole project, including omitted clips and dependencies.
Modified originals, new pieces/gaps, transition updates and reordered originals
count toward the **64 affected clip** limit. Inserting a piece or gap alone does
not make all later original clips edits. Locked tracks, affected linked clips
or motion-pin dependencies reject the full batch. All invocations share native
consent, cancellation, scope checks, single-use commit authorization, verified
`clips_changed` and one-step Undo. Explicit linked split/trim uses the separate
`clips.linked` grant below. Ripple remains a future capability.

## Linked picture/audio split and trim

SDK 0.7.0 adds `clips.linked`, requiring `editor.read`. It may combine with other
bounded clip-edit permissions and `project.read`. Old grants keep rejecting linked
writes. A pair operation requires both returned handles explicitly:

```ts
const snapshot = await context.editor.read();
const picture = snapshot.timeline.clips.find(c => c.link?.partnerId &&
  (c.trackId === 'video:0' || c.trackId.startsWith('overlay:')));
if (!picture?.link?.partnerId) throw new Error('No complete picture/audio pair.');
await context.editor.stage({
  documentId: snapshot.documentId, revision: snapshot.revision,
  operations: [{type: 'split-linked', clipId: picture.id,
    partnerClipId: picture.link.partnerId,
    at_sec: (picture.start_sec + picture.end_sec) / 2,
    gaps: 'preserve-time', transitions: 'reject'}],
});
// To crop a pair in another command:
// {type:'trim-linked', clipId, partnerClipId, start_sec, end_sec,
//  gaps:'preserve-time', transitions:'preserve-overlap'}
```

Optional `clip.link` contains `{groupId, partnerId, members_total}`. Group IDs and
partner handles are opaque and document-scoped. `partnerId` is null when the
supported partner is not returned; counts include unsupported members. Selected
clips' partners get priority inside the existing snapshot limits. Do not infer
completeness from nearby array entries. Neither raw link IDs nor source offsets,
media IDs or file paths are exposed. Metadata remains read-only.

This slice supports exactly one main/overlay picture clip plus one audio clip,
with aligned timeline ranges, equal positive speed, zero stored timeline offset
and consistent stored source offset. Source in-points may differ. Either member
may initiate. Missing, ambiguous, locked, misaligned or inconsistent pairs reject
the entire batch. Old snapshots remain readable but cannot authorize pair edits.

Splits retain original IDs/link on the left and create a new host-owned right
pair/link. Each half needs at least 0.1 seconds. Obtain new opaque handles on the
next read; plugins cannot assign raw IDs or target new pieces in this batch.
Trims crop both current windows without source extension. A full-range trim is
a no-op. Operations run in order, may mix other separately permitted edits and
retain source offset, speed, keyframes, fades and exterior animation semantics.
Sound uses the exact picture arithmetic so normal reducer synchronization cannot
silently repair a partial proposal.

Main edits preserve the timeline clock with explicit gaps beyond removed overlap.
Overlay/audio trims move both starts to the retained interval. Other clips and
markers stay put without ripple. Main transition policies use the same explicit
`reject` / `preserve-overlap` rules as the range contract. Affected linked neighbors
outside the named pair, motion-pin dependencies, collisions or source violations
reject the batch. New pieces/gaps and all modified partners share the existing
64-affected-clip limit, native consent, single-use authorization and one-step Undo.

Menu actions targeting pairs should allow both picture and audio lanes and use
selection conditions that admit the editor's expanded linked selection. The host
disables unsupported pairs and locked partners. Panels run allowlisted commands;
there is no direct panel write API. Pair creation/link/unlink, shifted pairs,
linked reordering and ripple remain separate capabilities.

## Registering editor actions

SDK 0.4.0 adds optional `contributes.actions` declarations. The `command` scaffold
registers its starter command in the Plugins menu. Existing packages opt in by
adding registrations and bumping their package version:

```ts
import {definePlugin} from '@clipcraft/plugin-sdk';

export default definePlugin({
  id: 'studio.tools', name: 'Studio tools', publisher: 'Studio',
  version: '1.0.0', apiVersion: 1, entry: 'commands.js',
  permissions: ['editor.read', 'clips.write'],
  contributes: {
    commands: [{id: 'shift', name: 'Shift text clips', parameters: []}],
    actions: [{
      id: 'shift-text', commandId: 'shift', label: 'Shift text clips',
      icon: 'layers', locations: ['plugins-menu', 'clip-menu'],
      when: {selection: 'single', lanes: ['text']},
    }],
  },
});
```

Actions reference an existing command in the same package; they do not introduce
new code entry points. A package can register **32 actions**. IDs are unique within
that package, labels are plain text (80 characters), and icons are host-owned:
`command`, `sparkles`, `scissors`, `export`, `text`, `audio`, `layers`, `info`.
No SVG/URL icons, HTML, CSS, arbitrary locations or expression strings are accepted.

`when.selection` is `any` (default), `none`, `single` or `multiple`.
`when.lanes` is a nonempty allowlist of `video`, `overlay`, `audio`, `text`, `effect`.
Every selected clip must match; a lane condition requires at least one selected
clip and cannot be combined with `selection: 'none'`. The host resolves linked
selections before evaluating these conditions. Clip context actions never target
an unrelated previous selection, gaps or attached effect rows.

Visibility conditions grant no read/write permissions. Host checks disable busy
editors, missing targets and unsupported or locked clip-write selections. General
Plugins-menu actions without a selection condition can operate on the project
without a selection, using only their declared permissions. Unsupported operations
are still rejected by the normal command broker and reducer.

A parameter-free action starts from its menu click. Commands with parameters use
the editor's numeric/enum controls and defaults, followed by the existing native
approval. The host shows package/version/publisher, progress, actual results and
errors. No plugin code runs while registering or opening menus. Close/Cancel
stops only that invocation; native commit rules and one-step Undo remain intact.
Cancel is unavailable while an authorized batch is applying.

The invocation retains its project/load generation and selection. Changing either
invalidates configuration or cancels pending execution. Playback alone does not.
Registry refresh and native validation prevent old versions from running after
package disable, removal, upgrade or developer reload. Development entries are
marked and get new identities on reload; unrelated installed actions keep running.
The host catalog returns at most 256 registrations, with an explicit truncation
notice; Settings still exposes all installed commands.

Menus support Escape, Up/Down and submenu Right/Left navigation. Host dialogs trap
Tab, respect field-level Escape and restore focus on close. Native plugin views
are masked behind host menus/dialogs. Action declarations do not grant panels
access to the UI registry or bypass panel command allowlists/trusted clicks.

## Supported extension surfaces

| Surface | API 1 support | Limits / permission contract |
| --- | --- | --- |
| Export presets | Declarative validated encoder settings | No arbitrary encoder/native executable |
| Effects | Declarative ClipCraft expressions and numeric parameters | Same validated renderer for preview/export; no arbitrary JS/GLSL |
| Transitions | Declarative A/B/P expressions | Validated duration/parameters and guarded endpoints |
| UI actions | Declarative Plugins/clip menu entries, host controls and fixed icons | Same-package command references; 32/package, bounded catalog; no dynamic scripts |
| Commands | Sandboxed worker, typed parameters, progress | Fresh native approval; host validation and one atomic edit |
| Command editor.stage | One atomic batch of free moves/trims, main edits and explicit linked split/trim | `clips.write`, `timeline.reorder`, `timeline.edit` and/or `clips.linked` + editor.read; 64 operations and affected clips |
| Command editor.read | Frozen-at-start selection/playhead and bounded tracks/clips | Command `editor.read`; no subscriptions or writes |
| Command project.read | Duration, frame rate, bounded markers | `project.read`; no paths or media bytes |
| Command markers.add | Stage marker proposals | `markers.write`; host deduplicates and applies |
| Command transcript.read | Approved existing caption cues | `captions.read`; bounded sharing snapshot |
| Command ai.chapters | Host-brokered chapter proposals | `ai.chapters` + captions.read + markers.write; mandatory review |
| Command AI translation | Host-brokered captions and staged track | `ai.translateCaptions`, captions.read/write; mandatory review |
| Command exports.gif | Bounded host-rendered GIF job | `export.gif`; fixed recipe, user-owned destination |
| AI providers | Declarative OpenAI-compatible endpoint/models | Host-owned requests and separately stored credentials |
| Panel editor | Bounded editor snapshot and coalesced change events | Panel `editor.read`; 256 clips, 128 tracks, 64 selections |
| Panel project | Live bounded name/geometry/counts/markers | Panel `project.read`; no captions, paths or transcript |
| Panel local storage | JSON get/set/remove/keys/clear | Panel `storage.local`; 64 KiB total, 16 KiB/value, 64 keys |
| Panel commands | Declared IDs in the same package only | Package project.read/editor.read/markers.write, clips.write, timeline.reorder, timeline.edit or clips.linked; trusted click + per-run consent |
| Editor developer sessions | Temporary command/panel snapshots, explicit reload, optional compiled watch and bounded logs | Editor-only controls; no automatic execution or installed-package mutation |
| Panel theme | Six semantic colours and change subscription | Automatically applied CSS variables |

Panel AI/caption/GIF actions, ripple, shifted-pair edits and link creation/removal, arbitrary patches, custom media decoders,
background native processes, network/filesystem APIs, persistent panel restoration,
marketplace distribution and automatic upgrades are **not** SDK capabilities today.
Adding types never grants one. See the repository's plugin contracts for exact
package, expression, sharing and lifetime limits.

## Maintaining the SDK

The SDK build bundles the editor's canonical validators and package reader; no
parallel validation schema is maintained. Browser helpers have no Node dependency.
The Node authoring package depends on pinned esbuild, TypeScript and tar versions.
Run `npm run sdk:build` before packing `packages/plugin-sdk` with npm pack. The SDK
archive includes compiled helpers, CLI, declarations, README and license; it contains
no editor source, credentials or application binaries. Packaging this SDK is not an
editor installer build and does not publish anything to npm.
