# Export quality (implemented 2026-10-31)

One resolver — `src/exportQuality.js` — turns the stored settings (`project.exportSettings`) into the
**effective** export configuration. Project Settings shows it, the Export dialog's pre-export summary
renders it, and the renderer stamps it onto the project (`project.export`) that `electron/ffmpeg.cjs`
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
- **H.265 is software-only** (libx265) in this build — the bundled FFmpeg has libx265 (verified) but
  no hardware HEVC; if libx265 were missing, the export falls back to H.264 and the summary says so
  (capability comes from the main process via `export:caps`).
- Hardware H.264 encoders (when present) get mapped equivalents of the same intent: NVENC preset
  levels p1–p7 for the speed names + CQ = CRF+3, QSV takes the preset names + global_quality = CRF+3,
  AMF collapses to speed/balanced/quality + QP = CRF+2; bitrate mode passes the target bitrate.
  (The bundled ffmpeg-static build ships no HW encoders, so exports here run on libx264/libx265.)
- Choosing an fps above the timeline's duplicates frames via the fps filter — noted in the summary.
- The resolution/fps output stage runs on the finished picture in `buildExportArgs`; the raw FX
  pass is untouched (always project size).

## Verification — `scripts/test-export-quality.cjs`

Same 5 s 1280×720@30 testsrc2 project through the real `runExport` path (measured 2026-10-31):

| Export | Resolution | Size (bytes) | Video kbps | Audio kbps | PSNR vs source |
|---|---|---|---|---|---|
| Low | 720×406 | 250,138 | 293 | 96 | 32.57 dB |
| Medium | 1080×608 | 1,127,655 | 1,665 | 128 | 36.28 dB |
| High | 1280×720 | 2,932,445 | 4,489 | 192 | 49.54 dB |
| Ultra | 1280×720 | 3,496,759 | 5,361 | 222 of 320 req. | 53.13 dB |
| Custom (8 Mbps, cap 720) | 720×406 | 4,529,965 | 7,108 | 128 | 33.68 dB |
| Custom H.265 (CRF 28) | 1280×720 | 1,131,836 | 1,699 (HEVC) | 96 | 38.13 dB |

Asserted: sizes strictly increase Low<Medium<High<Ultra; PSNR increases with tier; Ultra resolution
== project resolution; Custom longest side ≤ 720 and video bitrate within ±25% of target (7,108 vs
8,000); H.265 output is HEVC. Ultra's audio measures 222k because a pure 440 Hz sine cannot fill a
320k AAC allocation — the 320k argument itself is pinned by an args-level assertion.
