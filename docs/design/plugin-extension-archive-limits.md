# Archive boundaries, metadata and nested compression

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This continues the
[archive publication followup](plugin-extension-package-publication.md) with
reader/installer acceptance. It is not a complete release or abuse certification.

## Reproduced gaps

A valid in-memory package with 4,096 files and exactly 134,217,728 payload bytes
validated successfully, but its 138,351,104-byte expanded tar stream exceeded the
reader's former 129 MiB ceiling. Its gzip archive was only 333,816 bytes. The
extra bytes were ordinary headers and padding, not excessive payload. This made
the documented payload/file limits incompatible with archive intake.

Separate original probes demonstrated acceptance of an additional gzip layer,
an unknown tar entry type and a metadata entry one byte beyond the configured
per-entry cap. The latter two disappeared from the returned file map. The tar
parser can transparently decompress and skip some entries; strict warnings alone
did not enforce ClipCraft's package policy. Its pinned
[source and documentation](https://github.com/isaacs/node-tar/tree/v7.5.22)
were checked directly after Context7 returned unrelated library matches.

## Current boundary

The reader retains the 64 MiB compressed input cap and 128 MiB actual payload
cap. It separately allows 2,048 format bytes per supported file plus 1,024 end
bytes: 8 MiB plus 1 KiB at 4,096 files. This covers a regular header, payload
padding and a PAX path header for the supported 240-character ASCII paths.
Total inflation cannot exceed payload plus format allowance; after parsing,
aggregate non-payload bytes must also fit that allowance. Metadata cannot borrow
unused payload capacity.

Payload totals are checked before retaining each file's chunks. A second gzip
layer is refused before tar parsing, and automatic Brotli/Zstd parsing is
disabled. Ignored entries, including unknown types and oversized metadata, make
the package invalid. The parser still accepts valid PAX long paths and rejects
PAX traversal overrides through the existing canonical path rules. No archive
entry is extracted directly to a filesystem path.

Generated boundary fixtures contain 4,096 files, 240-character paths and exactly
128 MiB of original zero-filled payload. The entry throws if activated, so the
Settings test proves admission without execution. No binary fixture is added to
the repository. Native and SDK fingerprints must match after round-trip.

## Verification

All 7 selected admission/SDK/publication suites passed on the frozen
1,026-file executable source snapshot. The archive boundary suite passed
8 checks, including the optional Zstd probe on this runtime.
The existing resource suite passed 15 checks and rejects a
144,703,488-byte inflated stream
against the 142,607,360-byte ceiling.
The clean distributed SDK consumer passed 18 checks.

The real Electron Settings workflow passed 16 checks, including
visible rejection of all three malformed archive cases, installing/removing the
maximum package without a trust prompt or activation, and the ordinary trusted
Node edit/Undo/stop flow. Its explicit temporary user-data directory was verified.
No renderer errors were recorded. The maximum-path SDK archive expanded to
142,543,360 bytes and retained the native fingerprint.
Structure and whitespace checks passed.

Exact sources, retained baseline failures and results:
`plugin-validation.json.extensionHostArchiveLimits` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-9fdprbgu/verification.json`.

## Acceptance limits

All checks use isolated temporary packages/profiles on this macOS development
machine. Native dialogs are scripted. Version files, lockfiles and all thirteen
Node example manifests retain their prior bytes. Valid package fingerprints are
unchanged; previously ignored malformed archive content now rejects.

Complete archive/abuse review, installed Windows/Linux acceptance, missing
full-battery prerequisites, representative hardware/performance budgets,
remaining manual UX and the earlier intermittent native export timeout remain
open. No installer, publication, version bump, commit or push is produced.
