# Extension API guide

This is the author's guide to ClipCraft's Node extensions: what an extension is,
every namespace of the `context` it receives, the rules that decide whether a
call succeeds, and what an extension cannot do yet. The type declarations in
[`extension.d.ts`](../../packages/plugin-sdk/src/extension.d.ts) are the exact
reference; this guide explains how to use them.

App 2.0.0, SDK 0.8.0, host API 1. The SDK is a development release.

## 1. What an extension is

An extension is a package with a manifest (`plugin.json`) and one bundled Node
entry (`dist/extension.cjs`). The user installs it in Settings → Plugins and
chooses **Trust & activate**. From then on it runs in its own process with full
Node access to files, programs and the network. Trust is tied to the exact
package bytes: a changed build is a new package and needs trust again.

The editor never hands an extension its internals. Everything goes through the
`context` object passed to `activate`, and every edit goes through the editor's
own validation and Undo.

```ts
import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';

export async function activate(context: ExtensionContext) {
  await context.commands.register('title', async () => {
    const run = await context.editor.tools.run([
      {name: 'add_text', args: {text: 'Chapter one', start_sec: 0, duration_sec: 3}},
    ]);
    return {changed: run.changed};
  });
  await context.ui.registerAction({id: 'title-button', title: 'Add title', location: 'toolbar', command: 'title'});
}

export async function deactivate() { /* optional cleanup */ }
```

### Create, build, install

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs create /tmp/my-extension --id studio.my-extension --name "My extension" --publisher "Studio"
cd /tmp/my-extension && npm install
npx clipcraft-plugin check .     # strict type check
npx clipcraft-plugin build .     # writes dist/
npx clipcraft-plugin pack dist my-extension.tgz
```

Install the `dist` folder or the archive. While developing, use a development
session instead (Settings → Plugins → Developer): it loads your build with
temporary trust and settings, reloads on demand and can attach a debugger. See
[development sessions](plugin-extension-development.md).

### Manifest

```json
{
  "id": "studio.my-extension",
  "name": "My extension",
  "publisher": "Studio",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "dist/extension.cjs",
  "contributes": {
    "commands": [{"id": "title", "name": "Add title"}],
    "views": [{"id": "panel", "name": "My panel"}]
  }
}
```

- **Identity.** `id` plus `publisher` identify your extension. A package with an
  installed ID from another publisher is refused, and stored settings and
  secrets are never shared across publishers.
- **Versions are immutable.** Changed bytes need a new `version`.
- **IDs are scoped.** A command registered as `title` is `studio.my-extension.title`
  everywhere outside your extension. IDs and configuration keys are lower-case:
  `^[a-z][\w.-]{0,159}$`.
- **Activation.** Without `activationEvents` the extension starts with the app,
  so its actions, hooks and listeners are present after every launch. To start
  lazily instead, list the triggers: `command:<id>`, `event:<topic>`,
  `service:<id>`, `hook:<id>`, `view:<id>`, `ui:<location>` or `startup`. An
  empty list means "only when one of my declared commands or views is used".
- **Payload.** Only `plugin.json`, `dist/` and `assets/` are packaged. Put view
  files and other assets in `src/assets/`. Native addons and `node_modules` are
  not packaged: dependencies are bundled into the entry by the build.

## 2. Lifecycle rules

These decide most "why did my call fail" questions.

- **Explicit Stop is final** until the user activates again. A crash or a timeout
  also needs a manual Activate. A request the user cancels (a save, an assistant
  run) while your extension is still starting does not count as a failure.
- **Plugin management restarts you.** Installing, enabling, removing or
  recovering any plugin stops all extensions briefly; the ones that were running
  start again. In-flight work is canceled, so keep long work resumable.
- **A handler has five minutes.** Commands, service methods, hooks and event
  listeners are stopped, and the extension with them, if they run longer. Time
  spent waiting in `jobs.run`, `processes.spawn().result`, a dialog, a message,
  `exports.render`, `files.publish`, another extension's command or service, or
  `editor.tools.run` does not count. Put long work in `jobs.run`.
- **Calls belong to the handler that made them.** A host call started inside a
  handler must finish before the handler returns. Work you start without
  awaiting it is cut off when the handler ends; an error it raises is written to
  your log. For work that outlives a handler, start it from `activate` or from a
  timer, or run it as a job.
- **Signals.** Every handler gets `{signal}`. It aborts when the caller cancels,
  when the extension stops, and also once the handler has finished.
- **Errors.** Throw an `Error`. The message reaches the caller; the stack goes to
  your log (Settings → Plugins → your extension, or `context.log`).

## 3. The context

| Namespace | Use it for |
| --- | --- |
| `commands` | Named entry points: toolbar buttons, shortcuts, CraftAI and other extensions call them. |
| `editor.tools` | The editor's own editing tools: almost everything the editor can do. |
| `editor.read/apply` | Precise, validated clip transactions with public handles. |
| `workspace` | Reading the whole project in pages. |
| `markers`, `captions` | Marker and caption edits. |
| `media` | Bringing files you made into the project. |
| `exports`, `files` | Rendering the video and publishing files safely. |
| `processes`, `jobs` | Running programs and long work with progress and cancel. |
| `ui` | Actions, settings, shortcuts, messages, dialogs and HTML views. |
| `events`, `hooks` | Reacting to the editor; taking part in save and export. |
| `services` | Offering functions to other extensions and to the app. |
| `configuration`, `secrets` | Stored settings and encrypted keys. |
| `host`, `log` | Version, tools, feature discovery and diagnostics. |

Check a feature before relying on it:

```ts
const {features} = await context.host.capabilities();
if (!features['editor.tools']) throw new Error('This ClipCraft version has no editor tools.');
```

### 3.1 Commands

```ts
await context.commands.register('greet', async (input: {name?: string}, {signal}) => ({message: `Hello ${input.name ?? 'there'}`}));
const reply = await context.commands.execute('studio.other-extension.do-something', {value: 1});
```

Declare a command in the manifest to make it lazily activatable and visible to
CraftAI, which runs it only after the user reviews it. A command invoked from a
clip's context menu receives `{location: 'context', editor, clipId}`; from every
other place it receives `{}` or whatever the caller passed.

### 3.2 Editing with the editor's tools

`context.editor.tools` runs the same tools CraftAI uses: titles and their
styles, captions, transitions, filters, colour, effects, keyframes and
animation, speed, volume and audio effects, compositing, tracks, stock and
sounds, voice-over, project size, frame rate and background, and more.

```ts
const tools = await context.editor.tools.list();          // [{name, description, parameters}]
const {results} = await context.editor.tools.run([{name: 'get_project'}]);

await context.editor.tools.run([
  {name: 'add_text', args: {text: 'Welcome', start_sec: 0, duration_sec: 2.5}},
  {name: 'set_filter', args: {clip_id: 'v1', filter_id: 'bw'}},
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

### 3.3 Clip transactions

`editor.read` returns a bounded snapshot with public clip handles (`c-12`),
tracks, selection and playhead. `editor.apply` takes a list of operations
against that snapshot and applies all of them or none, as one Undo step.

```ts
const editor = await context.editor.read();
const clip = editor.timeline.clips.find(c => c.main && !c.gap)!;
await context.editor.apply({documentId: editor.documentId, revision: editor.revision, operations: [
  {type: 'split', clipId: clip.id, at_sec: 2, gaps: 'preserve-time', transitions: 'reject'},
]});
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

### 3.4 Reading the project

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

### 3.5 Markers and captions

```ts
const scope = await context.workspace.inspect({section: 'markers'});
await context.markers.apply({documentId: scope.documentId, projectRevision: scope.projectRevision,
  operations: [{type: 'add', time_sec: 12.5, label: 'Chapter 2'}]});

const captions = await context.captions.read();           // first text track; pass {trackId} for another
await context.captions.write({documentId: captions.documentId, revision: captions.revision,
  mode: 'create-track', newTrack: {name: 'English', language: 'en'},
  cues: [{text: 'Hello', start_sec: 0, end_sec: 1.2}]});
```

`captions.write` modes: `append`, `replace` (removes the track's captions
first) and `create-track`. Cues must not overlap each other or a clip already
on the track; an overlapping write is refused. Written cues use the standard
caption style. Find text tracks with `workspace.inspect({section: 'tracks',
lane: 'text'})`.

### 3.6 Media

```ts
const item = await context.media.import({path: '/tmp/result.mp4'});   // or {bytes, name: 'still.png'}
await context.media.preview({id: item.id});                           // optional host preview with Add
const placed = await context.media.insert({id: item.id, trackId: 'overlay:0', start_sec: 4});
// placed.handle is a clip handle for editor.read/apply
await context.media.release({id: item.id});
```

Import copies and inspects the file; a picture that does not decode is
refused. Supported suffixes: png, jpg, jpeg, webp, bmp, mp4, mov, m4v, mkv,
webm, avi, wav, mp3, m4a, aac, ogg, opus, flac, aiff. `insert` places the clip on the track you name, or
refuses if that track is occupied at that time or locked; it never moves other
clips. On the main track use `index` instead of `start_sec`. Items live as long
as the activation; inserted media is kept by the project.

### 3.7 Export and files

```ts
const result = await context.exports.render(
  {file_path: '/tmp/out.mp4', quality: 'high', range: {start_sec: 0, end_sec: 10}},
  {onProgress: p => context.log(`export ${Math.round(p.progress * 100)}%`)});

await context.files.publish({path: '/tmp/work/out.gif', destination: '/Users/me/Movies/out.gif'});
```

`exports.render` uses the native pipeline (MP4, H.264 or H.265), runs the
export hooks and returns verified metadata. One export runs at a time. To
produce another format, render, convert with a managed process and publish the
result. `files.publish` copies a finished file to its destination with a
checksum; it never overwrites unless `overwrite: true`, and never leaves a
partial file.

### 3.8 Programs and long work

```ts
const host = await context.host.read();                    // host.tools.ffmpeg, host.tools.ffprobe
const run = await context.processes.spawn({file: host.tools.ffmpeg, args: ['-version'], timeoutMs: 30000});
const {code, stdout} = await run.result;

await context.jobs.run('Transcribing', async job => {
  await job.progress(0.25, 'Loading model');
  if (job.signal.aborted) return;
});
```

A managed process gets a minimal environment plus your `env`, is killed with
its process group on timeout, cancel or stop, and returns once the program
itself exits. Output is text, bounded (1 MiB by default, 8 MiB at most, stdout
and stderr together). A job shows in the activity list with your title and
progress and can be canceled there. Processes you start with Node's own
`child_process` are yours to clean up.

### 3.9 User interface

**Actions** put a command where the user works:

```ts
await context.ui.registerAction({id: 'run', title: 'Run it', location: 'toolbar', command: 'greet'});
```

Locations: `toolbar`, `inspector`, `context` (clip menu), `export` (export
dialog), `settings.plugins` (your extension's page) and `settings.voice`.

**Settings** are native forms; values land in `configuration` (or `secrets`
for `type: 'secret'`):

```ts
await context.ui.registerSettings({id: 'main', title: 'My extension', location: 'settings.plugins', fields: [
  {key: 'count', label: 'Chapters', type: 'number', default: 5, min: 1, max: 20},
  {key: 'mode', label: 'Mode', type: 'select', default: 'fast', options: [{label: 'Fast', value: 'fast'}, {label: 'Careful', value: 'careful'}]},
  {key: 'apiKey', label: 'API key', type: 'secret'},
]});
const count = await context.configuration.get<number>('count');   // 5 until the user changes it
```

**Shortcuts, messages, dialogs:**

```ts
await context.ui.registerShortcut({id: 'run-key', title: 'Run it', command: 'greet', keys: ['Alt+Shift+G']});
const choice = await context.ui.showMessage({message: 'Add markers?', actions: [{id: 'yes', title: 'Add'}]});
const files = await context.ui.showOpenDialog({title: 'Choose a clip', filters: [{name: 'Video', extensions: ['mp4']}]});
```

A message is a non-blocking card: single-line text, at most three actions, 1
to 240 seconds; it resolves to the chosen action ID or `undefined`. One file
dialog is open at a time; `defaultPath` must be absolute.

**Views** are HTML pages docked beside the editor:

```ts
const view = await context.ui.registerView({id: 'panel', title: 'My panel', entry: 'assets/panel.html'});
view.onMessage(async value => { /* from the page */ });
await view.reveal();
await view.postMessage({project: await context.workspace.read()});
```

```html
<!-- src/assets/panel.html -->
<!doctype html><meta charset="utf-8"><body><div id="out"></div><script src="panel.js"></script></body>
```

```js
// src/assets/panel.js
window.clipcraftView.onMessage(value => { document.getElementById('out').textContent = JSON.stringify(value); });
window.clipcraftView.postMessage({ready: true});
```

A view is an isolated page with no Node and no network. It talks to your
extension only through messages; do privileged work in the extension.
**Scripts must be files**: inline `<script>` and `eval` are blocked, and a
blocked or failing script is reported in your extension's log. Use the
`--cc-*` CSS variables and `onThemeChanged` for colours. Declare the view in the
manifest to let the user open it before your extension is running. Messages
sent while the page loads are delivered once it is ready. View state is not
kept after closing: store what matters in `configuration`.

### 3.10 Events and hooks

```ts
const sub = context.events.on('project.changed', async (value, {source}) => {
  if (source.kind === 'extension' && source.extensionId === context.extension.id) return;  // my own edit
});
await sub.ready;
context.subscriptions.push(sub);
await context.events.emit('finished', {count: 3});          // published as studio.my-extension.finished
```

Application events: `project.opened/closed/changed`, `editor.changed`,
`selection.changed`, `playback.changed`, `configuration.changed`,
`application.configurationChanged`, `export.changed`, `extension.changed`,
`media.previewClosed`. Events are delivered in order; under load, rapid ones
are coalesced and the listener's second argument reports how many were skipped
in `missed`.
`configuration.changed` has `source.kind` `'user'` for a change made in your
settings form and `'extension'` for your own write.

Hooks take part in save and export:

```ts
await context.hooks.register('export.validate', async ({document}) => {
  if (document.duration_sec > 600) return {cancel: 'This workflow supports videos up to ten minutes.'};
});
await context.hooks.register('project.willSave', async () => { /* may edit: becomes part of the save, one Undo */ });
```

`project.validateSave` and `export.validate` may only inspect and cancel.
`project.willSave` and `export.willRender` may also edit through `editor.apply`,
`markers.apply`, `captions.write`, `media.insert` and project configuration.
Only these four hook names are dispatched.

### 3.11 Services

```ts
import {defineServiceContract} from '@clipcraft/plugin-sdk/extension';
const contract = defineServiceContract({version: 1, methods: {
  translate: {input: {type: 'object', properties: {text: {type: 'string'}, to: {type: 'string'}}, required: ['text', 'to']}, output: {type: 'string'}},
}});
await context.services.registerTyped('translator', contract, {translate: async ({text, to}) => `${text} (${to})`});

const client = await context.services.connect('studio.my-extension.translator', contract);
const text = await client.call('translate', {text: 'Hello', to: 'fr'});
```

Services are how extensions offer functions to each other with checked inputs
and outputs; a method marked `stream: true` returns an async iterable. The app
consumes two integration points: register a service and announce it with
`ui.registerIntegration({point: 'voice.engines' | 'ai.engines', service})` to
appear as a voice or an assistant engine. The app's selected AI connection is
available to you as the service `clipcraft.ai`.

### 3.12 Configuration and secrets

```ts
await context.configuration.update({key: 'mode', value: 'careful'});                      // global
const {documentId} = await context.workspace.read();
await context.configuration.update({scope: 'project', documentId, key: 'notes', value: {done: true}}); // saved in the project, undoable
await context.secrets.store({key: 'apiKey', value: 'sk-…'});
```

Values are JSON, 64 KiB each. Secrets are encrypted by the operating system
and only your extension reads them back. Both survive uninstalling.

## 4. Limits at a glance

| Thing | Limit |
| --- | --- |
| Handler run time | 5 minutes, waits excluded (section 2) |
| Activation / deactivation | 15 s / 5 s |
| `jobs.run` | 1 s to 30 min |
| Managed process | 30 min; 8 MiB output; 1 MiB stdin; 64 at once |
| `editor.tools.run` | 64 calls; 512 KiB per result |
| `editor.apply` | 64 operations; 64 affected clips |
| `captions.write` | 10,000 cues; 4,000 characters each |
| `files.publish` | 512 MiB; two at once per extension |
| Message | 3 actions; 240 s; 3 waiting |
| Events | 64 emits in a burst, about 32 per second after |
| Package | 4,096 files; 32 MiB per file; 128 MiB total; 64 MiB archive |

## 5. What an extension cannot do yet

Known gaps, so you can plan around them:

- **UI surfaces.** No tab in the left rail or library, no status bar, no
  overlay on the player or timeline, no floating or modal window, no menu
  entries beyond the clip context menu, and no control over where a view docks.
  Actions have a title only: no icon, enabled state or ordering. There is no
  text-input prompt; use a view.
- **Inspector controls bound to a clip property** are not available; inspector
  actions are buttons.
- **Custom effect code.** Effects and transitions are declarative expressions in
  creative packs, not shaders or code.
- **Custom clip or track types**, and drawing your own timeline items.
- **Export formats.** The renderer produces MP4; other formats are a
  post-processing step you run.
- **Project management.** Opening, creating, saving or closing projects, and
  invoking Undo.
- **Streaming process output** and binary stdout; long-running helper servers
  as managed processes (start those with Node yourself).
- **GIF import** through `media.import`.
- **Custom hook points** for other extensions; use services and events.

## 6. Testing your extension

- `clipcraft-plugin check` type-checks against these declarations.
- A development session reloads your build in the real editor and shows your
  log, including view script errors.
- The repository's own proof is a good template: the fixture in
  `tests/fixtures/extensions/api-probe` calls every namespace and
  `tests/unit/plugins/test-extension-api-ui.cjs` runs it in the real app.
