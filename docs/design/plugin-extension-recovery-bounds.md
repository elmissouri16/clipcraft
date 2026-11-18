# Bounded inventory recovery enumeration

This is local work from the resumed pass. The
[blocked acceptance gates remain unfinished](plugin-extension-unfinished.md),
as requested. App 2.0.0, SDK 0.8.0 and host API 1 are unchanged.

## Reproduced gap and correction

Recovery limited a plugin root to 4,096 entries, but checked that count only after
`readdir` had allocated the complete directory array. Invalid-package diagnostics
also enumerated every child name before retaining the first 64. The new
regression supplied 4,200 root entries and observed all 4,200 collected before
refusal, rather than stopping at the first excess entry. Its failing result and
assertion are retained.

Root enumeration now uses a directory iterator and stops at entry 4,097, without
retaining that excess entry. Exactly 4,096 entries remain accepted. Invalid-package
diagnostics collect at most 64 observed names, sort that bounded sample for
comparison, and stop on the next entry. Iterator cleanup runs on refusal, normal
completion and early exit. Access failures keep their existing recovery error.

The diagnostic signature remains a bounded sample plus directory/file identity,
not a recursive atomic byte snapshot. Explicit recovery still preserves the whole
invalid directory by moving it into the recovery archive. Inventory formats,
opaque trust fingerprints, disabled reconstruction and stale-review checks retain
their behavior. No unknown user files are automatically deleted to satisfy the
root limit.

## Verification

All 15 selected suites passed: five focused inventory/removal/discovery suites,
nine SDK/admission/consumer suites, and the native Settings recovery/restart suite.
Structure and whitespace checks passed on unchanged executable source.

The four new standalone cases verify overflow refusal after 4,097 yielded entries,
the exact 4,096 boundary, bounded diagnostics and unchanged-review validation,
whole-directory preservation, and access-error refusal without writes. The
100,000-entry virtual invalid directory required five scans of only 65 yielded
entries each. Every opened iterator closed; eager enumeration calls were zero.
The virtual entries avoid materializing an oversized test tree.

Real Settings passed 18 initial checks and 12 cold-restart checks. A real root
containing 4,097 added files visibly reports the entry-limit error without
changing inventory or creating an archive. After the harness removes its own
excess fixture files, normal reviewed recovery succeeds. The invalid package has
128 added children beyond its existing manifest; all added bytes survive archival,
including children beyond the diagnostic sample. Existing pending-removal,
backup, permission, mutation, retry, retained-effect and Undo checks still pass.
Windows shown: zero; renderer runtime exceptions: zero. Native clicks and faults
are scripted in isolated temporary profiles.

The distributed SDK clean consumer still passes 18 checks. Its 99,423-byte
candidate retains SHA-256
`73e09aacd0a698d35d5a823c53bbb5f82d8a53108e1dd6e3763d56f69540af2e`;
the SDK payload did not change with this host inventory correction.

Evidence: `plugin-validation.json.extensionRecoveryEnumeration` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-gwp94iqd/verification.json`.

## Scope still open

This closes these two eager-enumeration paths on the current macOS development
candidate. It does not certify every abuse/distribution path or the installed
platform matrix. No full battery, SFXMint request, installer, publication, version
bump, commit or push was produced. The new suite adds one discovered file beyond
the preceding inventory. Native-media archive-layout work continues separately;
the explicitly skipped gates stay in the unfinished report.
