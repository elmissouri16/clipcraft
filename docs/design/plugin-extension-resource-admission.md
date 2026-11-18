# Bounded package work and SDK capture

This follows the [native reliability checkpoint](plugin-extension-reliability-followup.md)
and continues pre-v1 package/abuse acceptance. App 2.0.0, SDK 0.8.0 and host API 1
remain unchanged. No installer, SDK publication, Git commit or push was produced.

## Gaps and implementation

Native Node folder admission previously counted files, but traversed empty
subdirectories without a work budget or directory-prefix check. An original
140-level empty-directory fixture was accepted even beyond the portable relative
path bound. SDK asset discovery had the same unbounded directory walk. Some SDK
source JSON and asset reads also trusted an earlier size stat before readFile.

Folder scans now iterate entries with a budget instead of collecting unbounded
readdir arrays. Directories count even when empty, and their portable components
and 240-character relative prefixes are checked before descending. Node packages
permit at most 4,096 files and 8,192 combined file/implied-directory path nodes;
archive validation applies that same materialization bound. The exact boundary is
accepted and one additional implied directory is refused. Existing valid payload
fingerprint algorithms are unchanged. Previously accepted Node layouts beyond
the new resource budget must be rebuilt before admission. Creative folder scans
also stop at their existing file envelope while enumerating entries.

The scan uses a bounded pending-directory list and opens one directory at a time.
The first recursive streaming candidate retained 118 live iterators on the deep
virtual fixture. Its failing regression is preserved. The final iterative scan
retains one; every visited test iterator closes on failure. Node automatically
closes a directory iterator after its async iteration exits; see the official
[filesystem API](https://github.com/nodejs/node/blob/v24.22.2/doc/api/fs.md).

SDK source JSON now uses strict UTF-8 and the same bounded regular-file descriptor
reader as native intake. Asset capture bounds each read and counts actual bytes,
including the generated entry and manifest in the package total. A Node asset
also declared as creative content is captured once; typed validation and output
use that captured buffer even if the author changes its source afterward. This
is a per-file captured-byte guarantee, not an atomic whole-workspace snapshot.
Failed capture/builds leave the preceding owned output and marker untouched.

## Verification

The final macOS affected selection passed **106 suites with no failures**:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-7xELf2/results.json`. This covers current SDK clean
consumers, strict Node authoring, templates, native package/trust UI, ASAR worker
launch, lifecycle/storage, creative previews, Undo, example export and retained
legacy data. It is a selected battery, not a new whole-app release run.

The resource suite passed 15 checks. It covers empty-directory fanout,
overlong prefixes, exact file/path-node boundaries, bounded creative enumeration,
strict source UTF-8, native and SDK refusal without inventory/output replacement,
truncated tar headers/bodies, checksum errors, decompression bounds, and growth
after descriptor stat. The descriptor tests stop at the applicable limit plus
one detection byte and close the descriptor. A small compressed fixture expands
past the configured 129 MiB tar envelope and rejects before installation.

The actual Settings workflow visibly refuses a valid-file-count archive whose
implied directories exceed the budget. It creates no installed row, activation
or trust prompt, then completes the normal valid install/trust/edit/Undo/stop
workflow. The historical golden fingerprint remains unchanged.

The same five standalone admission/authoring suites passed on Linux arm64
under Node 24.16.0 and the SDK's declared minimum Node 20.19.0, running as UID
1001. All 1,016 copied inputs remained unchanged. The minimum runtime archive
was verified against the official Node release checksums before extraction.
These are Node filesystem/SDK checks, not Electron desktop checks.

Linux Node-only admission/authoring results, runtime provenance, source hashes,
precise counters, version checks and targeted container cleanup are retained in
`plugin-validation.json.extensionHostResourceAdmission`. These checks are not a
Linux native desktop or installed-release certification. Prior native Linux
checks remain separately recorded in the platform report.

## Acceptance limits

The initial SDK selection exposed an expected-message mismatch after an earlier
size rejection; the existing BUILD_FAILED category/message family was retained.
The intermediate recursive-iterator failure and Linux setup attempts remain raw
evidence, rather than being relabeled passes. The first minimum-runtime run
passed four suites and failed a spy assertion: Node 20's ESM loader used the
public readFile function for unrelated modules. A diagnostic captured those
module URLs. The spy now counts only its target manifest, including file-URL
forms; its zero-manifest-read assertion remains unchanged. Both real runtimes
then passed all five suites. After the broad macOS run, this test-only spy change
passed its two-suite focused followup; product source was unchanged.

This closes specific work/read bounds, not the full archive/abuse matrix or a
security certification. Trusted Node execution remains full local trust. The
original asset manifest and Windows runner are still pending user input.
Installed-platform acceptance, the unexplained earlier export timeout,
representative hardware, long-session memory, manual UX and distribution/release
acceptance remain open. SDK v1 and the accepted goal remain incomplete.

The task-owned `clipcraft-linux-admission-9j30rmu_` container was removed after
copying its evidence. It had no host mounts, special capabilities, privileged
mode or published ports. No new image was created; the pre-existing base image
was retained. Setup failures were an input-directory permission, the shared
runner's unused Electron prerequisite, and missing xz; direct standalone suites
and the official gzip runtime archive resolved those without product changes.
