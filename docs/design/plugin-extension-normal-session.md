# Normal-session observations and closed-view owners

This follows [native layout acceptance](plugin-extension-layout.md). App
2.0.0, SDK 0.8.0 and host API 1 remain unchanged. Performance acceptance
and SDK v1 are still on hold.

## Measured workload

Two isolated macOS sessions each ran the active workload for ten minutes, followed
by settling and Stop. Each used a 250-clip timeline, an original 1280×720/30 fps
video, one active Node extension, two workbench views and a 2,097,166-byte packaged
asset. Every cycle sought playback, ran a managed job with an ordinary echo
service, pulled eight binary stream chunks (65,536 bytes), read the workspace,
inspected the project through view messaging and closed/reopened the sibling
view. The retained draft was checked each time. Both completed 120 cycles.

The window was shown without activation. The normal native launches pass no GC
flag, and session code never forces collection. Samples stream to NDJSON rather than accumulating
an unbounded in-memory history. The source stayed frozen for each run. Preparing
the media/package happens before measurement. This is a warm application case,
not a cold launch or large-inventory benchmark. Other desktop activity is not
controlled. The hardware was Apple M3 Pro, 36 GiB RAM,
Electron 45.3.1, Node v24.22.2 on macOS arm64.

| Observation | Cycles | Command median / p95 | Main RSS start → stopped | Main JS heap start → stopped |
| --- | ---: | ---: | ---: | ---: |
| Before callback fix | 120 | 8.02 / 12.02 ms | 218.0 → 313.7 MiB | 17.5 → 16.2 MiB |
| After callback fix | 120 | 7.06 / 11.07 ms | 216.0 → 306.7 MiB | 17.5 → 16.3 MiB |

These are observations from one run per candidate, not approved thresholds or
proof of a causal speed improvement. Both ended with every tracked view, sender,
activation, command, service, hook, pending call, cancellation, stream, job and UI
owner count at zero, and no extension utility process in native app metrics.
RSS still grew substantially in both runs. Natural-GC heap reduction and empty
ownership maps do not establish a flat memory budget.

The raw video counters include seeks and clip boundaries. Dropped frames are
preserved rather than treated as a passed frame-quality budget. Per-process CPU
and memory samples are retained: Electron reports process memory in KB and CPU
percentages over the interval since its last metrics call. Cumulative CPU values
are retained too. Shared working sets must not be summed as unique physical RAM.
See [Electron metrics](https://github.com/electron/electron/blob/main/docs/api/app.md).

## Reproduced and fixed closed-view context retention

After the first normal run, a separate native GC diagnostic found eight closed
jobs and eight native view wrappers still reachable, while package buffers were
already released. Stateless native/session callbacks were created inside
`openView`; their function contexts could retain the shared job scope after the
renderer closed. Those denial callbacks now live at module scope. Their denial
behavior is unchanged. The regression tracks jobs and native wrappers as well as
buffers; all three counts are now zero. Explicit GC belongs only to these separate
reachability diagnostics, not the normal-session measurements above.

All 11 related suites passed. The final visible native workflow passed
45 checks, covering keyboard, geometry, masking, rendering and lifecycle.
The existing SDK-built example remains the real-app fixture. The initial session
pilot called an incorrect restart bridge and failed before sampling; that driver
failure is retained. The corrected pilot and both complete sessions passed their
functional checks.

## Concrete work still open

Historical findings below describe the measured candidates in this report. The
[session reuse followup](plugin-extension-session-reuse.md) implements the bounded
session pool and workspace-relative bundle labels. The original observations and
evidence remain unchanged here.

A further native diagnostic collected closed jobs, wrappers and buffers but
retained 32 session objects after 32 reopenings. Each reopening currently creates a
new private partition. The concurrent-view cap therefore does not bound lifetime
session-cache growth. Session reuse needs a bounded design that waits for renderer
shutdown and successful state cleanup, preserves concurrent-view isolation and
never reuses uncleared state. This remains implementation work, not a waived gate.

The compared videos and asset payloads match. The generated entry differs only
in the temporary source-path comment inserted by the bundler; executable bytes
match after normalizing that comment. SDK-generated labels still need to become
independent of the workspace path for reproducible package bytes. The exact diff
is retained with the evidence. No SDK authoring change was made during the runs.

Minimum hardware/workload targets and latency/CPU/memory budgets still need the
maintainer's answer. Windows/Linux and installed-release acceptance, remaining
manual UX, full-battery prerequisites and the earlier unexplained export timeout
remain open. No installer, SDK publication, version increment, commit or push was
produced. These runs do not approve SDK v1.

## Evidence and reproduction

Authoritative source snapshots, raw failures, samples, metrics, native traces,
input comparisons and limitations are retained under
`plugin-validation.json.extensionHostNormalSession`:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-bp316xxo/verification.json`.

Run the optional session directly because the general suite runner has its own
shorter outer deadline:

```sh
FVE_EXTENSION_SESSION_MS=600000 node tests/unit/plugins/test-extension-views-ui.cjs
```

The duration accepts an integer from zero (normal workflow only) to 1,800,000 ms.
The native child has a separate startup/cleanup margin and an isolated profile;
its own process group/tree is terminated on deadline. Default tests still exercise
the ordinary native workflow without running the optional long session.
