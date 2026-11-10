# Export quality (implemented 2026-10-31)

One resolver — `src/features/export/exportQuality.js` — turns the stored settings (`project.exportSettings`) into the
**effective** export configuration. Project Settings shows it, the Export dialog's pre-export summary
renders it, and the renderer stamps it onto the project (`project.export`) that `electron/media/ffmpeg.cjs`
consumes. One source of truth: the summary is the export, not a description of it. `project.crf`
stays in sync for back-compat (picking a preset or a Custom CRF writes it). Projects saved before
presets migrate by nearest CRF (28→Low, 23→Medium, 20→High, 16→Ultra); unstamped projects keep the
historical encoder behavior exactly (CRF `project.crf || 20`, veryfast, AAC 192k, project size/fps).

## Presets

| Preset | Mode | Encoder preset | Audio | Resolution cap |
|---|---|---|---|---|
| Low | CRF 28 | fast | AAC 96k | 720 (longest side) |
| Medium | CRF 23 | medium | AAC 128k | 1080 (longest side) |
| High | CRF 18 | slow | AAC 192k | none |
| Ultra | CRF 14 | veryslow | AAC 320k | none |

## Custom

Mode CRF (0–51) or target video bitrate (1–60 Mbps in the UI; resolver clamps 0.5–100), resolution
cap Original/2160/1440/1080/720/480, fps Project/24/25/30/50/60, codec H.264/H.265, encoder preset
ultrafast→veryslow, audio 96/128/192/256/320 kbps.

## Stated rules (also shown as notes in the UI)

- Caps apply to the **longest side** and **only downscale** — nothing is ever upscaled; output
  dimensions are rounded to even (yuv420p). Ultra on a 720p project exports 720p and says so.
- **H.265 encoder choice:** on macOS the bundled FFmpeg has `hevc_videotoolbox`; `pickEncoder('h265')`
  test-encodes half a second with it once per session and uses it when that succeeds (the summary says
  "H.265 · VideoToolbox"), with `-tag:v hvc1` so QuickTime/iOS play the file. Elsewhere, and when the
  probe fails, H.265 encodes in software with libx265 (same hvc1 tag). If libx265 were missing too, the
  export falls back to H.264 and the summary says so (capabilities come from the main process via
  `export:caps`: `{ libx265, h265Hardware }`).
- Hardware H.264 encoders (when present) get mapped equivalents of the same intent: NVENC preset
  levels p1–p7 for the speed names + CQ = CRF+3, QSV takes the preset names + global_quality = CRF+3,
  AMF collapses to speed/balanced/quality + QP = CRF+2; bitrate mode passes the target bitrate.
  VideoToolbox (macOS) maps CRF to `-q:v` on its 1–100 scale. Which hardware encoders exist depends
  on the platform's ffmpeg-static binary: the macOS build has VideoToolbox (verified, both codecs);
  each candidate is checked with `-encoders` and a real test encode before it is used, and a hardware
  export that fails mid-run is retried with the matching software encoder.
- **Colour matrix of the sources.** Compositing runs in RGB, so every video source is converted from
  YUV once on the way in and back to BT.709 once on the way out (`TO_YUV709`). A source that carries a
  matrix tag is read with it. An UNTAGGED source is read as BT.709 when it is 1280×720 or larger and as
  BT.601 (`smpte170m`) below that (`matrixIn` in `electron/media/ffmpeg.cjs`) — what players and the
  preview (Chromium) do. FFmpeg's own default for untagged video is BT.601, which produced a 601-in /
  709-out mismatch on untagged HD sources: measured 23.7 dB PSNR instead of 35.6 dB, a visible shift
  on saturated colours (fixed 2026-11-09). HDR sources are tone-mapped (`TONEMAP`) instead; images
  decode straight to RGB.
- Choosing an fps above the timeline's duplicates frames via the fps filter — noted in the summary.
- The resolution/fps output stage runs on the finished picture in `buildExportArgs`; the raw FX
  pass is untouched (always project size).

## Verification — `tests/unit/export/test-export-quality.cjs`

Same 5 s 1280×720@30 testsrc2 project (untagged source) through the real `runExport` path
(measured 2026-11-09, after the colour-matrix fix):

| Export | Resolution | Size (bytes) | Video kbps | Audio kbps | PSNR vs source |
|---|---|---|---|---|---|
| Low | 720×406 | 242,576 | 281 | 96 | 28.87 dB |
| Medium | 1080×608 | 1,024,484 | 1,500 | 128 | 32.80 dB |
| High | 1280×720 | 2,940,977 | 4,502 | 192 | 35.49 dB |
| Ultra | 1280×720 | 3,522,732 | 5,401 | 224 of 320 req. | 35.60 dB |
| Custom (8 Mbps, cap 720) | 720×406 | 4,309,516 | 6,756 | 128 | 29.08 dB |
| Custom H.265 (CRF 28) | 1280×720 | 997,281 | 1,484 (HEVC) | 96 | 33.53 dB |

Asserted: sizes strictly increase Low<Medium<High<Ultra; PSNR increases with tier; High and Ultra
stay above 33 dB (the floor that separates a preserved colour matrix from the 601/709 mismatch, which
measured 23.7 dB); Ultra resolution == project resolution; Custom longest side ≤ 720 and video bitrate
within ±25% of target (6,756 vs 8,000); H.265 output is HEVC.

The PSNR ceiling is set by the compositing path, not the encoder: since the 2026-11-08 move to RGB
compositing, the 4:2:0 → 8-bit RGBA → 4:2:0 round trip of this synthetic source (hard-edged saturated
chroma) tops out at ≈35.6 dB even before encoding, where the earlier YUV-only path measured 53 dB at
Ultra. Real footage loses far less, but "near-lossless" at Ultra now describes the encoder, not the
chroma round trip. Ultra's audio measures 222k because a pure 440 Hz sine cannot fill a
320k AAC allocation — the 320k argument itself is pinned by an args-level assertion.

## Cover picture (fixed 2026-11-09)

The Export dialog's cover chooser scrubs a timeline time (`project.posterAt`). Three things follow
from it, and all three are the **composited** frame — main track, overlays, graphics and text:

- **Preview:** `export:coverFrame` (main process) renders the timeline frame at that time with the
  offscreen preview renderer that also serves the agent's `inspect_frames` (`captureTimelineFrame`),
  1024 px long edge, cached in the media cache per project content + time (newest 32 kept). The
  dialog debounces scrubbing by 200 ms and keeps the previous render up until the next lands.
- **Embedded cover:** after encoding, the frame is grabbed from the **exported file** at that time and
  muxed in as `attached_pic` (`export:cover`), so the cover is what a viewer sees.
- **Project card:** each landed render is also copied to `poster-<project id>.jpg` in the media cache
  and recorded as `project.posterImage` (+ `posterImageAt` for cache busting); `recentEntryFor` shows
  it first. It refreshes whenever the Export dialog opens, so edits made after choosing a cover show
  on the card once the dialog has been opened again.

Before this, all three used a frame of the **main-track source** at the mapped source time, which
showed a blank card for any project whose content sits on overlay tracks (a flat background image
with graphics over it, the common CraftAI layout). JPEG grabs (`export:cover`, `media:frame`) now go
through RGB (`format=rgb24`) before the JPEG encode: JPEG viewers decode with the BT.601 convention,
and copying the video's BT.709 YUV into the JPEG shifted saturated colours (measured 22.9 dB against
the exported frame; 43.6 dB through RGB). `tests/smoke/smoke-export-ux.cjs` checks the preview is a
rendered `-cover.jpg`, the card poster is recorded, and the embedded JPEG matches the exported frame
at ≥ 35 dB.

## Slow image zooms

Animated uniform zooms without rotation use cubic fractional-pixel sampling in
`electron/export/layers.cjs`, including zooms starting, ending or crossing 100%.
A transparent sampling border preserves exposed canvas when shrinking or panning;
the output canvas stays fixed rather than resizing in 2-pixel increments. The
filter's first input frame maps to timeline time zero.

`tests/unit/export/test-smooth-zoom.mjs` checks 100%→106.5% and reverse eased zooms
at 720×406 and 1920×1080, plus mapping, opacity and exposed borders. The
`smooth-zoom` Electron smoke mode exports two scenes through the real effects
and encoder pipeline. Optional `FVE_ZOOM_PROJECT` and `FVE_ZOOM_BASELINE` paths
allow checking a read-only saved project against an older export; all new
artifacts stay under the isolated `FVE_SMOKE` directory.
