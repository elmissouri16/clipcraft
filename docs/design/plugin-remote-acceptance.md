# Remote matrix, installed-app acceptance and release automation

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This follows
[unfinished extension acceptance](plugin-extension-unfinished.md) after the
maintainer authorized pushing the branch to the fork and building installers in
CI only. Nothing was published; SDK v1 and production release stay on hold for
the gates listed at the end.

## SDK validation matrix

The [SDK workflow](../../.github/workflows/plugin-sdk-validation.yml) ran on
GitHub-hosted runners for the first time. Run 44223811817 (commit `7cbf43f`)
passed on Ubuntu and macOS and failed two of nine suites on Windows, on both
Node versions:

- `test-extension-package-paths`: on Windows the tar reader rewrites `\` to
  `/` in entry names before the package reader sees them. An archive entry
  named `dist\outside.js` was therefore admitted as `dist/outside.js` on
  Windows and refused on Linux and macOS. The reader now judges names as the
  archive wrote them (raw header name, PAX `path`/`linkpath` records and GNU
  long names). The suite gained PAX and GNU cases and reruns every malformed
  archive through a reader that believes it is on Windows, so each platform
  proves the refusal. Without the fix that check reports three archives accepted.
- `test-extension-resource-admission`: the legacy fixture's recorded
  fingerprint covers its exact bytes and the Windows checkout converted them to
  CRLF. Converting a copy to CRLF locally reproduces the Windows value exactly.
  `.gitattributes` now marks `tests/fixtures/plugins/legacy/**` as `-text`.

Run 44224897377 (commit `1075d0d`) then passed all six jobs:
Ubuntu, Windows and macOS on Node 20.19.0 and 24.22.2.

## Installed-app acceptance

[`scripts/verify-packaged-app.cjs`](../../scripts/verify-packaged-app.cjs)
inspects a packaged build and drives the installed application over the
DevTools protocol with a fresh profile. The
[packaged-app workflow](../../.github/workflows/packaged-app.yml) builds the
release-configuration installer on each runner, installs it (apt for the .deb,
silent NSIS, DMG copy) and runs the script. Run 44224897396 (commit
`1075d0d`):

| Platform | Runner | Installer | Bytes | SHA-256 | Checks |
| --- | --- | --- | ---: | --- | ---: |
| Linux x64 | `ubuntu-latest` | `clipcraft_2.0.0_amd64.deb` | 184,724,072 | `be7247faebd416da…` | 29 |
| Windows x64 | `windows-latest` | `ClipCraft-Setup-2.0.0.exe` | 199,774,974 | `31f0297b9e59b853…` | 29 |
| macOS arm64 | `macos-latest` | `ClipCraft-2.0.0-arm64.dmg` | 195,844,549 | `44e314371a96adb3…` | 29 |
| macOS x64 | `macos-15-intel` | `ClipCraft-2.0.0-x64.dmg` | 219,066,880 | `0f36be1f941366b1…` | 29 |

Each run passed the same 29 checks: the archive ships the entry points, licence
files and shared data and no tests or sources; its version is 2.0.0; the bundled
content pack is absent; unpacked ffmpeg and ffprobe execute; the application
starts sandboxed from the archive and reports 2.0.0; the home screen renders;
ffprobe reads a clip and ffmpeg extracts a frame through the application; the
plugin inventory answers; the editor loads a project; and a real export
produces a 640x360 H.264/AAC file of the expected length.

Limits, as recorded in every receipt: no installer UI, save/reopen dialog,
extension installation or keychain is exercised; the screenshot's pixels are
not asserted; the application is stopped by signal. These runs do not replace
the native plugin UI suites, which still run only on the development build.

### macOS is one DMG per architecture

The first packaged run (44223811766) failed on macOS: the universal merge
refused the build because each architecture ships a different ffprobe file.
The bundled ffmpeg is also downloaded for the build machine's architecture
only, so a merged application would have carried a single-architecture ffmpeg.
The release configuration now builds `ClipCraft-<version>-<arch>.dmg` on an
arm64 and an Intel runner; the receipts record matching application, ffmpeg and
ffprobe architectures for each (arm64 and x86_64).
Installers are unsigned and not notarized.

## Release automation (REL-01)

[`release.yml`](../../.github/workflows/release.yml) runs on a push to
`release/vX.Y.Z`. It calls the SDK matrix and the installed-app acceptance and,
only when both pass, creates a draft release from the exact installers that
were installed and verified, checking each file's SHA-256 against its receipt
and the branch name against the package version. Publishing the draft is a
manual maintainer action. The SDK package is not published by any workflow.
The release workflow itself has not run: no release branch exists.

## Other changes in this pass

- SFXMint ended keyless API downloads on 2026-11-17 (`429 download_limit`,
  tier `anon`, limit 0). The earlier 429 was this policy, not throttling. At
  the maintainer's direction SFXMint was withdrawn as a sound source; sounds
  already kept on disk stay usable. `test-library` passes against the live
  services again.
- Full macOS battery on commit `1075d0d`, two workers, quiet profile:
  351 PASS / 4 FAIL of 355 suites. The failures are the Windows-only caption
  prerequisite, the absent sibling asset manifest, and two UI readiness timeouts
  under parallel load (`test-plugin-settings-ui`, `test-language-ui`). Both
  passed when rerun together immediately afterwards; they are recorded as
  intermittent, not waived.

## Still open

- Hardware/performance budgets (PERF-01) need maintainer-approved workloads and
  thresholds.
- Manual, assistive-technology and real-provider acceptance (UX-01).
- The original sibling `asset-pack/library-manifest.json` and the Windows
  caption prerequisite.
- Code signing and notarization, a release run on a real release branch, and
  SDK publication, none of which is authorized.
- The historical export timeout remains unattributed.

Evidence: `plugin-validation.json.extensionRemoteMatrixInstalledApp`; run
artifacts are retained on GitHub for 14 days.
