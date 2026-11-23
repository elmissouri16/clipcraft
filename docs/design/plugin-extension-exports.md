# Trusted extension video export

`workspace.read()` reports both overall `duration_sec` and native
`export_duration_sec`. The main picture and custom visual or audio tracks determine the native video
export extent. Ordinary audio or text tails and custom metadata can extend the
document without extending the video. The GIF
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
| `format` | `mp4`, `mov`, `mkv` or `webm`; defaults to MP4, or infers the supplied path suffix |
| `file_path` | Optional absolute local destination whose suffix matches its format, with an existing parent folder |
| `overwrite` | Defaults to false; true explicitly permits replacing an existing regular file |
| `range` | `{start_sec, end_sec}`, finite increasing timeline seconds |
| `quality` | `low`, `medium`, `high`, `ultra`; otherwise current project settings |
| `codec` | `h264`, `h265`, or `vp9` where the container supports it; H.265 capability fallback follows native export |
| `resolution` | Longest-side cap: `0` (original), 480, 720, 1080, 1440, 2160; never upscales |
| `fps` | `0` (timeline), 24, 25, 30, 50, 60 |
| `audio_kbps` | 96, 128, 192, 256, 320 |
| `crf` | Integer 0–51 for H.264/H.265, 0–63 for VP9 |
| `bitrate_mbps` | Target 0.5–100 Mbps; mutually exclusive with `crf` |
| `encoder_preset` | Native software presets from `ultrafast` through `veryslow` |

Without `file_path`, the host chooses a unique name with the selected format's
extension in Downloads. No picker
opens. The return value has `{ok:true, file, size, metadata, elapsed_seconds,
settings, warning?}`. Metadata is probed from the finished file and contains
`container` (the actual ffprobe container name), `duration_sec`, dimensions, fps,
video/audio codecs and `has_audio`. Settings
describe the effective export configuration; they do not overwrite project export
preferences. A returned file can be read with Node or imported with
`context.media.import({path: result.file})` for the existing preview/insertion API.

## Native containers and codecs

| Format | Video | Audio |
| --- | --- | --- |
| MP4 | H.264 or H.265 | AAC |
| QuickTime MOV | H.264 or H.265 | AAC |
| Matroska MKV | H.264, H.265 or VP9 | AAC |
| WebM | VP9 | Opus |

WebM selects VP9 automatically. An explicitly incompatible codec or mismatched
path suffix rejects before rendering. The host validates the reserved destination
format again against the renderer's settings, and the encoder uses an explicit
muxer plus a temporary filename with the matching extension. Outputs are native
encodes, not MP4 files renamed to another suffix.

VP9 requires the bundled `libvpx-vp9` and `libopus` encoders. The native selector
disables unavailable WebM export; a saved unavailable preference remains readable
and the export action explains its unavailable state. SDK calls reject rather
than silently producing H.264. Discover the contract through `exports.formats`.
Software speed presets map to VP9 `cpu-used` levels 0–5 with the `good` deadline;
CRF uses `-b:v 0`, while bitrate mode uses the requested target. These controls
are described by the [FFmpeg libvpx encoder documentation](https://ffmpeg.org/ffmpeg-all.html#libvpx).

The native Export dialog stores its format independently of quality. Changing
format clears an already chosen destination; Browse and renaming use the selected
extension. Native summaries report the actual video and audio codecs. SDK format
overrides affect only their render snapshot, and default to MP4 even when a
different native format is saved. Review previews remain MP4. Embedded poster
pictures remain an MP4 option; other containers use their ordinary first frame.

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

## Native-format expansion verification

The real Electron workflow passed 40 checks, including SDK and native
format selection, decoded MOV/MKV/WebM captions, suffix refusal, destination
changes, actual VP9/Opus summaries, preserved preferences, cancellation and
exclusive publication. Its format-selector screenshot was inspected. The custom
GLSL scene also passed its WebM pixel comparison and cold-restart workflow.

The standalone matrix encoded and decoded 8 format/codec/rate profiles,
covering H.264, H.265 and VP9, both VP9 quality and bitrate modes, actual
container signatures and audible audio. All 17 selected regressions and
9 SDK suites passed. SDK source changes were empty during verification;
only the matrix test was extended afterward, then passed independently. Product
source and author declarations are unchanged from the SDK receipt. Renderer,
structure, localization and whitespace checks passed.

Receipts, measurements and the corrected Browse-label fixture failure are under
`extensionNativeFormats` in the validation ledger. Subsequent
[custom](plugin-custom-hooks.md) and [document lifecycle](plugin-document-lifecycle-hooks.md)
hook slices have their own receipts. These are local macOS development checks.
