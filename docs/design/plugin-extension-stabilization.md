# Extension host stabilization

This checkpoint hardens the existing general Node SDK before v1. It adds no
specialized speech/AI extension types and changes no application, SDK, host API
or example version. Release remains on hold.

## Discovery and package admission

Concurrent catalog requests now share only their in-flight discovery scan.
Callers receive independent metadata; no persistent integrity cache is introduced.
Inventory mutations invalidate pending discovery. Command/creative bundle reads
verify the requested immutable package directly, without scanning every installed
package twice. Tampering still rejects on the next read.

The manifest format probe now uses a bounded regular-file descriptor read before
JSON decoding. It rejects links, non-files, invalid UTF-8, size growth and overflow;
subsequent package checks reuse those exact manifest bytes. Tiny manifests retain
only their own bytes, rather than the full admission scratch buffer. Golden
historical creative fingerprints remain unchanged. This is a specific admission
fix, not certification of arbitrary filesystem races or the complete abuse matrix.

The initial before/after comparison used the same temporary driver, 30 synthetic
Node packages with original approximately one-MiB text assets, warm local reads
and five samples per operation. Authored code never executes. Times are medians;
bytes are one sample's reads, identical across the five samples in each operation.

| Operation | Before | After discovery change | Read bytes before / after |
| --- | --- | --- | --- |
| list | 26.22 ms | 26.02 ms | 31,471,670 / 31,471,670 |
| parallel-catalogs | 132.82 ms | 26.70 ms | 283,245,030 / 31,471,670 |
| command-bundle | 28.78 ms | 1.16 ms | 33,569,776 / 1,049,053 |

Raw baseline: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-discovery-baseline-P14FTk/result.json`. Same-driver followup: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-discovery-baseline-nmdfRR/result.json`.
These compare discovery changes before the later bounded manifest reader. The
reusable `node scripts/measure-plugin-discovery.cjs [count]` additionally counts
file-descriptor reads; its call counts must not be directly compared with the
initial driver's `readFile`-only instrumentation. Synthetic warm Node discovery
is not cold app launch, full preview rendering or an accepted hardware budget.

The final reusable-driver run after manifest admission/copy changes recorded:

| Operation | Median | Read bytes per sample |
| --- | --- | --- |
| list | 25.70 ms | 31,468,752 |
| parallel-catalogs | 25.81 ms | 31,468,752 |
| command-bundle | 1.16 ms | 1,052,091 |

Raw final evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-discovery-measurement-sHkbGK/result.json`. The measurements remain local observations without
release budget thresholds.

## Native lifecycle and retained data

The first native soak failed immediately because stopping a generation left an
empty hook ownership map. Hook disposal/cleanup now removes empty maps. The
regression uses unique generation-specific hooks, services and native settings,
executes an actual command/job/service, stops, and checks automatic startup does
not restart that stopped extension.

A subsequent actual Electron run completed 200 cycles with
200 forks and 200 unique generations. After every stop,
all tracked activation, command, service, hook, event, stream, job, pending-call,
cancellation and UI counts were zero. Exited utility-process stdout/stderr were
null and no extension children remained in native process metrics. Active
resource samples stayed at one pending CloseReq. Median activation was
45.81 ms and stop was
3.73 ms on the recorded macOS arm64 environment.

Main-process RSS rose from 123,650,048 to 150,650,880 bytes;
heap use ranged from 6,110,744 to
10,770,288 bytes and external memory ranged from
2,968,953 to 51,595,522 bytes.
These samples prove tracked resource cleanup, not a flat memory budget. The RSS
trend remains a long-session acceptance concern; this bounded run does not close
PERF-01. Raw evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-long-soak-WLNKz0/result.json`.

The native storage lifecycle suite exercises actual encrypted secrets and
ID-scoped configuration through changed-package trust, author migration,
unsupported-schema rollback refusal, uninstall/reinstall and disabled inventory
recovery. [SDK compatibility](plugin-sdk-compatibility.md) documents those rules,
exact-byte trust, deliberate deletion, temporary development storage and the
stable release/distribution contract. Native storage and clean-consumer checks
are targeted acceptance, not installed Windows/Linux certification.

## Reproducible local checks

The SRT suite now uses an original checked-in text fixture with multiple lines
and Unicode. The font suite imports two independently identified real fonts
available on the current OS instead of requiring Windows paths on every OS.
Neither test silently skips its essential assertions.

The POSIX caption suite creates its fixture directory and bounds/verifies the
public whisper.cpp JFK audio by SHA-256 before inference. The actual local Base
model produced the expected English control on macOS. Optional Darija audio was
absent and remains explicitly unverified. This is not Linux platform acceptance.
No audio/model/font binaries were added to the checkout.

## Verification and remaining release work

The final broad plugin/portable-fixture selection recorded 103 PASS and
1 FAIL with no timeouts. Its sole failure compared summed effect pixels
across responsive canvas sizes. The complete usability workflow then passed
separately (64 initial checks and 5 restart checks) after a test-only
correction to mean brightness, retaining the original 1.3 brightness threshold.
The native evidence records 1184×666 becoming 640×360, while brightness
per pixel rose from 241.32 to 432.92. Raw sums, dimensions and RGB samples remain
in `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-plugin-usability-ui-3NKhHA/result.json`. No product source changed after the broad selection. Both its failed
result (`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-ibCYJz/results.json`) and the successful complete followup (`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-ewt1le/results.json`) remain recorded;
this is not a rewritten all-green broad run. The previous broad run's retired
permission-wording assertion was corrected and passed in this final selection.

Exact snapshots, result paths, earlier failures and final checks are retained in
`plugin-validation.json.extensionHostStabilization`. The preceding full battery
and its raw failures remain unchanged under `extensionHostLegacyRetirement`.

Still open: the Windows caption fixture/platform run, the sibling content-pack
manifest, the live library's zero-music result, full archive/abuse acceptance,
representative performance/memory and manual UX acceptance, supported
Windows/Linux and installed-release checks, and release automation/distribution.
The real external-content failures are not waived as environmental. No installer,
commit, push or publication was made.

The later [package/library followup](plugin-extension-package-hardening.md)
extends bounded reads to other payloads, rejects ambiguous Node paths and resolves
the live zero-music assumption plus the newly reached sound-pagination defect.
The raw runs and remaining gates above describe this earlier checkpoint.
