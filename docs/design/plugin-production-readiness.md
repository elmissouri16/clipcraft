# Plugin production-readiness audit

> Latest combined candidate: [full regression followup](plugin-extension-full-regression.md),
> including raw whole-app results, corrected test profiles and retained external
> prerequisites/live-service failure. SDK v1 and release remain on hold.

> Current implementation: [general Node extensions](plugin-extension-host.md).
> The recipe-specific findings below preserve the original audit. The latest
> [stabilization checkpoint](plugin-extension-stabilization.md) records discovery
> measurements, native lifecycle cleanup, reproducible fixtures and the
> [SDK compatibility/storage policy](plugin-sdk-compatibility.md). Production
> [Creative intake and platform verification](plugin-extension-platform-followup.md)
> adds real Linux development evidence;
> release remains on hold; these targeted checks do not close the platform,
> installed-release, long-session memory or manual UX gates.

Date: 2026-11-15. Status: **hold plugin SDK 1.0; stabilize the current surface**.

The original static audit covered this checkout, including the uncommitted SDK
0.8.0 changes, against the existing contracts and retained validation evidence.
During that original audit, no application code was changed and no tests, app
sessions, builds, installers, network/provider requests, commits or pushes were run.
Only this report and its contributor-index link were added at that stage.
The follow-ups below record subsequently authorized fixes and verification.

The SDK version, manifest API version and ClipCraft application version are
separate: the checkout currently declares SDK 0.8.0, host API 1 and application
2.0.0. Neither the API number nor the SDK minor version establishes readiness.

## Decision and scope

The original audit recommended pausing feature expansion. The maintainer has
since required the [missing SDK capabilities](plugin-roadmap.md#current-pre-v1-scope)
to be completed before v1, without version increments. That direction supersedes
the feature deferrals below; the correctness and release gates still apply.
The packaged GIF source dependency is fixed and verified in an isolated file-mode payload. REC-01 and
REC-02 now have targeted macOS fault/restart/UI follow-ups below. TXN-01's
combined review reproduced and fixed a queued-authorization revocation race;
bounded generated, native and real-app acceptance is recorded below. REL-01 now
has a [fixed-candidate full-battery report](plugin-release-readiness.md);
it remains red, with unresolved filter-preview reliability, prerequisites, live-service
and distribution/platform gates. Those gates still need closure. Bounded ripple
removal now has its [own contract and selected verification](plugin-ripple.md).

The working candidate currently covers local package management, presets,
effects/transitions, bounded commands, panels/storage, registered menus, current
editor transactions, GIF export and brokered AI/provider capabilities. The target
v1 scope additionally includes the unfinished capability checklist above. A
version increment does not waive those requirements. Removing a requirement
from v1 needs a new explicit maintainer scope decision; listing limitations
alone does not close a correctness or implementation gap.

New toolbar/inspector surfaces, additional provider protocols, uploads
and managed native jobs remain unfinished pre-v1 scope. Explicit linked reordering
now has its [own bounded contract](plugin-linked-reorder.md) and selected verification;
that does not close the release/platform gates.
Marketplace/automatic updates retain their separate distribution plan. Publisher
verification and signing remain separate distribution work; a manual local-package v1 can retain the
current explicit unverified-publisher policy. Do not silently add these deferred
items as release requirements.

## Findings at a glance

P1 means a release blocker. P2 means required hardening or a readiness gate for
the affected supported surface. PKG-01, TXN-01, REC-01 and REC-02 have targeted follow-ups below;
installed release-artifact acceptance and the other findings remain open. An evidence gap is
not a demonstrated runtime failure or security exploit.

| ID | Priority | Classification | Finding |
| --- | --- | --- | --- |
| PKG-01 | P1 | Source fixed; staged payload verified; release artifact gate open | GIF host now uses shipped shared rendering helpers; installed release/ASAR acceptance remains part of REL-01. |
| REL-01 | P1 | Full battery red; release/platform gates open | Fixed-candidate macOS results, integration fixes and artifact hashes recorded; unresolved failures and installed/platform acceptance prevent closure. |
| TXN-01 | P1 | Source race fixed; bounded macOS review/tests verified | Permission/mixture/private-plan review and generated/native/app evidence recorded; queued authorization can no longer apply after catalog revocation reaches the renderer. Installed release/platform acceptance remains open. |
| REC-01 | P2 | Source fixed; macOS faults/restart/UI verified | Disabled pending-removal entries survive cleanup failures and interruption and can be retried. Release-platform certification remains open. |
| REC-02 | P2 | Source fixed; macOS faults/restart/UI verified | Explicit recovery preserves damaged indexes and managed leftovers, validates packages and reconstructs disabled versions. Installed release/platform verification remains open. |
| PERF-01 | P2 | Measured discovery/cleanup; acceptance budget open | Concurrent discovery shares one scan and command dispatch verifies its requested package. Native repeated activation releases registrations/children; long-session memory and representative hardware budgets remain open. See [stabilization](plugin-extension-stabilization.md). |
| UX-01 | P2 | Native and integration verification gap | Hidden scripted checks leave native focus, real approval interaction and representative provider/media use unverified. |
| SDK-01 | P2 | Current policy documented; release matrix open | Current Node declarations/author documentation and [compatibility/storage rules](plugin-sdk-compatibility.md) are reconciled. Native update/rollback/reinstall/recovery and clean-consumer checks pass; stable publication and the installed/platform matrix remain open. |

## PKG-01 — GIF export depends on source excluded from release

**Original audit evidence.** [commandRuntime.cjs](../../electron/plugins/commandRuntime.cjs#L135)
imported `../../src/state/store.js` to obtain `renderable` and `exportDuration`
when preparing an `export.gif` command. The explicit
[application file list](../../package.json#L116) includes `dist`, `electron`,
`shared` and `assets`, with no `src` entry. The
[release config generator](../../scripts/prepare-release-config.cjs#L10)
copies that file list; the
[after-pack hook](../../build/after-pack.cjs#L46) normalizes permissions rather
than adding the missing source.

**Trigger and consequence.** A user runs an installed GIF plugin from the
declared release payload. The dynamic import targets an absent source file and
the command fails during host preparation, before its worker executes. This is
a source-level packaging incompatibility; the packaged failure was not executed
in this audit.

The existing [GIF UI runner](../../tests/unit/plugins/test-plugin-gif-ui.cjs#L8)
launches Electron against the repository and a Vite server. The source exists in
that environment. The [structure checker](../../scripts/check-structure.cjs#L8)
checks paths on the checkout, not membership in the release payload. Both can
therefore pass while this defect remains.

**Fix direction.** Remove the main-process dependency on renderer source. Put
the necessary pure host/shared behavior in an appropriate shipped module, with
one authoritative definition of renderable/export-duration semantics. Avoid
copying reducer logic or including the entire renderer source tree as a quick
packaging workaround.

**Acceptance criteria.**

- A dependency check evaluates host imports against the declared distributable
  files and fails on a host-to-unshipped-source import.
- The GIF preparation path runs using only the declared shipped resources,
  with no repository `src` tree or development server available.
- An installed GIF package completes in the release application; output fully
  decodes with the requested range, dimensions, duration and composition.
- Refusal, cancellation, failure and existing-destination protection still work.
- A renderer build alone is not recorded as packaged-runtime verification.

Installer construction remains subject to the repository's separate explicit
build authorization. This audit does not authorize packaging or publication.

## PKG-01 follow-up — source fixed; staged payload verified

The GIF host now imports `shared/projectRender.mjs`. Main-track timing and
renderable layer projection moved there without changing their behavior; the
store imports/re-exports the same function objects for existing callers. No SDK
or manifest API version changed. The structure gate now checks literal host and
shared imports against the declared application source allowlist, including
negative tests for the original source-tree dependency. Its only smoke-dispatch
exception requires the exact editor entry, test-dispatch path and positive
`FVE_SMOKE` guard. Computed paths and dependency pruning are outside this check.

All 19 focused layer/export/plugin suites passed. The isolated
host test installs the actual GIF package and prepares/completes its job from
copied shipped host/shared folders with no renderer sources. A hidden real
Electron run passed 22 checks using the production renderer loaded from
`file://`, no Vite server, no example autoload and no `src`, `scripts`, `tests`
or `examples` inside the application payload. The test observer/bootstrap live
outside the payload and redirect only the existing optional smoke dispatcher.
Installed dependencies are linked from the current dependency tree.

That app installed the external GIF archive through Settings, ran the actual
sandbox worker and host frame renderer, fully decoded its output and checked
sampled preview/export parity, disabled-picture gaps, failure, refusal, Stop and
existing-destination protection. Native choices remain scripted. Structure,
runtime dependency and whitespace checks passed. Earlier fixture/test-assertion
failures and their corrections are recorded in the evidence, rather than being
counted as application passes.

Evidence: `packagedGifDependencyFix` in [plugin-validation.json](plugin-validation.json).
This closes the identified source-layout defect and its staged-payload regression.
It does **not** certify an installed/signed release, ASAR, a dependency-pruned
artifact, Windows/Linux, native focus or the full battery. Those gates remain
open under REL-01 and UX-01. No installer was built and no push was performed.

## REL-01 — Establish a candidate-wide release gate

**Evidence.** The latest [roadmap outcome](plugin-roadmap.md#explicit-link-management-and-pair-movement-outcome)
and `linkManagement.limitations` in [validation evidence](plugin-validation.json)
explicitly leave the full battery, packaged runtime, physical OS focus and
Windows/Linux open. Focused macOS development results are useful evidence for
their own scope. They are not a candidate-wide release pass.

No tracked `.github` workflow files are present in this checkout, although the
release script and AGENTS.md refer to a release workflow. Upstream automation
was not inspected, so this is an inability to verify the local release gate,
not a claim that no upstream CI exists.

The [general test runner](../../scripts/test.cjs#L20) also has a fixed suite
timeout that is shorter than the inner deadline in the
[GIF UI runner](../../tests/unit/plugins/test-plugin-gif-ui.cjs#L14). A slow
machine can be killed by the outer runner before the inner workflow's allowed
deadline. This mismatch needs classification before using the battery as a
release gate; it is not a reason to disregard failures.

**Acceptance criteria.**

- Name a fixed candidate revision and the supported OS/architecture matrix.
  Capture the SDK package and application artifact hashes and toolchain versions.
- Run the full battery on that candidate in a suitable environment. Triage each
  failure with a reproducible cause; do not carry forward the historical
  AGENTS.md baseline or classify all failures as environmental by default.
- Run clean-profile install, enable, command/panel use, save/restart/reopen,
  export, update, rollback, disable and remove in each supported release app.
  Include retained effect/transition dependencies and missing-plugin recovery.
- Retrieve/reconcile the actual release workflow and make required checks block
  release. Document manual gates if some hardware checks cannot be automated.
- Align runner/workflow timeout policies and retain each suite's actual result.
- Store a candidate-wide release report, including unresolved failures, linked
  to durable evidence and artifact hashes. Explicitly narrow platform support if
  a platform cannot be certified.

### REL-01 follow-up — Full battery and failure triage

The [candidate report](plugin-release-readiness.md) and
[structured evidence](plugin-release-evidence.json) supersede the original
full-battery/workflow evidence gaps above. Three frozen macOS runs retained all
suite outcomes; the final source includes native schema portability/budget fixes,
a corrected runner and a verified project-audio crash fix. The outer runner now
allows 360 seconds for ordinary 300-second inner workflows.

The final raw runner result is 278 PASS / 8 FAIL of 286;
two raw passes are explicitly skipped live-agent opt-ins. Earlier filter-preview
failures remain unexplained despite later passes. The final linked Undo failure
was isolated to derived cover metadata and its fixture corrected in a separately
verified post-battery change; raw full-run results were preserved. Source and
renderer/SDK manifests stayed unchanged during the final run. Renderer compilation
and a local SDK tarball were verified; no installer or installed-app certification
was performed. Retrieved upstream automation belongs to Cutflow, while this fork's
release gate still needs reconciliation. REL-01 remains open.

### Subsequent pre-v1 feature work

[Shifted-pair split/trim](plugin-linked-edits.md#shifted-pair-pre-v1-verification)
was subsequently implemented without version changes and verified in selected
plugin/project suites, SDK-built real-app workflows, actual exports and a real
process restart. The earlier full-battery candidate fingerprint does not cover
this later implementation. This feature outcome does not close REL-01, the
remaining pre-v1 capabilities or installed/platform verification.

[Explicit linked reordering](plugin-linked-reorder.md#verification-outcome) was
then implemented with combined grants and per-operation companion allowlists,
also without version changes. Selected contract/native/SDK and real-app restart/
export acceptance is retained separately. The earlier full-battery candidate
fingerprint does not cover this extension either; REL-01 and the remaining
pre-v1 scope stay open.

## TXN-01 — Certify the existing mutation boundary before expanding it

**Evidence.** The current
[planner](../../src/state/store.js#L1680) accepts several classes of ordered
operations under separate grants. New link management captures complete arrays
and [private preserved link groups](../../src/state/store.js#L1855). During
preparation, [link synchronization](../../src/state/store.js#L2034) can be skipped
for those exact private groups to preserve fractional source arithmetic. The
[normal synchronizer](../../src/state/store.js#L1440), immutable plan tokens,
stale-base guard, receipts and native commit grants all participate in the
resulting safety argument.

The targeted [link-management suite](../../tests/unit/plugins/test-plugin-link-management.mjs)
already covers many relevant boundaries. This finding is not a claim that its
exception is exploitable. It identifies a high-impact area that has grown
across slices and needs combined certification before v1. The audit has not
established a permission bypass or document-corruption exploit.

**Acceptance criteria.**

- Record a permission-to-operation matrix and trace each operation from worker
  proposal through native authorization, private planning, reducer application
  and reported result. Old grants must retain their old authority.
- Review ordered mixtures across multiple pairs and unrelated clips, including
  link/move/unlink, split/unlink, main-range edits and free edits. Establish which
  combinations are supported and explicitly reject the rest atomically.
- Exercise fractional in/out points, speeds and offsets; transitions, locks,
  motion pins, omitted snapshot members, collisions and all affected-clip limits.
- Use generated operation sequences to check invariants: exact intended write
  scope, no changes on rejection, consistent complete links, no unauthorized
  timing/source changes, single-use commits and one-step Undo/Redo.
- Exercise refusal, Stop, package changes, document replacement, owner changes,
  late native approvals and queued results at each asynchronous boundary.
- Run save/restart/reopen and preview/export checks for successful edits, with
  representative moving video and audio. Document which derived fields may
  change independently, rather than broadening comparisons until tests pass.
- Keep the link-sync exception private to a validated complete plan. Review its
  lifetime and aliases; no public JSON field may opt out of normal safeguards.

### Follow-up — combined review and revocation fix (2026-11-15)

The [permission and transaction review](plugin-transaction-review.md) records the
operation matrix, allowed/rejected ordered mixtures, worker-to-native-to-reducer
trace, private link-preservation lifetime and cancellation/commit decision points.
Old grants keep their separate authority. No planner or public mutation schema
was expanded.

A real Settings failure was reproduced: disabling a package after native
authorization succeeded but before its queued response reached the renderer
still allowed the staged edits to apply. CraftAI's equivalent test also failed.
Both renderer execution paths now listen for catalog revocation until dispatch,
canceling completed-but-unapplied proposals. Manual development commands also
listen for snapshot revocation, and a pending development authorization remains
cancelable. Work already dispatched reports its actual receipt rather than a
false rollback. The passing delayed-response tests cover package disable, Stop,
document replacement, owner changes and CraftAI revocation.

The new bounded generated suite checks all subsets of the edit grants and
ordered two-pair/free-edit sequences against an independent oracle. Additional
native/panel cases cover late approval, refusal, package/owner changes, expiration,
Stop and concurrent authorization. Existing tests check omitted snapshot members,
fractional ranges/speeds/offsets, transitions, locks, source bounds, motion pins,
affected limits, stale plans, opaque-token isolation and Undo/Redo. The mixed real
command combines all five grants, uses moving video and audio, and verifies exact
sources, native save, actual restart/reopen, preview and real exports. Its project
comparisons retain thumbnail/poster fields after media setup settles and exclude
only separately derived waveforms. Evidence and measured results are under
`transactionReview` in [plugin-validation.json](plugin-validation.json).

This closes the targeted source review and reproduced race; it is not a blanket
security certification or exhaustive proof over arbitrary operation sequences.
REL-01/UX-01 retain installed release/ASAR, supported Windows/Linux and real native
interaction acceptance; PERF-01 and the full battery remain open. No SDK/API
bump, installer, publication, commit or push was made.

## REC-01 — Removal loses its cleanup record on failure

**Original audit evidence.** [PluginManager.remove](../../electron/plugins/manager.cjs#L119)
first saves inventory without the version, then clears panel storage, then
removes the payload. Either cleanup operation can fail after the inventory save.
A retry with that key reaches `Unknown plugin.` because the row is already gone.
The [Settings removal flow](../../src/features/plugins/components/PluginSettings.jsx#L47)
has no separate pending-cleanup operation. The package lifecycle test checks
successful removal; it does not inject failure between these steps.

**Trigger and consequence.** Inventory is writable, but preference or package
cleanup fails because of a file lock or filesystem permissions, or the process
stops after the inventory update. The version is undiscoverable through normal
inventory while payload and/or preferences can remain on disk. A failed cleanup
cannot be retried through the same removal call. This conditional outcome
follows from source ordering; no filesystem fault was injected in this audit.

**Acceptance criteria.**

- Make removal retryable or journal pending cleanup until its intended effects
  are complete. A partially removed version must never become executable again.
- Fail each cleanup step independently, and interrupt/restart between steps.
  Preserve enough information for deterministic retry or a visible recovery action.
- Test open/locked files on supported platforms and user-readable error states.
- State whether package preferences are retained or deleted, and ensure the
  result matches that policy without silently forgetting residual data.
- Preserve pinned project metadata and the existing missing-dependency behavior.

## REC-01 follow-up — retryable removal verified on macOS

Removal now records `enabled: false, removing: true` in the atomic inventory
before deleting anything. The temporary file is synced before publication.
The marker survives failed preference/payload cleanup, partial payload deletion
and a failed final inventory write. The row is removed only after cleanup
succeeds. Inventory normalization gives pending removal precedence over an
activation flag. Pending rows expose no manifest to contribution discovery, so
another active version cannot make them available as retained render dependencies.
Activation, same-fingerprint reinstall and separate preference clearing are
blocked until cleanup completes; an explicit retry needs no intact payload.

Settings shows a localized pending state and one retry button, including after
restart. The initial deletion remains confirmation-gated. Management IPC refreshes
provider/catalog state on failure as well as success and preserves the original
operation error even if refresh or notification fails. Removal deletes this
version's panel preferences and package; project metadata, unrelated files and
versions, and the existing provider-credential policy are preserved.

Validation: 22 targeted recovery/fault checks and all 12 focused
plugin, project and localization suites passed. These include injected access,
busy and space failures, actual rename/fsync failure paths, partial deletion,
symlink safety, open-file handling and SIGKILL at the durable-mark, preference
cleanup and payload cleanup boundaries. A fresh service/process can retry each
pending operation. Legacy inventory rows keep their original shape.

The real Settings workflow passed 11 hidden-app checks followed by
12 checks in a fresh Electron process. It opened a real panel, injected
a payload cleanup failure, verified panel closure and immediate pending state,
restarted, refused activation/execution, completed an explicit retry, and checked
clean reinstall without restoring deleted preferences. The complete project and
Undo state were unchanged. The pending-removal screenshot was inspected. Existing
panel-storage/restart and command UI regressions passed; compilation, structure,
runtime-source boundaries and whitespace passed too. Evidence is retained under
`removalRecovery` in [plugin-validation.json](plugin-validation.json).

This fixes REC-01's forgotten-retry defect. General corrupt/missing inventory
repair and discovery of orphans left before this fix remain REC-02. No automatic
startup deletion or reactivation was added. Tests cover process interruption,
not power loss, and use deterministic filesystem faults plus macOS open-file
behavior. Windows/Linux, installed releases, native focus and the full battery
remain unverified. No SDK/API version was advanced and no installer, commit or
push was made.

## REC-02 — Define non-destructive inventory and storage recovery

**Original audit evidence.** [inventory()](../../electron/plugins/manager.cjs#L8) deliberately
rejects unreadable/invalid inventory, and save uses a temporary file followed by
rename. That is preferable to silently resetting user state. However, the
inspected manager has no backup/recovery entry point. Settings displays the
error and normal install/remove operations also require readable inventory.
The [contract](plugin-system.md#components-and-ownership) tells users to restore
inventory; a supported repair workflow and interrupted-write evidence are not
established by the inspected tests.

**Acceptance criteria.**

- Document or implement a supported recovery path that preserves a copy of bad
  state, validates recovered packages and requires explicit activation consent.
  Do not reconstruct an inventory by automatically enabling every directory.
- Cover malformed inventory/preferences, missing directories, truncated writes,
  denied writes, out-of-space errors and process interruption around publication.
- Reconcile abandoned install/write staging and partial removals on restart.
  Never delete unknown user files as a side effect of repair.
- Ensure Settings remains usable, project loading remains safe, and dependency
  errors explain recovery options without erasing project references.

### Follow-up — explicit recovery implemented (2026-11-15)

The host-only [inventory store](../../electron/plugins/inventory.cjs) preserves
readable original bytes before reconstruction, validates exact package contents
without execution, and requires an expiring single-use review token. Settings
offers review/cancel/apply even when inventory discovery fails. Recovered rows
carry a durable disabled marker, preserve known removal intent, and cannot become
retained render dependencies through another version's activation or the example
bootstrap. Only explicit activation/reinstallation clears that marker.

Recovery archives invalid managed payloads and recognized staging whole, retains
unknown files and panel preferences, and leaves unavailable references visible.
Unreadable/unsafe/oversized indexes block replacement. Backup corruption is
preserved for explicit review; the previous good index is kept on ordinary writes
without using it to reactivate packages. A healthy current index takes precedence
over stale backup rows. Failures after index publication leave all reconstructed
versions disabled and remaining artifacts reviewable for an explicit retry.
Settings' built-in provider list remains usable on inventory failure, active
plugin-provider requests are revoked, and failed renderer refresh clears stale
effect/transition catalogs without rewriting projects. The supported recovery and
manual-access procedure is in [plugin system](plugin-system.md#inventory-recovery).

Validation and exact evidence paths are recorded under `inventoryRecovery` in
[plugin-validation.json](plugin-validation.json). The focused recovery suites
include byte preservation, missing/truncated/invalid state, malformed preferences,
symlinks, stale/replayed reviews, permission/space/fsync/rename failures and SIGKILL
around archiving/publication. Real hidden Electron checks cover damaged startup,
Settings review/cancel/stale/blocked states, a post-publication failure and retry,
then a fresh process and explicit activation. Whole-project and Undo preservation,
exact dependencies and pending-removal retry are checked. Existing removal,
storage, commands and effect/transition app regressions pass. No SDK/API version
was advanced.

This establishes the source workflow and targeted macOS development evidence;
REL-01 and UX-01 retain installed release, Windows/Linux and native interaction
acceptance. Deterministic filesystem faults and SIGKILL do not certify power-loss
durability. Both damaged indexes can lose historical removal intent; reconstructed
payloads remain disabled for explicit user choice. Archives have no automatic
retention/deletion policy. Full battery, installer, commit and push were not run.

## PERF-01 — Measure responsiveness and lifecycle resource use

**Evidence.** [list()](../../electron/plugins/manager.cjs#L37) reads and validates
each installed version sequentially. [commandBundle()](../../electron/plugins/manager.cjs#L27)
performs a target read, a full list, then another bundle read. Panel heartbeat
[verification](../../electron/plugins/panelRuntime.cjs#L80) and provider request
[verification](../../electron/plugins/providerService.cjs#L30) also repeat
integrity checks. [Editor context](../../src/features/plugins/editorContext.js#L9)
projects a bounded public snapshot after walking the project, while mutation
planning intentionally examines omitted private clips too.

These are observable work patterns, not measured performance failures. The
inspected plugin evidence has no supported-load latency/resource budget or
long-session trend sufficient to approve them for production.

**Acceptance criteria.**

- Define supported workloads and hardware, then approve latency, CPU, memory and
  cleanup budgets before interpreting measurements.
- Measure cold/warm catalog loads, large retained inventories, large projects,
  normal playback with a panel open, and provider/tool activity.
- Soak repeated command runs, panel open/close/crash cycles and developer reloads.
  Track surviving renderers, timers/watchers, connections, temporary files,
  session resources and memory trend after settling.
- Measure host/UI responsiveness while integrity checks run and cancel a job.
- Optimize only demonstrated bottlenecks, with tests preserving revocation and
  fingerprint guarantees. Do not replace integrity verification with an unsafe
  cache merely to lower a benchmark.

## UX-01 — Close the native interaction and realistic-use gaps

**Evidence.** The latest
[smoke runner](../../tests/unit/plugins/test-plugin-link-management-ui.cjs#L35)
uses Vite and hidden Electron. Its
[workflow](../../tests/smoke/smoke-plugin-link-management.cjs#L10) scripts native
dialog answers. The [panel smoke](../../tests/smoke/smoke-plugin-panels.cjs#L53)
explicitly skips native Tab/Shift-Tab focus checks in quiet mode. The latest
media proof uses generated picture/sine sources; provider/AI contracts separately
identify fixture results and live-quality limitations.

**Acceptance criteria.**

- Check keyboard-only entry/exit, native focus return, Escape/Cancel, permission
  dialogs, modal masking and visible error/recovery states in the real supported
  OS applications. Include smaller windows, display scaling and long labels.
- Exercise actual update/removal/restart while panels or commands are active;
  distinguish canceled staging from a commit already past its atomic boundary.
- Use moving source video, audio offsets, transitions, captions and retained
  plugin effects in realistic projects, then fully inspect the actual exports.
- Validate each advertised provider protocol/service path against a representative
  real service, including credentials, image capability, tool calls, streaming,
  failure and cancellation. Live service use remains a separate authorized task;
  this audit made no calls and does not imply paid-model validation.
- Record native and live checks separately from scripted/hidden checks.

## SDK-01 — Stabilize one public contract and release policy

Current followup: [fresh-cache SDK verification](plugin-sdk-cache-followup.md)
fixes offline-consumer preparation in the local workflow and verifies both exact
Node runtimes on macOS/Linux arm64. Author entry points now distinguish the
current Node API from retired recipes. Remote CI, stable publication and the
installed-platform matrix remain open; the historical audit below is retained.

**Original evidence.** The audit found that the SDK design document described
marker-restricted panel commands while the host admitted bounded clip-edit
grants, and that the command contract lagged the canonical permission list.
Those two documentation mismatches were reconciled during the shifted-pair
pre-v1 work. Capability/version policy, migration and complete distribution
acceptance below remain required.
The [SDK README](../../packages/plugin-sdk/README.md) correctly describes a local,
unpublished development package. Panel storage and provider consent/credentials
are fingerprint scoped; cross-version storage migration is now required pre-v1 scope.

**Acceptance criteria.**

- Reconcile the README, design contracts, examples, declarations, validators,
  permission labels and actual runtime support matrix. Treat historical stage
  outcomes as historical evidence, not current author instructions.
- Publish the supported host-version/capability floor and additive/breaking-change
  rules for API 1, including behavior on older hosts and unknown grants.
- Define stable error categories, cancellation/commit semantics and SDK disposal
  expectations for authors. Distinguish expected unsupported operations from bugs.
- Choose and document storage/credential behavior across update, rollback,
  uninstall and reinstall. Keeping versions isolated is a valid policy if users
  understand it; the current pre-v1 scope additionally requires an explicit,
  reviewed preference-migration path without silently transferring credentials.
- Verify a fresh author can use only the reviewed distributed SDK, instructions
  and declared dependencies to build, validate, package and install each supported
  scaffold without importing checkout internals.
- Define the reviewed SDK artifact, provenance/checksums, changelog and support
  policy. Actual publication requires explicit authorization and is not part of
  this audit.

## Closure order

1. Fix PKG-01 and establish a shipped-resource dependency check.
2. Fix REC-01; establish REC-02 recovery behavior and fault tests.
3. Complete TXN-01's combined permission/transaction review and invariants.
4. Close REL-01 on a fixed candidate, with the actual distribution and supported
   platform matrix. Preserve all failures and their disposition.
5. Close PERF-01 and UX-01 against declared workloads and real interactions.
6. Reconcile SDK-01 and freeze the reviewed v1 contract and release artifacts.

Fixes should be small and separately reviewable. Do not start an architectural
rewrite or another editing feature under the label of stabilization. A v1
decision requires the gate evidence above or an explicit removal of the affected
surface from its supported scope; a version bump is not an acceptance criterion.

## Audit boundary and evidence preservation

Inspected: package layout, SDK/manifests, immutable storage, command/panel
ownership and IPC restrictions, provider revocation, edit preparation/commit and
link synchronization, GIF host rendering/publication, selected tests and their
retained evidence, author documentation and the local test/release scripts.

Existing strengths include bounded proposals, exact-version fingerprints,
isolated plugin renderers, denied legacy IPC, explicit consent, host-owned output
publication and private stale-state/Undo guards. Their presence is not a blanket
security certification. This was a bounded source audit, without adversarial
execution, fault injection, timing measurements or a new test pass.

The existing `linkManagement` validation record was read from disk and its cited
focused-suite, native-runtime, SDK-authoring and real-app evidence files still
existed at audit time. Those previous passes retain their stated macOS
development/fixture limits. Full-suite counts in older instructions or memory
were not promoted to current verification. No existing validation record or
roadmap checkbox was changed during this audit.

Audit base commit: `331642623c32550de27d1c7075201f575177d63a`, plus the existing
uncommitted SDK 0.8.0 work. The content snapshot of changed files outside `docs/`
was `5143666088ba12475fd31a2744a7bac4ecb2136fe23201532b3cef595b8610cd`
(SHA-256 over sorted changed paths and their bytes, with NUL delimiters). This
identifies the reviewed worktree in addition to HEAD; it is not a release-artifact
hash or proof that the worktree passed a test run.


## Subsequent bounded ripple verification

The newly implemented [ripple removal](plugin-ripple.md) capability requires a
separate grant and explicit free-clip/pair scope. Its selected regression set
passed 66 suites, including 102 contract checks with 600 oracle cuts and native
runtime/SDK-authoring checks. Hidden real Electron acceptance passed 34 checks
plus 11 in a fresh process, including source-frame/tone exports. SDK/renderer
builds and structure/whitespace checks passed. Full retained evidence is in
`rippleEditing` in [validation](plugin-validation.json).

This capability postdates the fixed-candidate full-battery report. That report
is historical evidence for its own candidate and does not certify the expanded
surface. Release/artifact/platform, performance, UI acceptance and remaining
pre-v1 implementation requirements remain open. The SDK, API and application
versions remain 0.8.0, 1 and 2.0.0 respectively; no release was made.


## Subsequent lifecycle and placement verification

[Bounded clip lifecycle and explicit track placement](plugin-lifecycle.md) now
have separate grants and a validated private plan. The fixed-candidate selected
regression passed 71 suites; the SDK-built real-app fixture passed 37 checks and
11 after restart, including exported source frames/tones and track-only counts.
SDK/renderer builds and structure/whitespace checks passed. The `clipLifecycle`
validation record preserves the initial dev-reload interruption and final rerun.

This postdates the historical full-battery candidate. It closes this bounded
implementation item, while the remaining pre-v1 capabilities, installed artifact,
platform, performance and UI gates remain open. SDK 0.8.0, host API 1 and app
2.0.0 remain unchanged; no release was made.


## Subsequent static property verification

[Static text, picture and audio property edits](plugin-properties.md) now use a
separate grant and bounded typed proposals. A fixed-source selected regression
passed 78 suites, including actual preview/export and raw video/audio-only
mute checks. The SDK-built fixture passed 36 real-app checks plus 13 after
restart. It reproduced and fixed free-audio mute being ignored by export; the
`staticProperties` validation record retains the failure and final measurements.
SDK/renderer builds and structure/whitespace checks passed.

This postdates the historical full-battery candidate and changes shared export
projection/mixing, so prior release-artifact evidence does not certify this
expanded candidate. Speed/keyframe/effect editing, other pre-v1 features and
installed release/platform/performance/UI gates remain open. SDK 0.8.0, host
API 1 and app 2.0.0 stay unchanged; no release was made.


## Subsequent source automation verification

[Bounded speed, source curves and effect-slot editing](plugin-automation.md)
now have separate grants and exact target/resource scope. The fixed-source
selected regression passed 83 suites; the SDK-built app fixture passed
38 checks and 12 after restart, including real source-frame/tone/curve/effect
exports and dependency revocation. SDK/renderer builds and structure/whitespace
checks passed. Full retained evidence is in `sourceAutomation` in validation.

The private effect commit guard follows the renderer catalog revision; selected
macOS evidence is not installed-release or cross-platform race certification.
This capability postdates the historical full-battery candidate. Toolbar and
inspector extensions, other pre-v1 capabilities and the remaining artifact,
platform, performance and UI gates remain open. SDK 0.8.0, API 1 and app 2.0.0
remain unchanged; no release was made.


## Subsequent native control verification

[Toolbar and scoped inspector actions](plugin-native-controls.md) now reuse the
verified command boundary, with strict boolean/numeric/enum inputs and explicit
Apply. The final fixed-source selected regression passed 85 suites; the new
SDK-built fixture passed 27 app checks plus 6 after restart. SDK/renderer
builds, structure and whitespace checks passed. Native consent, exact scope,
cancellation ownership, locks, disable/removal, Undo and saved/default values
were verified; the captured surface was inspected. Retained evidence is in
`nativeControls` in [validation](plugin-validation.json).

This expands the candidate after the historical full-battery run. Selected macOS
coverage and hidden-window focus checks do not certify packaged runtime, other
platforms or native OS focus. Host-reviewed panel AI/caption/GIF and other unchecked
pre-v1 capabilities, artifact/platform/performance/UI gates remain open. SDK 0.8.0,
API 1 and app 2.0.0 stay unchanged; no release was made.


## Subsequent reviewed panel action verification

[Reviewed panel AI/caption/GIF actions](plugin-panel-reviewed-actions.md) now use
the same canonical command grants, native consent and review contracts. Captions
recheck final panel authorization and editor ownership; GIF publication rechecks
the exact live panel and issues only native, path-free artifact metadata. Native
export consent describes published files accurately. The fixed-source selected
regression passed 87 suites; the SDK-built fixture passed 41 app checks plus
7 after restart. SDK/renderer builds, structure and whitespace checks passed;
host captures were inspected. Evidence is retained in `reviewedPanelActions` in
[validation](plugin-validation.json).

The AI service is stubbed for deterministic payload/review/cancellation coverage;
actual workers, edits, GIF rendering/encoding and persistence are exercised.
Selected macOS/hidden-window checks do not certify native OS focus, real provider
accounts, packaged runtime or other platforms. Remaining media/destination jobs,
other pre-v1 scope and release/platform/performance/UI gates remain open.
SDK 0.8.0, API 1 and app 2.0.0 remain unchanged; no release was made.


## Subsequent picked media and upload verification

[Picked media and reviewed destination jobs](plugin-media-jobs.md) now add one
verified library import/fixed process result or a separately reviewed HTTPS PUT
of a native GIF. Native authorization, guarded Undo, managed-source lifetime,
private paths/credentials, digest-checked upload snapshots, public address pinning,
TLS, no redirects/retries and truthful post-publication cancellation receipts
are implemented. The final fixed-source selected regression passed 90 suites;
media checks passed 37, real local TLS transport checks passed 28, and
the SDK-built app fixture passed 30 checks plus 4 after restart. SDK/renderer
builds, localization, structure and whitespace passed. Host output was inspected;
evidence and earlier corrected failures remain in `mediaAndDestinationJobs` in
[validation](plugin-validation.json).

The app transport is stubbed; actual HTTPS is exercised separately against a local
fixture. This is not live-service/account, native OS focus, packaged-runtime,
other-platform, full-release-battery or long-running performance certification.
The first protocol is raw HTTPS PUT; provider-specific authentication/uploads,
stored credential profiles, background queues and generic processing/clip insertion
are not granted by this bounded contract. Remaining pre-v1 work and release gates
stay open. SDK 0.8.0, API 1 and app 2.0.0 remain unchanged; no release was made.


## Provider scope correction

Unspecified additional AI-provider wire formats are removed from the required
v1 scope at the maintainer's direction. The existing OpenAI-compatible provider
contract remains supported; new adapters need a concrete unsupported provider/use
case. This is a scope correction, not an implemented capability or a closed
release gate. Remaining SDK work and production verification still apply.


## Creative content extension packs

The [creative-pack contract](plugin-content-packs.md) adds bundled PCM WAV
sounds/music and WOFF2 fonts alongside existing effect/transition arrays. The SDK
ships a data-only content-pack starter, declared-asset copying, byte fingerprints
and public sound/font types. Audio uses the existing library controls and durable
copies; fonts use isolated families, retained exact versions, cache revocation
and strict missing-font checks in ordinary and offscreen export paths.

The frozen-source selected run reports **97 PASS / 2 FAIL of 99 suites**.
The failures require unavailable Windows system fonts and an external asset-pack
manifest, respectively; the logs remain in the evidence. All selected plugin,
SDK, export and built-renderer font suites pass. The new pack contract records
42 checks; real Electron records 23 first-process and 6 restart
checks, with 0 shown windows and no renderer exceptions. Native proof covers
installed sound preview/Add/Undo, font picker, multiple effects/transitions, MP4
audio/text, isolated GIF font rendering, upgrade/disable/removal and persistence.
Source hashes, captures, results and fixture limitations are retained under
`creativeContentPacks` in `plugin-validation.json`.

This closes the bounded creative-pack implementation item; it does not close the
remaining pre-v1, full-battery, Windows/Linux, installer or performance gates.
Other formats/asset kinds, marketplace services and cache cleanup remain separate
work. SDK 0.8.0, API 1 and application 2.0.0 are unchanged. No release was made.


## Creative extension expansion follow-up — 2026-11-16

All six [creator-facing additions](plugin-creative-expansion.md) are implemented:
text/caption styles, LUT/color looks, motion presets, the in-app pack creator,
project dependency recovery and MP3/OGG/TTF/OTF support. The final fixed candidate
has 103 PASS / 2 fixture FAIL across 105 selected suites, with 75 real Electron
acceptance checks and 179 new contract checks. The failures require unavailable
Windows font fixtures and the absent sibling asset-pack manifest. Renderer/SDK
builds, structure, localization, clean consumer types/templates and real-app
save/restart/export paths passed. Evidence lives in `plugin-validation.json` →
`creativeExpansion`; the linked requirement audit names each implementation path.

This closes the six-item implementation objective. It does not close REL-01,
Windows/Linux or installed-release/ASAR acceptance, native focus/accessibility,
live-service coverage, performance/soak budgets or the remaining explicitly
unchecked pre-v1 roadmap items. The selected regression is not the full discovered
battery. SDK 0.8.0, host API 1 and application 2.0.0 remain unchanged; no installer,
push, commit or publication was performed for this expansion.


## Plugin usability follow-up — 2026-11-16

The four [usability additions](plugin-usability-expansion.md) are implemented:
creative content browsing with combined search/tags/favorites and actual previews,
reviewed cross-version panel preference copying, watched isolated rendering author
previews and reviewed removal of unused replayable sound-preview cache files.
Adopted/legacy sound-media copies remain protected because saved projects can
reference them. No executable migration script, automatic credential/grant transfer
or saved temporary rendering dependency is introduced.

The final fixed candidate has 108 PASS / 2 unavailable-fixture FAIL across 110
selected suites from 314 discovered suites. It passed 59 native usability checks,
51 grouped new contract checks, the earlier creative-pack workflow, the existing
editor-space UI suite and clean SDK consumers. Renderer/SDK builds, structure and
localization checks passed. Source hashes stayed unchanged during the final run;
`plugin-validation.json` → `usabilityExpansion` retains manifests, logs, measured
pixels, captures and artifact hashes. The earlier failing candidate and integration
fixes are retained separately.

This closes these four implementation requirements and the rendering portion of
temporary authoring support. Temporary provider authoring, managed local adapters,
compatibility/distribution policy and all existing REL-01/platform/installed-release,
native-focus/accessibility, live-service and performance/soak gates remain open.
The selected regression is not the full discovered battery. SDK 0.8.0, host API 1
and app 2.0.0 are unchanged. No installer, commit, push or publication was performed.
