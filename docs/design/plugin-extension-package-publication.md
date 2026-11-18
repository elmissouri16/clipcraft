# Bounded SDK archive publication

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This closes a reproduced
package-authoring gap; complete release, archive/abuse and platform acceptance
remain separate gates.

## Reproduced failure and correction

The SDK packer previously emitted compressed output without the native reader's
64 MiB archive cap. A valid Node folder containing two individually valid 32 MiB
incompressible assets produced a 67,129,959-byte archive. `packPlugin` reported
success, then `validatePlugin` rejected its result as larger than 64 MiB.

The SDK now uses the same writer as the in-app pack creator. That writer stages
the exact validated buffers, counts actual compressed bytes and publishes one
complete archive with an exclusive hard link from staging in the destination's
directory. It never exposes a partial destination or overwrites another writer's
file. SDK output suffix compatibility is preserved; the native writer retains
its `.tgz` default policy. The fingerprint algorithm is unchanged.

The first overflow regression then exposed a second real error: the native
writer's mixed stream/manual descriptor cleanup masked the size rejection as
`EBADF`. The output stream now owns its descriptor and closes it through the
pipeline on success, error or cancellation. The overflow check receives the
actual size error, with staging removed and the requested output absent. Node's
[file stream documentation](https://github.com/nodejs/node/blob/v24.22.2/doc/api/fs.md)
describes automatic descriptor ownership.

The repository's older `scripts/plugin-package.cjs` now delegates validation and
packing to the SDK. It no longer rereads mutable source through its own tar path
or bypasses the SDK's retired-executable authoring refusal. Inspection of
historical packages remains available through the SDK's read-only `inspect`.

## Verification scope

The new regression checks source mutation after capture, exact fingerprint
parity, complete private output before publication, a competing destination at
the publication boundary, existing-output preservation, cancellation, suffix
compatibility, repository helper parity, retired authoring refusal and an actual
64 MiB compressed overflow. The overflow uses full-size original random fixture
bytes, not a lowered test cap. These cases pass without running authored code.

The focused selection also covers clean distributed SDK consumers and all
scaffolds, Node and view authoring, resource admission, creative pack creation and
legacy retirement. The baseline oversized archive and first `EBADF` failure are
retained rather than relabeled as passing checks.

All seven focused suites passed against the unchanged 1,024-file executable
source snapshot. The clean tarball consumer passed 18 checks. A separate real
Electron workflow passed 65 first-process checks and 11 cold-restart checks,
including native creator export/installation, retained fonts, effects,
transitions, sounds, LUTs and motion, and actual MP4/GIF output. Both native
processes recorded zero renderer exceptions and zero shown windows. These are
scripted macOS development checks; native dialogs use fixture answers.
Structure and whitespace checks passed.

Exact source hashes, raw failures and results are recorded in
`plugin-validation.json.extensionHostPackagePublication` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-n0qo9r_0/verification.json`.

No SDK publication, installer, version bump, commit or push is produced.
The missing sibling content manifest, Windows prerequisite, installed-platform
matrix, remaining manual UX, representative hardware/performance budgets and
earlier unexplained intermittent native export timeout remain open.
