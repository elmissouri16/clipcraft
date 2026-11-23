# Media, rendering and export

Bring a file into the media library, render a project range, or deliver an artifact chosen by the editor. Each file operation has its own ownership and destination rules.

## Media

```ts
const item = await context.media.import({path: '/tmp/result.mp4'});   // or {bytes, name: 'still.png'}
await context.media.preview({id: item.id});                           // optional host preview with Add
const placed = await context.media.insert({id: item.id, trackId: 'overlay:0', start_sec: 4});
// placed.handle is a clip handle for editor.read/apply
await context.media.release({id: item.id});
```

Import copies and inspects the file; a picture that does not decode is
refused. Supported suffixes: png, jpg, jpeg, webp, bmp, gif, mp4, mov, m4v, mkv,
webm, avi, wav, mp3, m4a, aac, ogg, opus, flac, aiff. `insert` places the clip on the track you name, or
refuses if that track is occupied at that time or locked; it never moves other
clips. On the main track use `index` instead of `start_sec`. Items live as long
as the activation; inserted media is kept by the project. GIFs use the native
animated-image path: a verified decode, an owned `.gif` source, normal preview
and looping video export.

## Export and files

Render the first ten seconds, or the entire edit if it is shorter. Ask the user for a destination and check for cancellation before starting the render. This example belongs inside a registered command handler.

```ts
const project = await context.workspace.read();
const end = Math.min(10, project.export_duration_sec);
if (end <= 0) throw new Error('Add picture or renderable timeline content first.');

const destination = await context.ui.showSaveDialog({
  title: 'Save review clip',
  filters: [{name: 'MP4 video', extensions: ['mp4']}]
});
if (!destination) return;

const result = await context.exports.render({
  documentId: project.documentId,
  file_path: destination,
  format: 'mp4',
  quality: 'medium',
  range: {start_sec: 0, end_sec: end}
});
await context.log(`Wrote ${result.metadata.width} × ${result.metadata.height} to ${result.file}`);
```

Use a new filename with the matching suffix. To deliver a file your extension already generated, use `files.publish({path, destination})`. For example, the [GIF extension](../../examples/extensions/gif-export/README.md) renders frames and publishes the finished GIF.

`exports.render` uses the native pipeline for MP4, MOV, Matroska and WebM, runs
the export hooks and returns verified metadata. WebM uses VP9/Opus; MP4/MOV
support H.264/H.265, and Matroska also supports VP9. Select `format`, or infer it
from `file_path`; an explicit suffix mismatch rejects. One export runs at a time.
See [native export formats](../design/plugin-extension-exports.md#native-containers-and-codecs).
`files.publish` copies a finished file to its destination with a
checksum; it never overwrites unless `overwrite: true`, and never leaves a
partial file.

## Rendering definitions

`rendering.list({cursor?,limit?,kind?,pluginId?,preferred?})` returns a bounded
`{items,total,next}` page of installed effect and transition identities, bounded
parameters and `program: 'expression' | 'glsl'`, without source code.
`rendering.validate({id, params?})` checks fresh installed bytes/parameter bounds
and compiles through the actual GPU. It works on Home; compile errors reject with
diagnostics and leave the extension running. Packages declare GLSL ES 3 fragment
functions in their manifest using `fragment` in place of `expression`. Native
preview/export, parameter controls, dependency pinning and Undo remain shared.
See [authored GLSL](../design/plugin-glsl.md) and the SDK workbench example.

[Extension API index](../design/plugin-extension-api.md) · [Type declarations](../../packages/plugin-sdk/src/extension.d.ts)
