# Native reliability and example followup

> Later directory/read bounds and Node runtime-floor evidence are recorded in
> the [resource-admission followup](plugin-extension-resource-admission.md).

This follows the [platform checkpoint](plugin-extension-platform-followup.md).
The app remains 2.0.0, SDK 0.8.0 and host API 1. App/SDK manifests and lockfiles,
all 13 Node example manifests and the creative example version are unchanged.
No installer, SDK publication, Git commit or push was produced.

## Export timeout investigation

A subsequent [FIFO handoff investigation](plugin-extension-fifo-handoff.md)
reproduced and fixed a synchronous-open deadlock in the production writer used
by this candidate. It includes real encoder-exit injection and recovery in the
app. The historical timeout below still lacks enough trace evidence to attribute
its particular cause; later passing samples do not rewrite that result.

The earlier full run's export timeout remains a real unresolved observation.
Its original MP4 was intact; a later short-range overwrite did not complete and
left a temporary text encoder when the test killed its parent. The available
artifacts do not prove the mechanism. Fresh macOS FIFO cancellation probes at
four startup delays completed, so that hypothesis did not reproduce the stall.

The native export workflow now preserves checkpoints, the latest request and
progress, and temporary text-encoder PID, exit/signal state, frame count, queued
bytes, waiting producers and errors. These are test-only diagnostics. On timeout,
the runner reports that deadline and evidence path instead of a misleading
missing-result-file error. Its isolated POSIX process group, or Windows process
tree, is stopped; it waits for child stdio closure. The default deadline remains
210 seconds. The final native check also requires every temporary text encoder
to have exited before declaring success.

The instrumented concurrent native selection passed four suites. Eight further
consecutive complete native export workflows passed, including actual video,
range/overwrite checks, cancellation, Stop, reactivation and cleanup. A later
full battery also passed the export suite. No production encoder change was
made on the basis of an unproven cause, and these passing samples do not close
the earlier intermittent-reliability concern.

## Corrected lower-third example

The supplied example authored `x: 0.12`, but the text renderer treats `x` as the
centre of the laid-out box. Native font/layout measurements reproduced clipping:
the sample box extended left of both the 1280-wide preview design frame and
960-wide showcase frame. The example now uses `x: 0.35`; its complete box fits
inside both tested frames. The renderer's saved-project coordinate contract is
unchanged. This does not promise arbitrary user text will fit every resolution.

The showcase now previews the actual lower-third entry and asserts its measured
font/background bounds in both frame sizes. The failing baseline is retained.
The corrected four-suite selection passed, including actual example archive
installation, preview, Node command/Undo, watched authoring and video export.
Its native workflow passed 28 checks, and the captured lower-third preview was
visually inspected: the full text and background are visible inside the frame.
An extracted frame from the real encoded video was also inspected and retains
the complete lower-third text and background.

## Retained-heap diagnostic

A separate copied native fixture ran 1,000 activation/command/stop cycles with
1,000 unique generations. Every tracked active/command/service/hook/event/stream/
job/pending/canceled/UI collection was empty after each stop, and no extension
child survived in Electron's process metrics. Active-resource observations at
the endpoints were unchanged.

The diagnostic forced garbage collection every 50 cycles. Between its first and
last collected samples, JS heap used rose from 6,035,892 to 6,804,840 bytes; RSS
rose from 134,152,192 to 139,935,744 bytes. Native contexts and global-handle size
were stable and detached contexts remained zero. The harness retains its own
sample history and generation evidence, so the heap delta cannot be attributed
directly to extension state. Forced-GC cycling is not normal long-session use or
an approved performance/memory budget. That release gate remains open.

## Candidate verification and remaining gates

The frozen full macOS battery recorded 332 raw PASS / 2 FAIL across 334 suites.
Two raw PASS entries are opt-in whole-suite skips: classified results are
330 PASS / 2 FAIL / 2 SKIP. The failures remain the Windows-only caption
prerequisite and absent original sibling asset manifest. Optional Darija fixture
coverage is still absent. The subsequent source delta is limited to the example
position and two native smoke fixtures; the four-suite lower-third selection and
final one-suite export cleanup check cover those changes.

Exact source hashes, raw/focused results, prior failures, repeated-run evidence,
native captures, probe observations and version checks are retained under
`plugin-validation.json.extensionHostExportReliabilityFollowup`.

Windows/installed-platform access, the original asset-manifest path,
representative hardware, long-session memory, manual UX, complete abuse
acceptance and distribution/release automation remain open. The prior export
timeout remains unexplained. SDK v1 and the accepted goal are not complete.
