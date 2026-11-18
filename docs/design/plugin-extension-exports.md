# Trusted extension video export

`workspace.read()` reports both overall `duration_sec` and native
`export_duration_sec`. Video export is driven by the renderable main track;
audio/text tails can extend the document without extending the video. The GIF
and reviewed-upload sources choose and validate their ranges against the native
export extent, including in private preparation drafts.


`context.exports.render(input?, {signal?, onProgress?})` renders the current open
project through ClipCraft's native video pipeline. It uses the same text, effects,
LUT, audio, cover, encoder, quality and atomic file-publication behavior as native
export. No specialized executable extension type is required. App 2.0.0, SDK
0.8.0 and host API 1 remain unchanged.

```ts
const document = await context.workspace.read();
const result = await context.exports.render({
  documentId: document.documentId,
  name: 'My rendered video',
  quality: 'high',
  range: {start_sec: 5, end_sec: 45},
}, {
  signal,
  onProgress: update => console.log(update.progress, update.stage),
});
console.log(result.file, result.metadata.duration_sec);
```

## Input and output

The call exports the full renderable timeline unless `range` specifies a section.
Sections may exceed the agent review limit of 30 seconds, but must remain inside
the timeline and be representable by the normal timeline slicing rules. A slice
does not unlock or cut the actual project. Captions and other free clips shift
with the section. `documentId`, when supplied, must identify the open document.
No project on Home is an error.

| Option | Values / behavior |
| --- | --- |
| `name` | Optional output base name, at most 200 characters |
| `file_path` | Optional absolute local `.mp4` destination with an existing parent folder |
| `overwrite` | Defaults to false; true explicitly permits replacing an existing regular file |
| `range` | `{start_sec, end_sec}`, finite increasing timeline seconds |
| `quality` | `low`, `medium`, `high`, `ultra`; otherwise current project settings |
| `codec` | `h264`, `h265`; capability fallback follows native export |
| `resolution` | Longest-side cap: `0` (original), 480, 720, 1080, 1440, 2160; never upscales |
| `fps` | `0` (timeline), 24, 25, 30, 50, 60 |
| `audio_kbps` | 96, 128, 192, 256, 320 |
| `crf` | Integer 0–51 |
| `bitrate_mbps` | Target 0.5–100 Mbps; mutually exclusive with `crf` |
| `encoder_preset` | Native software presets from `ultrafast` through `veryslow` |

Without `file_path`, the host chooses a unique MP4 name in Downloads. No picker
opens. The return value has `{ok:true, file, size, metadata, elapsed_seconds,
settings, warning?}`. Metadata is probed from the finished file and contains
`duration_sec`, dimensions, fps, video/audio codecs and `has_audio`. Settings
describe the effective export configuration; they do not overwrite project export
preferences. A returned file can be read with Node or imported with
`context.media.import({path: result.file})` for the existing preview/insertion API.

Malformed options, stale document IDs, invalid sections, validation refusals and
encoder failures reject. Cancellation rejects with `name === 'AbortError'`.
An exception in a progress callback does not cancel encoding.

## Native lifecycle

The normal export UI identifies the requesting extension and provides Cancel.
`onProgress` receives bounded plain data: monotonic `progress` between 0 and 1,
optional phase/stage, phase progress and elapsed/remaining seconds. Updates are
limited to ten per second, with final completion delivered separately. No project
snapshot or temporary frame path is exposed in progress. The export result still
waits for actual encoding, verification and publication.

Only one extension export runs at a time; an active native, agent or GIF render
also blocks it. Calls during activation are refused. Ordinary command/service
deadlines pause while that request chain awaits a managed export, then resume;
unrelated requests keep their deadlines. This also covers nested commands,
services and stream pulls.

AbortSignal, Stop, disable/removal and editor loss cancel managed work. Stop waits
for render cleanup. A renderer that fails to acknowledge cancellation has a
five-second reply grace; native work is still canceled and its frame resources
are released. The native encoder checks the exact activation and cancellation
state immediately before publishing the finished file. A replacement activation
cannot finish an old render. Existing destinations survive cancellation or
failure before publication, and source media cannot be overwritten. Once a file
has been published successfully, cancellation during optional cover work retains
that complete file.

The call runs `export.validate` and `export.willRender`, including private staged
edits and their atomic Undo commit. See [save/export hooks](plugin-extension-hooks.md).
The render uses the resulting snapshot. Later timeline edits do not mutate an
in-flight render. Preparation is a document edit; after its successful commit, an
encoding failure retains that whole edit for Undo. Export calls from inside
validation/preparation are rejected to prevent recursion.

The optional [workbench example](../../examples/extensions/workbench/README.md)
includes a managed render command with progress and cancellation.

## Verification

Focused suites cover input limits, section snapshots longer than review limits,
publication ordering, owner isolation, bounded progress, cancellation drain,
unresponsive-renderer cleanup and request-chain deadlines. The native workflow
checks encoded caption pixels, source frames at section boundaries, actual output
metadata, import/preview, preserved preferences, overwrite protection, both native
and SDK cancellation, stop/restart and default output selection. Exact results
belong in `plugin-validation.json`; macOS development checks do not prove the
remaining full regression, ASAR or Windows/Linux release gates.
