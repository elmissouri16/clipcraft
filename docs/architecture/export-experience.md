# Export experience, efficiency and macOS compatibility

## Output formats

Choose the container in the video export dialog. The selected format determines the available video and audio codecs.

| Output | Video | Audio when present |
| --- | --- | --- |
| MP4 | H.264 or H.265 | AAC |
| QuickTime MOV | H.264 or H.265 | AAC |
| Matroska (MKV) | H.264, H.265 or VP9 | AAC |
| WebM | VP9 | Opus |

MP4 supports an embedded cover from the composed frame. For an audio-only mix,
choose MP3, WAV or M4A in the export menu. To generate an animated GIF, install
the GIF export extension and select its range, size and frame rate.
[GIF example](../../examples/extensions/gif-export/README.md)

Extensions use `exports.render` for native video output. They can supply a range
inside the renderable timeline, request progress, cancel a render and inspect the
finished file's dimensions, duration and codecs. The output path suffix must
match the container. [Extension export reference](../design/plugin-extension-exports.md)

The export timing and platform observations below were recorded on 2026-11-06.

## Export experience

- Overall ETA includes preparation, captions/graphics, effects/transitions, encoding and finishing. It starts with an estimating state, smooths measured progress, and learns phase rates from successful exports in local storage. Cache hits and canceled runs do not train cold-render speeds. The estimate is approximate and updates between stages.
- Elapsed time, current step, hardware/software status, accessible progress and completion time are shown. Technical specifications are expandable. The dialog keeps keyboard focus and restores it when closed.
- Rendering updates are throttled to five per second, with immediate phase changes. Split FFmpeg progress records are parsed correctly; a software retry recalibrates timing without moving the overall bar backward.
- Cancel stops preprocessing and encoding. Failed/canceled runs preserve an existing destination file. Video and optional cover replacements are published with same-filesystem renames only after their outputs complete. Temporary files are cleaned afterward.
- Minimized exports keep rendering without timer throttling. Dock/taskbar progress and app-suspension prevention are released on completion, failure, cancellation, renderer loss and quit. Display sleep is not blocked.

## Efficiency

Inactive overlay compositing and blending are skipped outside their timeline windows. In the fixture (4 seconds, 720x1280, 24 fps, ten brief screen-blended image overlays, libx264 veryfast; four runs per version), median export time changed from 2.746 s to 2.257 s, a 17.8% reduction. All decoded frames matched. This is a workload-specific result, not a promise for every project.

## Codex and macOS

- Codex SDK and its native dependency are pinned to 0.167.0. The native app-server tool callback loop is preserved.
- Model discovery uses model/list with pagination, supported reasoning efforts and display names. Concurrent model/capability loads share one connection. A short cache and explicit refresh reduce unnecessary process starts. Older/offline installations retain cached models, custom IDs and the CLI-default option. Existing model preferences are preserved.
- Native tool registration and model discovery were checked against the actual 0.167.0 binary. No inference request was made in that live compatibility check; tool execution/cancellation are additionally covered by protocol fixtures.
- Finder launches can use a native Codex runtime downloaded on demand in Settings without npm/Node on PATH, reusing the existing Codex sign-in. Codex and Claude native distributions are excluded from the application package; the lightweight SDK adapters remain. A usable absolute sign-in command is supplied for a downloaded engine.
- Native FFprobe is selected for Apple Silicon rather than the Intel-only ffprobe-static binary. Existing legacy fallback remains for unsupported installations. Mach-O and ELF binaries keep executable permissions, and FFprobe payloads are unpacked for native execution; downloaded agents run from the application support cache. Intel packaging paths are covered by configuration/permission tests; physical hardware verification used this Apple Silicon Mac.

Official integration references: [Codex SDK](https://developers.openai.com/codex/sdk), [app-server and model/list](https://developers.openai.com/codex/app-server), [Electron background throttling](https://www.electronjs.org/docs/latest/api/web-contents#contentssetbackgroundthrottlingallowed).

## Validation

Full battery: 124 PASS / 12 FAIL of 136 suites, with no new failing suite compared with the preceding battery. The remaining failures are the preexisting agent fixtures, audio/channel-layout, platform/font, captions, content-pack/library and telemetry suites; they are not all environment-only.

Final focused checks passed for ETA/retries/cache behavior, live-encode cancellation, atomic publication, native agent callbacks, live model catalogs, permissions, and actual UI behavior. The latest real-app run passed 15 checks, including minimizing during export and embedding the cover. Renderer compilation, structure and whitespace checks passed. No installer was built.

Logs, source hashes, measurements and compatibility evidence: [export-experience-validation.json](export-experience-validation.json).
