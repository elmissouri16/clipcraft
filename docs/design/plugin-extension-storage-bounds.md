# Preview and preference read bounds

This completes the concrete local storage findings from the resumed followup.
The [skipped acceptance gates remain unfinished](plugin-extension-unfinished.md).
App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged; production readiness is
still unproven.

## Reproduced failures and corrections

Preview review and storage accounting checked directory counts only after
`readdir` had collected every name. The regression supplied 5,010 preview names
and 10,020 accounting names and observed every name collected before refusal.
Both paths now iterate and stop on the first excess entry. The existing limits
remain 5,000 preview entries and 10,000 entries per accounting directory; the
accounting depth policy is unchanged. Every iterator closes on success or
refusal. This is not a new global workload or performance budget.

Retained panel data and pack favorites checked descriptor size before calling an
unbounded `readFile`. An actual file append between stat and capture made them
accept 65,599 and 524,315 bytes respectively, past their existing 64 KiB and
512 KiB file quotas. Valid trailing JSON whitespace demonstrated that subsequent
semantic validation did not enforce the raw file bound.

Both readers now use the same bounded regular-file descriptor capture as package
intake. Growing inputs stop at their quota plus one detection byte and reject;
descriptors close on failure. File identity and link checks apply before capture.
JSON decodes as strict UTF-8 instead of silently replacing malformed bytes.
Valid Unicode, including a literal replacement character, exact-limit files,
missing-file defaults and existing stored formats remain supported. Read failure
does not reset or migrate saved data. Explicit clear and reviewed migration retain
their existing ownership and publication checks.

## Verification

The new suite passes nine cases covering early directory refusal, exact count
boundaries, descriptor growth, exact file quotas, valid Unicode and malformed
UTF-8 preservation. Observed stopping points are 5,001/10,001 yielded directory
entries and 65,537/524,289 captured bytes. No eager read remains in those cases,
and every opened iterator/descriptor closes. The initial seven failing cases and
two passing exact-file controls are retained as raw evidence.

The complete final local plugin selection passed **112 suites**, with **zero
failures, timeouts or skip markers**, on frozen executable source. This includes
the resource regression, package/admission, recovery, retained data, SDK authoring,
Node runtime, native views, previews, jobs, example migrations and editor workflows.
It is the plugin selection, not a new whole-application or installed-platform run.

The targeted native usability run passed 65 initial checks and five restart
checks. A real cache with 5,001 added files shows its existing limit error without
deleting those files or changing inventory. After the harness removes its own
excess files, active-preview protection, reviewed cleanup, favorites restart,
durable project sound and real export still pass. The retained-data/retirement
native workflow also passed 17 checks. The usability runs show no windows; both
native workflows record no renderer exceptions. Clicks/consent are scripted.

The first usability attempt reached the correct error but its new test selector
looked for a CSS class absent from the existing component. It failed after 46
checks. The selector now uses the existing alert role. No product source changed
between that failure and the final passing native run. The failed result and DOM
are retained. The subsequent complete 112-suite selection uses the corrected
frozen source, rather than rewriting the initial result.

The separate SDK verification passed all nine suites and its offline clean
consumer. The candidate still has the prior 99,423 bytes and SHA-256
`73e09aacd0a698d35d5a823c53bbb5f82d8a53108e1dd6e3763d56f69540af2e`.
Structure and whitespace checks passed. No manifests, lockfiles or SDK payloads
changed as part of these storage corrections.

Evidence: `plugin-validation.json.extensionStorageResourceBounds` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-qqj2uau2/verification.json`.

## Scoped completion

The resumed local work now has retained corrections and passing evidence for
[recovery enumeration](plugin-extension-recovery-bounds.md),
[native-media archive paths](plugin-extension-native-media-paths.md), and the
preview/preference paths above. Managed package admission already retains its
file, directory, inflation, archive and publication checks; the final plugin
selection revalidates their integration. Author-controlled CLI source/build
workspace breadth and developer example discovery are not managed data-quota
checks and are unchanged.

The remaining platform/artifact, CI/publication, live-service, hardware/performance,
manual/assistive-technology and complete distribution gates are explicitly left
unfinished in the central report. None becomes a pass because this scoped local
followup is complete. No full battery, SFXMint request, installer, version bump,
publication, commit or push was produced.
