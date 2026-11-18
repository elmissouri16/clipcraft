# Native encoder FIFO handoff and recovery

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This continues the
[native reliability investigation](plugin-extension-reliability-followup.md).
It fixes a reproduced production deadlock shared by text/effect encoders; it
does not certify all historical export failures or the release/platform matrix.

## Reproduced main-thread deadlock

The macOS frame writer first opened its FIFO with `O_WRONLY | O_NONBLOCK` to
check for a reader, then synchronously reopened it in blocking mode for efficient
frame writes. If the encoder closed its reader between those calls, the second
open blocked the Electron main thread. Process-exit callbacks and cancellation
could no longer run to release it.

A controlled subprocess used a real native FIFO and closed the reader exactly
after the successful probe. It reached the saved checkpoint and then required
its independent 1.5-second watchdog to kill it. The FIFO source hash matches the
source used by the earlier timed-out full-battery candidate. This establishes a
real failure mechanism in that candidate, not proof that it caused that specific
historical timeout. The old artifacts do not include a conclusive thread trace.

## Correction

After a successful probe, the writer temporarily opens its own nonblocking read
descriptor across the blocking writer open. The reader cannot disappear during
that handoff. Both temporary descriptors close before any frame is written. The
guard never consumes frame data and cannot mask an absent encoder after opening.
Reader disappearance then yields the existing pipe/encoder error normally.

The frame write loop, queue depth, raw pixel format and encoder commands are
unchanged. Startup adds the temporary descriptor operations; no speed or CPU
improvement is claimed. The standard stdin path is unchanged. Apple's
[open documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html)
documents the nonblocking flags and absent-reader error used by the handoff.

## Verification boundary

The regression runs native FIFO cases in separate deadline-controlled processes:
reader loss at the handoff, guard-open failure, blocking-writer-open failure,
close while waiting for a reader, and an encoder already exited. It requires a
responsive event loop, preservation of the actual error and zero owned probe,
guard or writer descriptors after cleanup. Windows skips these POSIX-only cases;
the production Windows path uses stdin.

The real Electron workflow kills its actual text encoder immediately after the
probe and waits until its native reader is gone before returning from the probe.
It checks a reported export failure, an untouched existing destination, continued
editor access and subsequent successful range/overwrite exports in the same app.
All temporary encoders must exit, native frame directories must disappear and
extension export records must be released. Its user-data directory is explicitly
temporary and verified. No production fault-injection switch was added.

Separate lossless effect/text tests decode the real output and compare raw RGBA
frames, including alpha and EOF completion. Output-FPS checks measure actual
frame counts and timestamps. These functional checks are not production
throughput, memory or hardware budget acceptance.

## Frozen candidate results

All six focused suites passed on the unchanged 1,028-file source snapshot.
The native FIFO regression passed all 5 cases with zero owned
descriptors remaining. The real Electron workflow passed 29
checks with no renderer errors; every temporary text encoder exited and all
frame directories were removed. The real effect output preserved all six RGBA
frames exactly. All 7 measured output-FPS variants passed their
frame-count and timestamp assertions. The two text/effect suites also passed
with `FVE_PLAIN_FRAME_PIPES=1`, exercising ordinary stdin. Structure and whitespace
checks passed. No performance-budget claim follows from these results.

Exact source snapshots, raw baseline and native evidence:
`plugin-validation.json.extensionHostFifoHandoff` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-bbu3k5rw/verification.json`.

## Remaining acceptance

The earlier timeout remains an unattributed historical observation. This stage
closes the demonstrated FIFO handoff race, not arbitrary possible stalls.
Installed Windows/Linux acceptance, missing full-battery prerequisites,
representative hardware/performance budgets, remaining manual UX and complete
release/abuse/distribution gates remain open. No installer, publication, version
bump, commit or push is produced.
