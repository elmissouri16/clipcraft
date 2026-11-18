# Native media archive paths

This continues the local work while the
[blocked acceptance gates stay unfinished](plugin-extension-unfinished.md).
App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

## Reproduced failure and correction

The media module replaced the first `app.asar` substring in each native binary
path with `app.asar.unpacked`. In a real archive under a parent named
`app.asar tools space`, it changed that parent instead of the actual archive.
The normal archive exported successfully, then the relocated case failed its
exact path assertion. The failure is retained. The same blind substitution also
affected external `FFMPEG_BIN` overrides containing that substring.

The new internal `nativePaths.cjs` helper anchors mapping to the enclosing
application root of the media module. It maps a binary under a real archive to
that archive's `.unpacked` sibling. It preserves outside, relative and already
unpacked paths. A real source directory named `.asar` is not treated as an
archive. The preferred native ffprobe package and existing fallback selection
are unchanged.

Electron virtualizes an archive root as a directory, so the helper uses
`original-fs` for the physical-file check in Electron and ordinary Node fs in
plain Node. See Electron's
[ASAR filesystem documentation](https://github.com/electron/electron/blob/main/docs/tutorial/asar-archives.md).
An initial harness assertion incorrectly used virtual `fs.stat`; that separate
fixture failure was corrected before reproducing the production path bug.

## Native verification

The standalone test creates an ASAR containing the real media/export/audio/shared
modules, `ffmpeg-static`, the ffprobe installer and this platform's native ffprobe
package. Native package directories use ASAR's
[unpack options](https://github.com/electron/asar). The runner is copied outside
the checkout, has no `NODE_PATH`, and refuses application CJS dependencies outside
the archive. It runs under actual Electron with an isolated explicit profile.
No installer is built.

| Native layout | Result |
| --- | --- |
| Normal `app.asar` | Five checks pass, including real export and decoded output. |
| Parent named `app.asar tools space` | Five checks pass with only the actual archive mapped. |
| External FFmpeg override containing `app.asar` | Five checks pass with the literal override preserved. |
| Missing unpacked FFmpeg | Two refusal checks pass with ENOENT and no checkout/PATH fallback. |

Each positive case generates a one-second 64×36 blue video with a sine tone,
probes it, exports through the production media module, and validates it through
the host generated-artifact inspector. All 12 frame timestamps match the requested
12 fps grid. The first decoded frame is blue and decoded audio contains the tone.
This synthetic source is not representative footage or manual media acceptance.

All seven selected suites passed: these native layouts, literal source paths,
the seven-profile real encoder/frame-rate grid, the FIFO race regression,
artifact-inspector limits/cancellation, archived worker/views, and the real editor's
extension export workflow. The editor workflow passed 29 checks with no renderer
exceptions. Source remained unchanged during verification; structure and
whitespace checks passed.

The source-path suite separately reads the actual public media path in plain
Node for four literal overrides and verifies that a physical source directory
named `.asar` is not rewritten. Native layouts use the installed local binaries;
their hashes, archive hashes, output metadata, pixels, audio measurements and
precise toolchain are retained in the evidence.

Evidence: `plugin-validation.json.extensionNativeMediaPaths` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-jn_fcxl7/verification.json`.

## Unfinished scope

These are macOS arm64 archive/media development checks. They do not certify the
complete electron-builder application payload or installed Windows/Linux/macOS
release artifacts. They add no public SDK capability or version. The skipped
installer/publication, platform, service, hardware and manual gates remain
unfinished. No full battery, SFXMint request, installer, publication, commit or
push was produced.

The remaining local resource review identified eager count-after-read checks in
preview-cache enumeration and a stat-then-unbounded-read in retained panel data.
Those concrete findings continue separately; no performance budget is inferred
from the native export checks above.
