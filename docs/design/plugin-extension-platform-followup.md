# Extension intake and platform followup

> Later full-battery, retained-heap and lower-third example evidence is recorded
> in the [reliability followup](plugin-extension-reliability-followup.md).

This continues the general Node extension implementation before SDK v1. App
2.0.0, SDK 0.8.0, host API 1, lockfiles and all 13 Node example manifests retain
their previous values. No installer, publication, commit or push was produced.

## Implementation

New creative-pack intake now uses the same portable asset-path checks as Node
packages. Native install, development loading and SDK validation/build/pack reject
case aliases, ambiguous directory prefixes, reserved device names and trailing-dot
components before materialization. SDK source declarations are checked before
opening declared assets. Historical installed creative data and read-only archive
inspection retain the original fingerprint algorithm and remain readable; a new
install or development session must satisfy the current intake rules.

All package payload reads and compressed-source reads use bounded regular-file
descriptors. Regression fixtures cover metadata/read growth, exact retained
buffers, per-file/count/total limits, malformed archive paths, unchanged inventory
after refusal and a golden historical fingerprint. Declaration-free Node sources
also build without requiring an authored `contributes` object.

Real Linux encoding exposed a frame-rate defect: output could default to 25 fps
after filter framesync even when a different rate was requested. The final video
encoder arguments now explicitly set the requested output rate. A real FFmpeg /
ffprobe regression checks every decoded timestamp, frame count, duration and rate
at 12, 24, 25, 30, 50 and 60 fps, including the raw RGBA text-overlay stream.

Native timeline Undo/Redo now prevents Chromium's default text-edit action after
handling the application shortcut. Focused text fields retain native text Undo.
The native event workflow checks the project name as well as timeline content and
public Undo/Redo provenance.

Both caption examples now ignore delayed older revisions while watching captured
source text. Newer edits and document replacement still cancel work. Their built
source regression delivers an older event while subscriptions become ready and
checks subsequent cancellation and idempotent disposal.

The live-library followup retains CC0-only default music/SFX policy, accepts an
empty music result, and requests attribution explicitly for its positive music
control. MyInstants pagination recognizes the current infinite-scroll sentinel
as well as classic next links, stops on empty/404 pages, and retains its page cap.
See [package/library evidence](plugin-extension-package-hardening.md).

## Native verification profiles

UI fixtures wait for actual window content dimensions and rendered preview
backing dimensions. Pixel comparisons use per-pixel means across responsive
resizes while retaining raw sums and dimensions. Review actions return to the
driver before clicking a control that disposes its own renderer; completion,
saved captions, Undo, export and subscription cleanup remain asserted.

The Linux desktop profile is an isolated Docker Linux arm64 development tree,
running as an ordinary user with Xvfb/openbox, a GNOME libsecret keyring, and ANGLE
software rendering. Its platform probe requires encrypted-secret round trips,
WebGL2, renderer Node isolation and Chromium seccomp. Outer container namespace
setup uses CAP_SYS_ADMIN and unconfined outer seccomp/AppArmor; this is not an
installed-release or bare-hardware certification. It has no host source mount,
Docker socket, privileged mode or published ports.

Hidden Linux preview playback produced only one frame. The explicit
`FVE_PREVIEW_UI_VISIBLE=1` test profile maps the isolated native window and retains
the same playback, progress, resource and pixel assertions. The default macOS
profile continues to require hidden windows. This distinction is recorded in the
evidence rather than weakening the playback budget.

## Results and limits

The frozen macOS full battery recorded 330 raw PASS / 3 FAIL across 333 suites.
Two raw PASS entries are opt-in whole-suite skips. Failures were the Windows-only
caption prerequisite, the missing original sibling content manifest, and one
native export timeout. Focused export reruns passed; the intermittent timeout
remains an open reliability concern. It is not reclassified as an environment
failure. Later focused native runs cover the caption watcher and test-only
completion/profile changes after that full snapshot.

The single Linux selection recorded 105 PASS / 3 FAIL across 108 suites. Its
caption, Settings and preview failures have separately retained followups; raw
results are never rewritten. The caption workflow and cold restart passed, and
Settings passed in English, French and Spanish. Final preview/profile results,
source hashes, versions, exact run paths and cleanup records are linked from
`plugin-validation.json.extensionHostPlatformFollowup`.

Earlier failed/aborted validation attempts remain recorded, including a duplicate
container launch and test-only diagnostic syntax/pointer errors. They are not
acceptance runs. Task-owned containers are named `clipcraft-linux-sdk-0quqs86z`,
`clipcraft-linux-sdk-nonroot-0quqs86z`,
`clipcraft-linux-sdk-sandboxed-0quqs86z` and
`clipcraft-linux-sdk-diagnostic-0quqs86z`; the evidence records their IDs and
targeted cleanup. No daemon settings or unrelated containers/images are changed.

SDK v1 remains on hold for Windows and installed-platform acceptance, the absent
original `asset-pack/library-manifest.json`, intermittent export reliability,
long-session memory/hardware budgets, manual UX, complete abuse acceptance and
distribution/release automation. The general extension plan remains active.

Final focused evidence: the Linux visible preview passed 64 main-workflow checks
and 5 restart checks, with 22 frames in its measured playback interval. All 108
selected suite files have passing evidence across the full selection and focused
followups; a single clean 108/0 full run is not claimed. The final default macOS
hidden preview also passed. The final executable snapshot contains 1,013 files;
the final Linux input manifests contain 1,030 inputs and report no changes while
tested. The task-owned containers and two dependency image tags were removed.
