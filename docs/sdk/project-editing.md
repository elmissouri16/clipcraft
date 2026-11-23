# Project and timeline APIs

Read a consistent snapshot, choose the editing surface that fits the change and submit it as an undoable operation.

| Job | API | Scope of an edit |
| --- | --- | --- |
| Read every clip or a large nested value | `workspace.inspect` and `workspace.readValue` | Page through one document revision. |
| Add a title, grade a shot or change the canvas | `editor.tools.run` | A validated batch using the editor’s tool schemas and project IDs. |
| Split, trim or link specific clip handles | `editor.read` and `editor.apply` | One transaction bound to the snapshot revision. |
| Create a custom track or edit its typed data | `timeline.types` and `timeline.apply` | A revision-scoped change to installed track and clip types. |

## Reading the project

```ts
const doc = await context.workspace.read();   // name, size, fps, duration_sec, export_duration_sec
let cursor: number | null = 0;
while (cursor !== null) {
  const page = await context.workspace.inspect({section: 'clips', lane: 'video', cursor, limit: 100});
  for (const clip of page.items) { /* id, trackId, start_sec, end_sec, mediaId, properties */ }
  cursor = page.next;
}
```

Sections are `project`, `tracks`, `clips`, `media` and `markers`. Nested data
arrives as a reference; expand it with `workspace.readValue({documentId,
projectRevision, ref})`. `duration_sec` covers every track;
`export_duration_sec` is the length of the rendered video. Use the latter for
export ranges.

### Custom tracks and clips

Use `timeline.types({pluginId: context.extension.id})` to discover installed
definitions. The returned type IDs include the package fingerprint. A clip
definition names the track type it fits. A custom row can render a shader,
place project media or store timed metadata.

Call `timeline.read({section: 'clips'})` or `timeline.read({section: 'tracks'})`
to get the current `documentId` and `projectRevision`. Pass both to
`timeline.apply({documentId, projectRevision, operations})` to create, change,
move or remove tracks and to create, update, duplicate, split or remove clips.
An invalid operation rejects the whole batch. Inside preparation hooks the
batch joins the private draft. See the [operation schemas and worked example](../design/plugin-custom-timeline.md#editing-api)
and the [runnable SDK workbench](../../examples/extensions/sdk-workbench/README.md).

## Editing with the editor's tools

`context.editor.tools` runs the same tools CraftAI uses: titles and their
styles, captions, transitions, filters, colour, effects, keyframes and
animation, speed, volume and audio effects, compositing, tracks, stock and
sounds, voice-over, project size, frame rate and background, and more.

```ts
const tools = await context.editor.tools.list();          // [{name, description, parameters}]
const {results} = await context.editor.tools.run([{name: 'get_project'}]);

await context.editor.tools.run([
  {name: 'add_text', args: {text: 'Welcome', start_sec: 0, duration_sec: 2.5}},
  {name: 'set_project', args: {background: '#102030'}},
]);
```

- **One run is one edit.** All its calls land as a single Undo step.
- **Atomic by default.** If a call fails, the whole run is rolled back and
  `run` rejects with that call's error. With `{atomic: false}` every call runs,
  each result is returned, and a failed call has an `error` field.
- **Validated.** Arguments are checked against each tool's schema before
  anything is written, and every write is simulated first; an edit that would
  break the timeline is refused.
- **IDs.** Tools use the project's own clip and media IDs. Read them with
  `get_project`. They are not the `c-…` handles of `editor.read`.
- **Discover, do not hard-code.** Tool names and schemas belong to the
  application version. Read `list()` and fail clearly if a tool is missing.
- **Limits.** 1–64 calls per run; a result over 512 KiB is replaced by an error.
  Not offered: opening, creating or saving projects, Undo, and running other
  extensions.
- **Busy editor.** `run` rejects while CraftAI, an outside agent or a drag holds
  the editor, when CraftAI is running your command, and inside save/export hooks.
  If the user edits during a run, the run stops and rejects; what it had done
  stays as its own Undo step.

## Clip transactions

`editor.read` returns a bounded snapshot with public clip handles (`c-12`),
tracks, selection and playhead. `editor.apply` takes a list of operations
against that snapshot and applies all of them or none, as one Undo step.

```ts
const editor = await context.editor.read();
const clip = editor.timeline.clips.find(c => c.main && !c.gap);
if (!clip) throw new Error('Place a picture on the main track first.');

const middle = (clip.start_sec + clip.end_sec) / 2;
await context.editor.apply({
  documentId: editor.documentId,
  revision: editor.revision,
  operations: [{
    type: 'split', clipId: clip.id, at_sec: middle,
    gaps: 'preserve-time', transitions: 'reject'
  }]
});
```

- **Staleness.** A transaction is stale once the document has changed since
  its snapshot. Moving the playhead or the selection does not make it stale.
  After any successful write, read again.
- **Targets outside the summary.** The snapshot is bounded. For other clips use
  `workspace.inspect` to find them, then `editor.read({clipIds})`.
- **Operations** are listed in [`index.d.ts`](../../packages/plugin-sdk/src/index.d.ts)
  (`ClipEdit`): move, trim, split, reorder, ripple removal, link and unlink,
  linked variants, create/duplicate/place/delete, text and style, transform,
  opacity, audio, speed, keyframes and effect slots. Their literal policy fields
  (`gaps`, `transitions`) are required on purpose: they name what the edit may
  and may not disturb.
- **Rules worth knowing.** Trims only crop. Free-track edits must end inside the
  project. `move`/`trim` take unlinked overlay, audio, text or effect clips;
  `split`/`trim-main`/`reorder` take unlinked main clips; linked pairs use the
  `-linked` forms with both handles. A transaction may touch at most 64 clips.
  Effects on the Effects track may overlap; other tracks hold one clip at a time.
  A filter look is an Effects-track layer and cannot be attached to one clip.

Use transactions when you need exact handles and all-or-nothing behaviour on
clips you inspected; use `editor.tools` for everything else.

## Markers and captions

```ts
const scope = await context.workspace.inspect({section: 'markers'});
await context.markers.apply({documentId: scope.documentId, projectRevision: scope.projectRevision,
  operations: [{type: 'add', time_sec: 12.5, label: 'Chapter 2'}]});

const captions = await context.captions.read();           // first text track; pass {trackId} for another
await context.captions.write({documentId: captions.documentId, revision: captions.revision,
  mode: 'create-track', newTrack: {name: 'English', language: 'en'},
  style: {font: 'poppins', size: 40, color: '#ffffff', bg: {on: true, color: '#123456'}},
  cues: [{text: 'Hello', start_sec: 0, end_sec: 1.2}]});
```

`captions.write` modes: `append`, `replace` (removes the track's captions
first) and `create-track`. Cues must not overlap each other or a clip already
on the track; an overlapping write is refused. Written cues use the standard
caption style unless `style` overrides it. Each cue can add its own `style`;
nested fields inherit from the write-level style. `CaptionStyle` includes builtin
fonts, colour/effects, stroke, shadow, background, highlighting and text animation.
Find text tracks with `workspace.inspect({section: 'tracks',
lane: 'text'})`.

## Projects and Undo

```ts
const current = await context.projects.status(); // works on Home too
await context.projects.create({documentId: current.documentId, name: 'My edit', format: '16:9', fps: 24});
const document = await context.workspace.read();
await context.projects.save({documentId: document.documentId}); // native picker on the first save
const scope = await context.workspace.inspect({section: 'project'});
await context.editor.undo({documentId: scope.documentId, projectRevision: scope.projectRevision});
```

`projects.open({documentId, path?})` uses the native Open picker when `path` is
omitted. Explicit saves use a new absolute `.clipcraft.json` path or the current
file; they refuse overwriting another existing file. `saveAs: true` requests the
native Save As picker. `projects.close({documentId})` returns Home after preserving
the project in its file/autosave slot; it does not discard unsaved work.

Pass `documentId: null` to create/open from Home. A stale document, failed current
project persistence, active gesture/agent/export or concurrent lifecycle request
refuses the operation. Save still runs native preparation hooks. Project lifecycle
and Undo cannot run inside save/export hooks or managed agent edits. Undo uses the
real history stack with a native commit reservation and creates no replacement
edit. No available Undo returns `{applied: false}`.

[Extension API index](../design/plugin-extension-api.md) · [Type declarations](../../packages/plugin-sdk/src/extension.d.ts)
