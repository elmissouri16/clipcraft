# Bounded private-session reuse and stable SDK payloads

This follows the [normal-session observations](plugin-extension-normal-session.md).
App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. SDK v1 and production
performance acceptance remain on hold.

## Private session lifetime

Electron retains private session objects after their views close. The earlier
host created a new partition on every opening, so the concurrent view cap did
not bound lifetime session creation. `extensionViewSessions.cjs` now creates at
most sixteen sessions per view host, lazily, with one exclusive lease per live
view. A reservation can wait for cleanup but cannot expose the session early.

Closing revokes the protocol and bridge, clears the captured package files and
destroys the renderer. Only after renderer destruction does the lease close
connections and clear native storage, data, cache, authentication and code
caches. Cleanup rejection, an uncleared protocol handler or a fifteen-second
cleanup deadline permanently excludes that slot until app restart. A late
completion cannot restore a failed slot. An old lease cannot release a newer
lease. Each reopening has a fresh origin, instance and private bridge token.
Permission/download denial handlers do not accumulate across reopenings.

Opening also revalidates the extension registration and activation after waiting
for a lease. Owner navigation/destruction and host disposal invalidate pending
opens. This prevents delayed cleanup from attaching a view to a replaced owner
or stopped activation.

Native Electron checks seed different cookies, localStorage, IndexedDB and
CacheStorage in two concurrent sessions at the same test origin. Reusing one
clears all four stores without clearing its live sibling. Separate native GC
diagnostics check that closed jobs, native wrappers and package buffers are no
longer rooted. Those forced-GC diagnostics are not performance measurements.

## SDK build paths

The SDK previously passed an absolute entry path to esbuild. Moving identical
source changed a generated source-label comment and therefore the immutable
payload fingerprint. Bundling now uses the canonical real project directory as
`absWorkingDir` and the relative `src/extension.ts` entry. The regression moves
the same project between differently nested directories, includes a local
transitive TypeScript module and a local CommonJS dependency, then builds from an
unrelated caller directory. Payload bytes and keys must match, the dependency
must execute correctly, and the bundle must not contain the temporary root.

This does not change the fingerprint algorithm, existing installed bytes,
creative-only builds or versions. Compiler/input changes can still change
payloads. Tar timestamps are not normalized; arbitrary external or symlinked
dependency layouts are not certified as hermetic.

## Verification

All 107 plugin suites passed against the frozen source before the final pending
owner-navigation guard. All seven affected suites then passed against that guard,
including the visible native workflow's 45 checks. Native cleanup reused one
session over eight reopenings with zero retained jobs, wrappers or buffers.
The native storage-isolation workflow passed all three checks.

A further normal-GC Electron run completed 121 cycles over ten minutes with the
same 250-clip/video/service/stream workload as the prior report. It created just
two sessions throughout; Stop left zero leases, cleanup tasks, failed slots,
tracked owners and extension utility processes. Command median/p95 were
8.32/11.59 ms. Main RSS was 230.3 MiB at the first sample and 197.2 MiB after Stop;
main JS heap was 18.0 → 16.2 MiB. These are one-run observations on Apple M3 Pro,
36 GiB RAM, macOS arm64, Electron 45.3.1 and Node v24.22.2. Samples retain CPU,
memory and raw video counters; seeking means those counters are not an approved
frame-quality benchmark. The helper never forced collection.

Executable source stayed frozen for the entire measured run. Afterwards, the
native cleanup fixture alone gained assertions that all eight reused-session
openings have distinct origins and bridge tokens; that regression passed. Its
first sandboxed launch exited without a result or diagnostic and the isolated
run outside the sandbox passed. This launch failure is retained separately from
product assertions. Structure and whitespace checks passed. Earlier reproduced
relocation and pending-owner failures, plus the corrected standalone test's
last-window lifetime issue, are retained in the ledger.

Evidence, exact source snapshots and logs:
`plugin-validation.json.extensionHostSessionReuse`, with the normal workload
reproduced using:

```sh
FVE_EXTENSION_SESSION_MS=600000 node tests/unit/plugins/test-extension-views-ui.cjs
```

The final local evidence checkpoint is
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-gp785tsd/verification.json`.

## Remaining acceptance

These changes bound session creation and remove the reproduced workspace-label
difference. They do not approve a memory, CPU, latency or frame-quality budget.
Minimum hardware, representative projects and simultaneous-extension targets
still require maintainer input. Native Windows/Linux, installed releases,
assistive technology/manual UX, full-battery prerequisites, complete abuse and
distribution gates remain open. The earlier intermittent native export timeout
also remains unexplained. No installer, publication, version bump, commit or
push is produced by this stage.
