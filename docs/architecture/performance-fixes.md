# Editing and export performance

Scope: address the original nine performance findings and the follow-up source
review. Preserve rendering, timing, cancellation, project persistence and Undo.
No push or installer packaging is part of this work.

## Implementation

- Hardware: macOS uses Chromium's normal video-decode policy. Export probes real
  VideoToolbox H.264/HEVC encodes and retries failures with the matching software
  codec. The Windows driver workaround and explicit environment overrides remain.
- Playback: the application root publishes seeks and pause positions; the live
  clock paints preview/transport/playhead updates directly. Inspector/timeline
  consumers subscribe at a lower rate. Interval indexes resolve active clips,
  while a nearby-media pool bounds mounted overlays and audio elements.
- GPU: intermediate effect passes stay in framebuffer textures. Adjustment,
  strength and region values use uniforms, with bounded program/LUT caches and
  resource disposal. Preview chroma key, spill suppression and companion masks
  run on the GPU, retaining the CPU fallback. Export readback buffers are reused.
- Effect export: process actual affected intervals, seek directly into sources,
  prefetch bounded frame batches, and preserve explicit frame counts across
  concatenated spans. Zero-strength effects schedule no preprocessing.
- Output planning: expensive raster passes use the resolved output size and FPS
  while text, masks and transforms retain logical project coordinates.
- Text: reuse unchanged canvas surfaces. Sparse layers encode timestamped holds
  using lossless RGBA PNG surfaces and a variable-frame-rate RLE movie; dense
  animation keeps the raw delta stream. Cached/blank loops yield for Cancel.
- Timeline: horizontal clip/tick/filmstrip filtering and vertical clip/layer-row
  filtering limit mounted content. Effect row allocation uses heaps and preserves
  first-free-row placement. Row geometry is memoized; markers follow the viewport.
- State: incremental layer placement, snapshot revision caching and reusable
  validated actions avoid repeated whole-project work. Background media metadata
  retains shared media arrays across Undo snapshots.
- Persistence: recovery, slots and file saves share a bounded serialization cache
  backed by a renderer worker. Atomic file and slot writes run on one ordered
  Electron worker. Close-time flushes await durable writes.
- Background work: selected proxies precede optional visuals. High and the Full
  compatibility fallback share an encode; lower levels defer a separate Full
  copy until requested. A shared budget prioritizes proxies, defers queued work
  during exports, and holds optional visuals during playback. In-flight work
  finishes with limited codec threads and reduced process priority.
- Render reuse: completed text, effect ranges and transitions enter a session
  cache bounded by bytes and entries. Source fingerprints, renderer versions,
  output settings and effect/text identities invalidate stale renders. Partial or
  canceled work is never retained. Cache failures do not discard valid output.

## Verification

The implementation and requirement audit are complete. The full battery has **113 passing suites and 13 pre-existing failures**, with no newly failing suites. The failures include existing agent/audio/transition assertions as well as unavailable fixtures, platform tools, a live library service and telemetry configuration; they are not all environment-only.

The authoritative machine-readable record is [performance-validation.json](performance-validation.json). It records the source hashes, evidence paths, unchanged baseline verification, all remaining suite failures and real-app checks.

### Original findings checked

- [x] macOS decoding and real hardware export/fallback: policy contracts and actual H.264/HEVC export suite.
- [x] Playback root rendering: live-clock UI actions, project-load race protection and isolated playback measurement.
- [x] GPU pass chaining: no intermediate readback; byte-identical sampled output and unchanged literal-reference catalog metrics.
- [x] Effect ranges and transfer pipeline: disjoint ranges, direct seeking, bounded batches, fractional frame bounds, color/alpha preservation and transitions.
- [x] Early output planning: compiled-app output dimensions/FPS, logical text placement and duration checks.
- [x] Text reuse: sparse/dense roundtrips, animation/word/decode/template exports and every decoded benchmark frame compared.
- [x] Timeline virtualization: horizontal/vertical mounting, late clip selection/deletion/Undo and equivalent first-free-row allocation.
- [x] Reducer/revision/preflight work: ownership, stale/forged/locked actions, Undo, snapshot revision and local tool workload.
- [x] Proxy scheduling: selected quality first, shared High/Full, deferred Full, no upscaling, concurrent requests and real quality switches.

Follow-up checks cover exact inspector event times, shader cache eviction, GPU key/mask parity, bounded preview media and old-decoder cleanup, background scheduling, render cache invalidation, atomic persistence and edits made while Save is pending. The compiled module worker executes under normal file-origin security.

### Representative measurement

The same synthetic workload runs separately against the preserved source and final source. Both use an explicit system Arial font and force libx264, so hardware availability does not explain the pipeline speedup. These are single-run development measurements.

| Workload | Before | After |
| --- | ---: | ---: |
| Playback, 800 captions | 26.4 fps | 60.0 fps |
| Playback frame gap, p95 | 50.1 ms | 17.6 ms |
| Mounted timeline clips | 801 | 308 |
| 30 manual state edits, 1,200 captions | 115.7 ms | 3.1 ms |
| 30 local agent tool edits | 476.7 ms | 49.2 ms |
| Static title export, 6 seconds | 682 ms | 302 ms |
| Static text readbacks / encoded overlay frames | 180 / 180 | 17 / 17 |
| Effect export, 1-second effect on a 6-second clip | 9697 ms | 475 ms |
| Effect preprocessing frames | 360 | 24 |
| Effect read / write IPC calls | 360 / 360 | 6 / 6 |
| Intermediate GPU readbacks, chained-effect sample | 180 | 0 |

The effect workload starts from a 1280x720/60-fps project and exports 480x270/24-fps output. The final movie retains its six-second duration and audio. Local agent measurements exclude model/network time and UI settling. All 180 decoded static-text output frames are RGB-identical; the output remains 180 frames even though its intermediate needs only 17 encoded samples.

### Real-app evidence

- Clock, inspector, pools and timeline: `/tmp/clipcraft-performance-final-events-ui/result.json`.
- GPU/literal catalog comparison: `/tmp/clipcraft-performance-complete-contracts-ui/result.json`.
- Compiled-app export, LUT loading, reuse and cancellation: `/tmp/clipcraft-performance-compiled-export-ui/result.json`.
- Compiled worker, recovery, Save ordering and durable close flushing: `/tmp/clipcraft-performance-compiled-worker-proof/result.json`.
- Agent editing and Undo: `/tmp/clipcraft-performance-completion-agent-ui/result.json`.
- Native Codex protocol fixture: `/tmp/clipcraft-performance-verified-native-ui/result.json`.

The original source remains at `/tmp/clipcraft-performance-baseline`, with its source hash manifest verified unchanged. Only its test harness was refreshed for the identical workload. No installer was packaged and nothing was pushed.

## Export with looks and effects, library effect panels (second round)

A real-app tour (six 20 s 1080p30 clips, Apple silicon Mac) found two problems
that dominated the experience: any filter, LUT, Adjust grade or shader effect made
an export about 15× slower, and opening the Effects or Transitions panel froze the
interface for about half a second.

- **Colour-only looks become one 3D LUT** (`src/features/export/colorLut.js`).
  A look qualifies when every pass reads only its own pixel's colour (no position,
  neighbours, time or noise). It is baked once with the preview's own shaders on an
  86-point lattice (every point an exact 8-bit value), checked against the exact
  shader on 65,536 colours between lattice points (99.9th percentile ≤ 2 levels,
  max ≤ 6), and written by the main process as a `.cube` file
  (`FxJobs.lut`; the interface never supplies its path). FFmpeg applies it with
  `lut3d` where the shader would have run (fitted, straight RGBA). Looks with hard
  steps (posterize) fail the check, and spatial looks (vignette, clarity, sharpen,
  grain, sketch: 14 of the 52 filters) keep the frame-by-frame path.
- **The frame-by-frame path** (spatial effects, transitions):
  - macOS gives a child's stdio 8 KB socket buffers, so a 1080p frame arrived in
    about 1,000 reads, and each read is costly in Electron's main process (12.6 s of
    main-process CPU for 600 frames). `electron/export/framePipes.cjs` gives
    FFmpeg's stdout a 1 MB send buffer (the system Perl sets the option, then
    `exec`s FFmpeg: same pid), which makes the reads 64 KB (1.3 s for 600 frames). Encoder input
    goes through a private named pipe with one blocking write per frame (1.1 s of
    CPU per 300 frames instead of 5.2 s). Other platforms keep stdio.
  - Readback: a mirrored `blitFramebuffer` replaces the CPU row flip, and
    `readAsync`/`finish` read through a pixel buffer and fence one frame later, so
    the GPU copy overlaps the next frame (a synchronous `readPixels` cost ~13 ms per
    frame).
  - Frames cross between the page and the preload as transferred buffers in window
    messages (`src/features/export/fxChannel.js`); contextBridge copied each 8 MB
    frame (~6 ms each way). Writes stay in flight (two at a time) and the main
    process queues them in order.
  - The FFV1 intermediate is sliced and threaded: the same decoded bytes, encoded
    in 1.27 s instead of 2.25 s per 150 frames.
- **Effect panels**: tile stills are drawn by a shared queue (visible tiles first,
  6 ms per frame) and kept for the session; the GPU program cache holds 256
  programs (the panels need ~210). Each still used to compile its shader while the
  panel mounted.

| Workload (real app) | Before | After |
| --- | ---: | ---: |
| Export 2 min 1080p, filter on every clip | 0.46× realtime (measured on 40 s) | 24.2 s (4.95×) |
| Export 2 min 1080p, filter + shader effect on every clip | 263.2 s | 85.0 s (1.41×) |
| Export 40 s, filter / Adjust grade | 86.6 / 88.6 s | 9.2 / 8.7 s |
| Export 40 s, shader effect | 87.9 s | 36.0 s |
| Export 2 min 1080p, no look (unchanged path) | 17.3 s | 17.4 s |
| Open Effects panel (main thread blocked) | 648 ms (604 ms) | 46 ms (0 ms) |
| Reopen Effects panel | 442 ms | 35 ms |
| Open Transitions panel (blocked) | 547 ms (490 ms) | 59 ms (0 ms) |

LUT exports versus the frame-by-frame export of the same look (filter, grade,
LUT filter, filter + grade): 46.8–47.3 dB PSNR
(H.264 noise floor). The parity smoke (`tests/unit/export/test-effect-parity-ui.cjs`)
covers a baked look and the posterize fallback. The interface stays at 60 fps
during these exports (frame p95 18 ms).

## Limits to report

The export path still has one final GPU readback and process transfer for newly
rendered effect frames. The changes remove intermediate readbacks, reduce frame
counts and copies, batch transfers, and reuse completed renders; they do not add a
native zero-copy GPU/encoder bridge. In-flight background subprocesses finish
rather than being killed when foreground work starts.

The catalog's literal GPU reference has existing precision differences from the
JavaScript CPU reference in some spatial effects. The new shaders must retain the
literal-reference results; these pre-existing differences are not relabeled as
passing CPU parity.
