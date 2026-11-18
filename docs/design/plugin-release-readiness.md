# Plugin candidate release gate

> Historical candidate report from 2026-11-15. The later trusted Node migration,
> executable retirement and current full-run/followup evidence are recorded in
> [runtime retirement](plugin-legacy-retirement.md). The old recipe rows below
> describe that earlier candidate, not the current supported SDK. Release stays
> on hold pending unresolved prerequisites and Windows/Linux/installed-app gates.
> The subsequent [stabilization checkpoint](plugin-extension-stabilization.md)
> fixes three local prerequisites and records bounded discovery/lifecycle
> measurements; the raw historical runs below remain unchanged.
> Later [remote acceptance](plugin-remote-acceptance.md) records the OS matrix,
> and the [packaged extension followup](plugin-authoring-packaged-followup.md)
> covers current local macOS extension installation. The feature pause and
> SDK 1.0 decision below apply to the historical candidate. Current development
> is pre-alpha, with no compatibility freeze.


Date: 2026-11-15. Decision: **hold SDK 1.0 and production release**.
Feature expansion remains paused. This pass ran the candidate-wide macOS battery,
fixed reproducible integration defects and preserved every unresolved result.
The earlier 79 PASS / 6 FAIL baseline is historical and was not used to waive failures.

## Candidate and execution profile

The final full-battery candidate is the dirty worktree based on HEAD
`331642623c32550de27d1c7075201f575177d63a`, not a new commit. Its manifest contains
889 tracked/nonignored files and 286 discovered suite files. The exact source
manifest, toolchain, logs' hashes and individual results are retained in
[release evidence](plugin-release-evidence.json). One proven fixture-only
correction was made after that full run and verified
separately; application source stayed unchanged. Report/index/evidence edits
also followed the run. The full-run manifest and exact post-fixture delta are retained.

| Run | Source manifest SHA-256 |
| --- | --- |
| Initial | `dd6fa4a64362505b1baf26ad17b205d51eec5a749f21f128db1cbacf89990b55` |
| Integration fixes | `5a91da57e5bc10e1157f00736ba7de33228a59ea931d1d5caebec84ba08a0305` |
| Final | `3a775cae641f9e249673e846ec6aa924eed1dd68856ca8cc837f16a43bfed877` |
| Post-battery fixture only | `f78adaaaf9d3452174c924454d0d47cddc54447ef074c3320b5b5c498e6b5ea3` |

Toolchain: macOS 26.5.2 arm64, Node 24.16.0, npm 11.13.0, Electron 45.3.1,
Vite 6.4.5 and electron-builder 26.18.0. Versions remain application 2.0.0,
host manifest API 1 and SDK 0.8.0. These numbers are separate contracts.

Each full run used `npm test`, two suite workers and `FVE_SMOKE_QUIET=1`,
outside the filesystem/network sandbox so local fixture servers and Electron
could run. Live-agent opt-in flags were absent. Raw runner PASS includes two
whole-suite opt-in skips: native runtime download UI and live OpenCode.
No paid live-provider acceptance is claimed. Quiet-mode focus failures retain
FAIL status; the sequential normal-activation follow-ups are separate evidence.

## Full-battery results

| Run | Raw PASS / FAIL / TIMEOUT | Classified PASS / FAIL / SKIP |
| --- | --- | --- |
| Initial candidate | 265 / 21 / 0 | 263 / 21 / 2 |
| Integration fixes | 278 / 8 / 0 | 276 / 8 / 2 |
| Final audio-crash fix | 278 / 8 / 0 | 276 / 8 / 2 |

The final candidate's tracked/nonignored source manifest and renderer/SDK dist
manifests were compared after the run, before writing this report.
All comparisons were unchanged; no source or generated renderer/SDK file changed during the final battery.

A later pass does not close an unexplained earlier failure. Filter preview
remains open. The linked Undo failure was isolated and its fixture corrected
after the full run, as recorded below; raw full-run counts were not rewritten.

## Small fixes made during this gate

- Native CLI schema parity: numeric bounds were stripped differently by the
  native clients. The portable wire contract now carries these bounds in field
  descriptions, matching the existing array/string portability strategy.
  Original declarations and host pagination validation still reject invalid
  calls, including `limit: 51`. The parity suite captures real native CLI
  requests against a fixture endpoint; it is not a live-model quality test.
- Tool-schema budgets: shortened shared descriptions and plugin discovery text.
  The existing limit remains 10,000 JavaScript string units (UTF-16), not bytes.
  The largest current group is audio at 9,903. No groups were removed.
- Project-audio crash: opening This project with audio media attempted to render
  an undefined `MediaCard`. `AudioTab` now supplies its existing component.
  The smoke fixture waits for the actual audio tab before choosing This project.
  The final source passed all 17 editor-space checks with normal activation,
  including attribution copying and no renderer errors.
- Test-runner integration: pass the installed platform Electron executable to
  legacy suites. Increase the outer suite deadline from 120 to 360 seconds to
  cover ordinary inner workflows with 300-second deadlines plus cleanup.
  Live opt-ins with longer deadlines need their own profile before certification.
- Correct stale fixtures: exact read-only analysis tool set; completion receipt's
  `ready` field; renamed command/action references; current permission text and
  committed details UI. Add expected/actual linked Undo diagnostics without
  changing its comparison during the full runs. The post-battery derived-cover
  normalization is explained below.

Focused schema checks passed 4/4 and native/UI fixture checks passed 5/5.
The media diagnostic batch passed 6/7, with filter rendering failing. Both
renderer compilations succeeded, with the existing large-chunk warning.
No installer was built.

## Failure disposition

Every failure from the initial full run is retained below. Prerequisite and
platform-fixture failures remain failed checks, not accepted platform coverage.

| Initial failure | Full runs: initial / second / final | Disposition |
| --- | --- | --- |
| `agents/test-agent-parity.mjs` | FAIL / PASS / PASS | Fixed numeric-bound wire portability; real native CLI requests now agree. Host pagination validation unchanged. |
| `agents/test-agent-tools.mjs` | FAIL / PASS / PASS | Fixed oversized shared tool descriptions; all existing groups remain below the unchanged 10000 UTF-16-unit limit. |
| `agents/test-analysis-delegation-ui.cjs` | FAIL / PASS / PASS | Corrected stale fixture to assert the exact five current read-only child tools, including transcript reads. |
| `agents/test-timeline-context-ui.cjs` | FAIL / PASS / PASS | Corrected fixture to read the current completion receipt's ready field. |
| `audio/test-captions-linux.cjs` | FAIL / FAIL / FAIL | Unresolved prerequisite: external /tmp/capfix/jfk.wav is absent; no caption acceptance claimed. |
| `audio/test-captions.cjs` | FAIL / FAIL / FAIL | Unresolved platform fixture: Windows APPDATA/PowerShell assumptions on macOS. |
| `editor/test-editor-space-ui.cjs` | FAIL / FAIL / PASS | Fixed actual missing MediaCard prop crash in project audio and explicit current audio destination selection. Final source passed 17 real-app checks with normal activation; quiet-profile focus result remains separate. |
| `editor/test-fonts.cjs` | FAIL / FAIL / FAIL | Unresolved platform fixture: two Windows fonts required on macOS. |
| `effects/test-filters-ui.cjs` | FAIL / PASS / PASS | Unresolved intermittent visual acceptance: initial half-strength layer failed, focused tiles failed, second full passed, normal-activation clip preview failed. No rendering fix or threshold change made. |
| `export/test-textanim-export.cjs` | FAIL / PASS / PASS | Fixed test harness platform Electron discovery via ELECTRON_BIN; real export passed. |
| `export/test-textanim-word-export.cjs` | FAIL / PASS / PASS | Fixed test harness platform Electron discovery via ELECTRON_BIN; real export passed. |
| `export/test-textsmooth-export.cjs` | FAIL / PASS / PASS | Fixed test harness platform Electron discovery via ELECTRON_BIN; real export passed. |
| `export/test-tplmotion-export.cjs` | FAIL / PASS / PASS | Fixed test harness platform Electron discovery via ELECTRON_BIN; real export passed. |
| `library/test-assets.cjs` | FAIL / FAIL / FAIL | Unresolved prerequisite: sibling asset-pack/library-manifest.json absent. No content-pack acceptance claimed. |
| `library/test-library.cjs` | FAIL / FAIL / FAIL | Unresolved live-service result: 20 sound effects, zero music. Cause not isolated or waived as environment-only. |
| `library/test-openverse-ui.cjs` | FAIL / FAIL / FAIL | Quiet-profile document focus timeout; exact suite passed sequentially with normal activation and local fixtures. No clipboard assertion removed. |
| `media/test-tracking.cjs` | FAIL / PASS / PASS | Fixed test harness platform Electron discovery; tracking engine and actual app checks passed. |
| `plugins/test-plugin-agent-ui.cjs` | FAIL / PASS / PASS | Corrected invalid fixture command/action reference after renaming its command; package validator unchanged. |
| `plugins/test-plugin-link-management-ui.cjs` | FAIL / PASS / FAIL | Final full failure isolated to derived export posterImage/posterImageAt; no clip/link/marker diff. Fixture normalized only these derived fields after the full run; actual linked Undo and existing derived-project-data suites passed 2/2 separately. Raw full-run FAIL preserved; no fourth full run. |
| `plugins/test-plugin-ui.cjs` | FAIL / PASS / PASS | Updated fixture to current Command permissions text and waits for the actual React details commit. |
| `text/test-srt.mjs` | FAIL / FAIL / FAIL | Unresolved prerequisite: private external /home/hatch/workspace/user/files/captions.srt absent. Parser acceptance not claimed by this suite. |

The filter suite produced different visual failures across runs: half-strength
whole-video chroma remained zero, some preview tiles were black, and a normally
activated clip preview retained its original chroma after Black & White was
selected. It also passed a complete full run. No renderer fix was made here;
these observations do not prove whether the renderer, compositor capture or
fixture synchronization is responsible. Do not relax the image thresholds.

Linked Undo failed again in the final full run. The new expected/actual diagnostic
proved that its only differences were export-generated `posterImage` and
`posterImageAt`; no clip, link or marker data differed. `projectVisuals` deliberately
patches these cover fields across history without adding an edit. The fixture now
excludes exactly those derived fields, alongside its existing waveform exclusion,
and retains user-editable `posterAt` and all other comparison fields. The actual
linked Undo suite and the existing derived-project-data history suite passed in a
separate focused rerun. This test-only correction followed the final full battery;
no fourth full run or new application-code change is claimed.

Openverse passed the unchanged suite with sequential normal activation and local
fixtures after failing `document.hasFocus()` in quiet mode. This demonstrates a
usable native test profile, not universal desktop/platform certification.

## Artifact provenance and release automation

- Final renderer file-tree SHA-256: `edf7a2760b4dee5c5e7b87581fee87fdd424ab0f6da319670b3c6f60bac4e070`.
- SDK dist file-tree SHA-256: `471d4bab50e2d5764f1ef666dfb4fc7c8d7037a4d4309722b46edd7fb7e89ae4`.
- Local `clipcraft-plugin-sdk-0.8.0.tgz` (153,444 bytes) SHA-256: `55f2d14a72efa87ec4a860b378bf37586b9b7e3ea968ddad17ad9b01f2d81c89`.
- Tree hashes use SHA-256 over the sorted, compact JSON file manifest (path, size, content SHA-256); the manifest is retained in the evidence.

The SDK tarball was packed locally with lifecycle scripts disabled. It was not
published. Renderer and SDK dist fingerprints describe loose file trees, not an
installed application, ASAR or installer. The SDK source did not change during
the later project-audio correction.

Read-only GitHub API inspection retrieved the remote metadata on this date:

- No tracked `.github` workflow is present locally. The origin repository
  `elmissouri16/clipcraft` uses default branch `main`; its workflow-directory
  request returned HTTP 404. Its fetched four branches contain no `release/*`.
- The upstream URL redirects to `hamzaabika/cutflow`. Its retrieved
  [release workflow](https://github.com/hamzaabika/cutflow/blob/main/.github/workflows/release.yml)
  has blob SHA `9ee054d98b9ba8a5a81a07363d9a0b41efa696a6` and targets Linux
  deb x64, Windows NSIS x64 and macOS universal DMG. That is a reference matrix,
  not a declared or verified support matrix for this candidate.
- That reference workflow builds and publishes Cutflow without a full-battery
  or installed-app acceptance job. Its separate Snap workflow was also retrieved.
  Neither was copied, modified or dispatched. The retained API metadata records
  the retrieval; it does not prove that no other upstream CI exists.

REL-01 remains open: this fork still needs reconciled release automation that
blocks publication on required checks and records manual hardware gates.

## Next stabilization work

1. Isolate the filter-preview failures. Keep the image thresholds and capture
   the actual state/frame boundary. Keep the corrected Undo fixture in the next
   required full-battery candidate.
2. Make required caption/font/content fixtures reproducible and declare separate
   platform, live-service and sequential native-focus profiles. Investigate the
   zero-result live music query; do not waive it as environmental without proof.
3. Reconcile this fork's release workflow and intended OS/architecture support.
   Installed clean-profile lifecycle, save/restart/reopen and export acceptance,
   including GIF shared resources under ASAR/dependency pruning, remain required.
4. Complete PERF-01, UX-01 and SDK-01 from the
   [readiness audit](plugin-production-readiness.md). Ripple and additional
   contribution types remain deferred.

No version bump, installer, commit, push, SDK publication or release was made.
