# Closed extension-view package retention

> The later [normal-session followup](plugin-extension-normal-session.md) fixes
> separately retained closed jobs/wrappers and records remaining session caching.

This follows the [native keyboard checkpoint](plugin-extension-keyboard.md).
Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

## Reproduced retention and correction

Closing a view removed its protocol handler and cleared browser storage, but its
session request-filter callback still captured the package asset map. In-memory
Electron sessions can survive their renderers. The callback therefore kept the
captured package bytes reachable after the view was destroyed.

A native lifecycle baseline opened and closed 8 actual sandboxed views, each
with an independently allocated 8 MiB asset buffer. Every view webContents was
destroyed and all tracked view maps were empty. Nevertheless, all
8 payload buffers (64 MiB) remained reachable after explicit collection.
The test retains only WeakRefs to those buffers, not closed jobs or sessions.
A separate native session diagnostic released its retained buffers when only
the request callback was removed, confirming the retention mechanism.

The protocol helper now returns an idempotent disposer. It clears the captured
asset map, removes the protocol handler and replaces the request filter with a
shared deny-all callback. Clearing the map happens first, so an older retained
handler cannot serve package bytes during shutdown. The replacement also avoids
a network-access gap while the renderer is closing; simply removing the filter
would drop that restriction. Failure to remove the protocol handler still leaves
its map empty and installs denial. Closing a view invokes this disposer before
closing/crashing its renderer. Construction failure also disposes the protocol
and starts storage cleanup before propagating its original error.

Electron documents removing a request callback separately from protocol cleanup:
[session partitions](https://github.com/electron/electron/blob/main/docs/api/session.md),
[request listeners](https://github.com/electron/electron/blob/main/docs/api/web-request.md).
The continued request denial is ClipCraft's lifecycle requirement.

## Fixed-source evidence

The native regression now observes **zero retained package buffers after each of
8 close cycles**, with only its isolated owner webContents remaining. It uses
actual Electron sessions, WebContentsViews, sandboxed preloads and sender guards;
its package provider supplies deterministic in-memory assets. The separate real
application workflow installs the SDK-built workbench example.

The focused macOS selection passed **11 suites, 0 failures**. The visible
application workflow passed **35 checks**, including keyboard/focus, rendered child
content, message ownership, network/file denial, modal masking, unresponsive-view
termination, replacement registration and extension stop. Unit faults cover
idempotent disposal, stale protocol handlers, late request denial, constructor
failure and protocol removal failure. Structure and whitespace checks pass.
The 1,017-file source snapshot remained unchanged through the final run.

The initial diagnostic fixture parsed its launch arguments incorrectly; that
startup failure is retained separately from the subsequent product failure.
Baseline and final results, per-cycle memory samples, source hashes, captures,
versions and limitations are recorded in
`plugin-validation.json.extensionHostViewCleanup`. Authoritative evidence:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-gb39oy_h/verification.json`.

## Acceptance boundary

Explicit GC establishes buffer reachability; it is not normal-use memory or
performance acceptance. Native session metadata and browser caches are not
claimed to have a flat lifetime budget. Representative workloads/hardware,
long-session memory, remaining manual UX, supported Windows/Linux and installed
release acceptance, full-battery prerequisites and the earlier unexplained export
timeout remain open. This fix does not approve SDK v1. No installer, version
increment, SDK publication, Git commit or push was produced.
