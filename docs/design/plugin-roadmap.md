# Plugin implementation roadmap

Architecture and public contract: [plugin system](plugin-system.md).

## Stage 0 — Contracts

- [x] Record architecture, versioning, permissions and UI design rules.
- [x] Define manifest v1 and data-only export-preset schema.
- [x] Supply an original example and validator/pack helper.
- [x] Link contributor documentation.

Gate: another developer can implement the first slice without deciding its architecture or product behavior.

## Stage 1 — Manager and export presets

- [x] Shared manifest validation, namespaced IDs, compatibility checks and fingerprints.
- [x] Bounded archive parsing without filesystem extraction; developer-folder snapshots.
- [x] Atomic installs/inventory, serialized mutations, retained versions, rollback and removal.
- [x] Host-owned inventory and narrow editor-frame-only preload operations.
- [x] Settings → Plugins, localized native controls, details, diagnostics and removal confirmation.
- [x] Existing export resolver integration with independent project snapshots.
- [x] Manifest/package/storage regression coverage and real-app smoke fixture.
- [x] Record final verification evidence below before considering the gate passed.

Gate: install → select → save/reopen → export succeeds in the real app, including export after package removal. Restarted service retains inventory. Built-in export quality behavior stays compatible. No executable plugins ship.

## Stage 2a — Declarative effects

- [x] Effect-only manifests, numeric parameter declarations and bounded shared expression parsing.
- [x] Fingerprinted IDs, clip-attached and timed Effects-track instances through the reducer.
- [x] Library thumbnails, inspector parameters, strength, regions and per-instance bypass.
- [x] Shared preview/export shader passes and hidden composition support.
- [x] Retained versions, explicit Undoable upgrades, invalid/missing dependency warnings and export enforcement.
- [x] Original Color pulse example, automatically loaded in dev.
- [x] Contract/lifecycle regression coverage and real-app render parity.

Gate: a library-installed effect supports inspector edits, Undo, save/reopen, preview/export matching and explicit missing-dependency resolution. Evidence is recorded below.

## Stage 2b — Declarative transitions

- [x] Define bounded two-input transition contributions and parameter controls.
- [x] Integrate transition library, timing, preview and export without changing existing IDs.
- [x] Reuse exact dependency tracking, upgrades and missing-plugin preflight.
- [x] Supply an original example and verify both endpoints plus sampled intermediate frames.
- [x] Exercise transformed/cropped/keyed inputs, short overlaps and GPU/context failures.

Gate: original transition preview and actual exports match within documented tolerances; progress zero/one preserve the input pictures; project round trips, Undo and missing dependencies retain the same protections as effects.

## Stage 3a — Sandboxed commands

- [x] Define the [command SDK and permission contract](plugin-commands.md).
- [x] Add bounded executable package entries with content integrity and unchanged data-only fingerprints.
- [x] Use a dedicated Worker in a sandboxed window, per-run session and isolated custom protocol origin.
- [x] Deny legacy privileged IPC for command senders; authenticate exact runtime/frame/token ownership.
- [x] Add per-run native permission approval, progress, watchdog, cancellation and revocation.
- [x] Expose limited project summaries and staged marker proposals only.
- [x] Commit validated results atomically through a stale-base reducer guard with one Undo step.
- [x] Ship Chapter markers with native controls, status and actual applied counts in Settings.
- [x] Verify adversarial cases in the real app, including blocked network/file imports and loop termination.

Gate: successful commands edit once; permission denial, invalid proposals, exceptions, cancellation, timeout, concurrent edits and package revocation leave the document unchanged. Installation and dev autoload never execute code. Evidence is recorded below.

## Stage 3b — AI workflows (chapters and translation implemented)

- [x] Define the fixed [caption-to-chapters service](plugin-ai-workflows.md), with caption/model grants.
- [x] Add explicit caption-sharing consent, captured host credentials/routing, job cancellation and bounded results.
- [x] Add reviewed caption-track creation, enum inputs and fixed translation service without exposing the reducer or full project.
- [x] Ship AI chapter markers with mandatory host review; verify edits, Undo and failure/cancellation recovery.

## Stage 3c — CraftAI plugin tools (prioritized before 3b)

- [x] Define discovery, provider-compatible schemas and supported runtime capabilities.
- [x] Route plugin tools through existing edit ownership, activity and completion checks.
- [x] Add permission/availability filtering and explicit policy for external MCP clients.
- [x] Verify tools cannot bypass command permissions or edit verification.

## Stage 4 — Providers and advanced exports

First slice: [bounded GIF export jobs](plugin-gif-export.md).

- [x] Define `export.gif` staging and separate it from editor/AI permissions.
- [x] Original GIF example with range, longest-edge size and frame-rate controls.
- [x] Host destination picker, exclusive publication, resource limits, progress and cancellation.
- [x] Trusted persistent preview rendering and complete file verification.
- [x] Settings, Export dialog and CraftAI artifact integration.
- [x] Record final real-app and regression evidence below before closing the first-slice gate.


- [x] Add the first declarative provider adapter through the existing OpenAI-compatible protocol ([contract](plugin-ai-providers.md)).
- [x] Exact-version destination consent, scoped encrypted credentials, model/vision metadata and host request isolation.
- [x] Settings/CraftAI integration and an original local provider example.
- [x] Record final first-slice verification evidence below.
- [ ] Expand provider protocols after their separate compatibility checks.
- [ ] Add host-owned export action jobs and explicitly permitted destination uploads.
- [ ] Keep output selection, overwrite rules, actual results, errors and cancellation in the host.

Gate: original provider and export-destination examples demonstrate correct tool behavior, scoped credentials, cancellation, failure recovery and no unexpected uploads. Finalize job/provider interfaces before implementation.

## SDK authoring foundation — prioritized after panels

- [x] Define the [SDK authoring contract](plugin-sdk.md) and support matrix.
- [x] Package browser-safe API 1 helpers, lifecycle cleanup and TypeScript declarations.
- [x] Bundle canonical validators into a self-contained Node authoring tool.
- [x] Scaffold panel, command, effect, transition, export-preset and AI-provider projects.
- [x] Add strict checks, standalone asset bundling, inspection and directory/archive validation.
- [x] Protect local build ownership and package validated snapshots without overwrite.
- [x] Add local watch diagnostics, recovery and immutable-version warnings.
- [x] Verify clean SDK installation, types, package parity and hidden real-app integration.
- [x] Add explicit command/panel developer sessions, same-version reload, optional build watching and bounded runtime logs ([contract](plugin-development.md)).
- [ ] Add temporary rendering/provider development workflows without saving ephemeral dependencies.
- [x] Add permission-gated [read-only editor context](plugin-editor-context.md), typed snapshots and panel events.
- [x] Add bounded [clip move/trim transactions](plugin-edit-transactions.md) with atomic Undo and native commit authorization.
- [x] Add [main-track reordering](plugin-main-reorder.md) with explicit gap/transition rules, separate permission and atomic Undo.
- [x] Add [main-track split/trim](plugin-main-ranges.md) with source continuity, explicit gaps, retained overlaps and atomic Undo.
- [x] Add [explicit linked picture/audio split and trim](plugin-linked-edits.md) with bounded opaque metadata and atomic Undo.
- [ ] Add ripple editing, shifted-pair edits and link creation/removal contracts.
- [x] Add [declarative Plugins/clip menu registrations](plugin-ui-actions.md) with host controls and scoped command invocation.
- [ ] Add toolbar and inspector registration contracts as separate surfaces.
- [ ] Publish/distribute a reviewed SDK release when explicitly requested.

## Stage 5 — Panels and managed local jobs

Custom panels were prioritized at the user's request; destination uploads and
additional provider protocols remain deferred Stage 4 work.

### Stage 5a — Custom panels

- [x] Define [panel package, SDK and lifetime contracts](plugin-panels.md).
- [x] Add fingerprinted HTML/CSS/JS assets while preserving legacy package identities.
- [x] Dock a separate sandboxed WebContentsView in Edit and Agent modes.
- [x] Add per-open summary consent, native identity chrome, bounded read-only SDK and theme events.
- [x] Add Tab/Escape focus return, resizing, modal masking and owner/project cleanup.
- [x] Deny legacy IPC, remote resources, devices, dialogs, navigation, workers and popups.
- [x] Add revocation/integrity checks, request limits, crash recovery and a heartbeat watchdog.
- [x] Ship the original Project dashboard example without startup execution.
- [x] Record final real-app, package and regression evidence below.
- [x] Add declared same-package marker actions with trusted clicks, per-run approval, progress, scoped cancellation and verified one-step Undo.
- [x] Add opt-in, version/panel-scoped JSON preferences with quotas, atomic writes, Settings reset and restart validation.

### Stage 5b — Managed local jobs

- [ ] Add host-approved local model/tool adapters with permissions, download and platform checks.
- [ ] Review native runtime isolation separately; do not introduce unrestricted shell access.

Gate: panel/runtime failure preserves the document; managed jobs enforce resource access, cancellation and platform availability. Define panel embedding and native-job contracts before implementation.

## Distribution project — Later

Marketplace discovery, publisher verification/signatures and automatic updates need a separate plan. Local packages/manual updates remain supported. Project opening never installs or executes plugin code.

## Verification

Before plugin changes, targeted baseline suites for project files, export estimates and real encoder quality passed. Full-suite counts were not remeasured; the repository's older recorded baselines are not claimed current. Preserve unrelated work and distinguish existing failures from plugin regressions. Windows/Linux runtime verification must be reported separately from macOS.

Commands:

```sh
node scripts/test.cjs plugins export-quality export-estimate project-file
npm run test:structure
node node_modules/vite/bin/vite.js build
```

The UI suite starts its own local Vite server and isolated Electron profile. It needs local socket and desktop permissions. It writes screenshots, the selected-project snapshot, encoded output and `result.json` in its reported temporary evidence directory. No installer is built. Add final outcomes here after reading those files.

### Stage 1 outcome

Stage 1 passed on macOS. [Evidence](plugin-validation.json) records 40 plugin contract/storage/security checks, passing targeted regression suites and both real Electron runs. The UI proof installs through Settings, saves through the project persistence service, quits Electron, restarts it, verifies retained inventory, removes the plugin, reopens the project and exports a fully decoded video from its saved preset settings. The resulting output is 720×406 at 24 fps. The Settings and Export screenshots were inspected. Renderer compilation, structure and whitespace checks passed. The full suite and Windows/Linux app checks were not run. No installer was built.

### Stage 2a outcome

Passed on macOS. [Evidence](plugin-validation.json) includes 21 real-app checks for library insertion, parameter editing, Undo, real project persistence, version retention and explicit upgrade, missing dependencies, instance bypass, clip/Effects-track export, hidden composition and injected uncached GPU-render failure. Preview/export comparisons at 0.25 s and 0.75 s measured mean absolute RGB errors of 1.900, 1.906 levels against a tolerance of 9. Existing built-in effect/transition parity and the export-preset lifecycle also passed. Targeted parser/catalog/range/project/plugin suites passed. The effect inspector screenshot was inspected. Full-battery and other-platform verification remain outstanding.

### Stage 2b outcome

Passed on macOS. [Evidence](plugin-validation.json) records 30 real-app checks, exact GPU endpoints and six intermediate preview/export samples. Mean absolute RGB error ranged from 2.554 to 5.249 levels (tolerance 12), including transformed/cropped/keyed inputs. The short-overlap fixture exported 0.375 s at 24 fps. Version retention, explicit upgrades, Undo, persistence, missing timeline markers, crossfade bypass, hidden composition and an injected uncached GPU failure passed. The transition inspector screenshot was inspected. Effect-plugin, export-preset and built-in rendering regressions also passed. Targeted unit suites, renderer compilation, structure and whitespace checks passed. Full-suite and Windows/Linux verification remain outstanding. No installer was built.

### Stage 3a outcome

Passed on macOS. [Evidence](plugin-validation.json) records 30 real-app checks covering actual command execution, native permission configuration, one-step Undo/Redo, duplicate handling, cancellation, concurrent edits, package revocation and tampered package diagnostics. Adversarial fixtures verified no Node/editor bridge, blocked network and local file fetch/import, staged-edit rollback, forged requests/results, request budgets and host termination of an infinite loop. Native dialog responses were supplied by the isolated test harness. The command controls and completion screenshot were inspected. Existing preset, effect and transition UI regressions and targeted unit suites passed. Renderer compilation, structure and whitespace checks passed. All example packages are enabled in the background dev profile; startup does not execute commands. Full-suite and Windows/Linux checks remain outstanding. No installer was built.

### Stage 3c outcome

Passed on macOS. Prioritized CraftAI command access before the AI-service slice at the user's request. [Evidence](plugin-validation.json) records 48 checks through the real CraftAI UI: command discovery/execution, fresh approval, actual markers, one-step Undo/Redo and completion verification for the Codex, Claude and OpenCode native paths, plus the API tool loop. Stop, concurrent manual edits, package disablement and late approval after cancellation preserve staged-edit rollback. Provider replies and native dialog choices were scripted fixtures; live model reasoning was not tested. The settled command activity screenshot was inspected. 30 manual command/security regression checks and 10 targeted unit suites passed. Renderer compilation, structure and whitespace checks passed. Dev remains running. Full-suite and Windows/Linux checks remain outstanding. External MCP clients and analysis subagents are excluded. Brokered AI services remain Stage 3b.

### Stage 3b first-slice outcome

Passed on macOS. [Evidence](plugin-validation.json) records 42 real-app checks for the AI chapter example in Settings and CraftAI, with caption-only input, explicit destination/text-sharing consent, captured routing, mandatory host review, precise marker titles/times and Undo/Redo. Missing/oversized captions, malformed replies, safe provider failures, refusal, Stop, timeout, concurrent edits, package disablement and late review/model results leave the edit protected. Provider text and native dialog answers were fixtures; paid/live model quality and physical OS dialog layout were not tested. The applied-command screenshot was inspected. Existing manual and agent command UI regressions passed, along with 16 targeted unit/AI-adapter suites. Compilation, structure and whitespace checks passed. The AI example is loaded in dev without execution. No installer was built or push performed. Full-suite/other-platform verification and broader Stage 3b edit/media capabilities remain outstanding.

### Stage 3b caption-translation outcome

Passed on macOS. [Evidence](plugin-validation.json) records 36 real-app checks covering native enum selection, selected source-track sharing, side-by-side host review with Discard initially focused, exact cue timing, unchanged original captions/word timings/locks, a named hidden new track, Undo/Redo, real project persistence and visible translated SRT export. Sharing/review refusal, forged or replayed review IDs, malformed model output, Stop, timeout, stale projects, package disablement and locked targets preserve the document. CraftAI passes the same review and its normal completion checks; saved captions reopen after package removal. Provider output and native sharing-dialog answers were fixtures; live language quality was not tested. The review screenshot was inspected. AI-chapter, CraftAI-command and manual-command UI regressions and 18 targeted unit suites passed, including layer/history, caption files and ownership. Automatic caption regeneration preserves translated tracks; hidden tracks do not demand visual reinspection until shown. Compilation, structure and whitespace checks passed. Full-suite/other-platform verification remains outstanding. No installer, commit or push was made.


### Stage 4a GIF export outcome

Passed on macOS. [Evidence](plugin-validation.json) records 23 real-app checks for the Export dialog and CraftAI, verified landscape and portrait output, original timeline sampling across a transition, caption composition, complete GIF decode, protected existing destinations, save-picker/render cancellation, package revocation, concurrent edits and an injected GPU failure. Four frame comparisons stayed below the recorded tolerance. A failed renderer produces no fallback artifact. Export creates no timeline edits or Undo entry. The completed Export dialog screenshot was inspected.

All 12 focused unit/regression suites passed, including the new recipe, publication-race, sandbox staging and frame-IPC checks. Existing manual command (30 checks) and effect (21 checks) real-app regressions passed. Renderer compilation, structure and whitespace checks passed. The GIF example is enabled in the running background dev profile. Native dialog choices and provider replies are fixtures; paid/live model reasoning, the full suite and other platforms remain untested. The bounded source-format and filesystem limitations are listed in the evidence and [job contract](plugin-gif-export.md). No installer, commit or push was made. Provider adapters and uploads remain later Stage 4 slices.


### Stage 4b provider first-slice outcome

Passed on macOS. [Evidence](plugin-validation.json) records 26 real-app checks plus 5 restart checks. A provider package appears in the native Assistant selector, uses a declared model dropdown, names its destination in a native approval prompt, stores a separate encrypted key and performs real Chat Completions tool calls through CraftAI. The fixture renames the project through the guarded reducer and preserves one-step Undo. Denial, Stop, revocation, redirects, safe error reporting, unavailable selections, package upgrades and orphan-key removal are covered. Reopening Electron preserves exact version selection and never silently substitutes a provider. The Settings screenshot was inspected.

All 12 focused suites passed, including 36 new schema/request-gate checks and built-in provider, thinking, vision, fallback and settings regressions. The existing AI chapter (42 checks) and GIF export (23 checks) real-app workflows also passed. Compilation, structure and whitespace checks passed. The local provider example is enabled in the background dev profile without any startup request. It needs Ollama and its declared model to be installed separately. Native choices and model replies use isolated fixtures; paid/live provider compatibility, the full suite and other platforms remain untested. Additional protocols, custom headers and token-level streaming remain outside this slice. No installer, commit or push was made.


### Stage 5a custom-panel first-slice outcome

Passed on macOS. [Evidence](plugin-validation.json) records 34 real-app checks for isolated native panels in Edit and Agent modes. The original Project dashboard renders its own HTML/CSS/JS, reads only the approved live summary, follows semantic theme changes, preserves session-only notes until closed and returns keyboard focus through Tab/Shift-Tab/Escape. The native view follows its dock and hides behind editor dialogs. Denial, project replacement, package revocation/tampering, request abuse, renderer crashes and a real infinite loop preserve the project and Undo; the stuck renderer is terminated while the editor remains responsive. Network, files, imports, workers, popups, parent/editor access and legacy IPC are blocked. Native approval choices are fixtures; panel execution and native view behavior are real.

All 10 focused suites passed, including 32 new package/schema checks and 13 runtime authentication/lifecycle checks. Existing command (30 checks) and provider (26 checks plus restart) UI regressions passed. The package suite's unknown-contribution fixture now uses `widgets`, because `panels` is a supported contribution. Native panel content and host chrome screenshots were inspected separately because BrowserWindow capture omits the child view on macOS. Compilation, structure and whitespace checks passed. The example is enabled in the running background dev profile and does not open at startup. The first SDK is read-only; approved commands, scoped storage and managed local jobs remain later slices. Full-battery, packaged-runtime and other-platform checks remain outstanding. No installer, commit or push was made.


### Stage 5a approved-panel-action outcome

Passed on macOS. [Evidence](plugin-validation.json) records 26 real-app checks. Project dashboard 1.1.0 adds chapter markers through its declared same-package command, with a trusted click, fresh native approval, bounded progress and scoped Cancel. The host verifies the actual marker count after commit, and one Undo/Redo handles the complete edit. Duplicate runs add no history entry. Automatic/synthetic calls, undeclared commands, malformed input, concurrent manual edits, agent ownership and user gestures cannot mutate the project. Stop, panel closure, project replacement, package revocation and late approval preserve staged-edit rollback. Closing an idle panel does not cancel an unrelated manual command; Settings lifecycle does not cancel panel work.

All 14 focused plugin suites and 2 localization suites passed. Existing panel (34 checks), manual-command (30), caption-translation (36) and GIF-export (23) real-app regressions passed. Native host/child screenshots were inspected separately. Compilation, structure and whitespace checks passed. The updated example is enabled in the existing background dev profile. Native consent answers are fixtures; the trusted input, panel, worker and project history are real. This slice supports marker commands; panel AI/caption/export actions, scoped persistent storage and managed local jobs remain later work. Full-battery, packaged-runtime and other-platform checks remain outstanding. No installer, commit or push was made.


### Stage 5a persistent-panel-storage outcome

Passed on macOS. [Evidence](plugin-validation.json) records 31 real-app storage checks across an initial run and a real Electron restart. The dashboard explicitly saves and reloads its note and chapter count. Per-open approval names storage access; namespaces are isolated by immutable package fingerprint and panel ID, with bounded JSON, quotas, serialized atomic writes and lifetime/integrity checks. Disablement retains data while revoking access; upgrades begin empty; removal deletes the version's data. Settings confirms and clears the selected version's saved preferences without changing project history. Quota failures retain the prior record, and undeclared storage requests fail closed.

All 8 focused plugin/localization suites passed, including 45 storage checks for JSON validation, quotas, cross-namespace isolation, symlink defense, malformed data, revocation, staged-write cancellation, manager cleanup and serialization. Existing panels (33), approved actions (27) and manual commands (30) passed in quiet Electron runs. Storage test windows shown: 0. Compilation, structure and whitespace checks passed. Native Tab/Shift-Tab host-focus assertions were explicitly skipped in quiet mode; hidden native child capture returned UnknownVizError, so no foreground capture or new child visual-inspection claim was made. Functional UI/IPC/worker/native bounds checks are real; native approval choices are fixtures. The dev watcher was suspended during edits, then resumed once after testing. Full-suite, packaged-runtime and other-platform verification remain outstanding. No installer, commit or push was made.


### Public SDK and authoring foundation outcome

Passed on macOS. [Evidence](plugin-validation.json) records 30 runtime/helper checks, 35 clean-distribution and authoring checks, and 12 real-app SDK checks. The local @clipcraft/plugin-sdk 0.1.0 package provides API 1 declarations, manifest/command helpers, a permission-aware panel client, stable local errors and scoped lifecycle cleanup. Its CLI scaffolds six extension surfaces, checks TypeScript entry points, bundles fixed standalone assets, validates directories/archives with canonical host rules, inspects permissions and packages validated bytes without overwriting. Workspace ownership and a build lock protect output. Watch recovers from errors and warns about version reuse without installing or opening anything.

A clean npm tarball install verified public imports/types and all six templates. Existing shipped examples match host fingerprints and public manifest types. Negative fixtures cover malformed contracts, unknown flags, dynamic imports, missing exports, invalid types, compatibility, output modification, overwrite and concurrent build refusal. The generated archive installed through real Settings; its bundled SDK connected inside an isolated panel, preserved trusted-click/native approval, dispatched the worker command, returned the verified count, disposed and reopened. SDK progress is scoped to the client's pending action so late events cannot replace its settled result. Test windows shown: 0. All 7 focused runtime/package/lifecycle regressions passed. SDK build, structure, whitespace and dependency-lock verification passed. This adds no new host capability or scenario feature. The existing dev editor was not restarted for this work. Live developer sessions/reload, runtime logs, richer contracts and publication remain later work. No installer, publication, commit or push was made. Full-battery, packaged-runtime and other-platform verification remain outstanding.


### Editor developer-session outcome

Passed on macOS. [Evidence](plugin-validation.json) records 30 hidden real-app checks across a normal run and a fresh process. Settings provides explicit command/panel sessions, same-version snapshot reload, optional compiled-build watching, End, bounded logs and Clear logs. New generations have separate runtime keys; source edits cannot mutate captured bytes. Reload revokes only that session's pending work, closes its panel and requires fresh approval before execution. Queued manual results require a single-use current-generation authorization before commit. Installed inventory, activation, packages and production preferences stay unchanged. Temporary preferences survive session reload and are removed on End/disposal.

The actual SDK-built harness verified worker and panel console records, native development consent, one Undo commit, logged panel exceptions and explicit recovery, invalid output, stale keys, pending approval/staged cancellation, unrelated installed execution, atomic dist replacement, clear/end and restart isolation. Window show events: 0. The Settings screenshot was inspected from a hidden capture. All 10 focused suites passed, including 29 session/storage/watch/log/commit checks and command log-token/management-IPC assertions. Existing panel (35), manual-command (30) and public-SDK (12) real-app regressions passed. Compilation, structure and whitespace checks passed. Native filesystem events have a bounded fingerprint-poll fallback. Native dialog answers are fixtures; there was no foreground test fallback. The dev auto-reloader was paused during Electron edits and will be resumed once. Rendering/provider developer sessions, broader host APIs and distribution remain separate work. Full-battery, packaged-runtime and other-platform verification remain outstanding. No installer, publication, commit or push was made.


### Read-only editor context outcome

Passed on macOS. SDK 0.2.0 adds `editor.read()` for commands and panels, plus
`editor.onChanged()` for panels, while retaining manifest API 1. Explicit
`editor.read` consent grants selection, playhead and bounded timeline metadata.
Snapshots expose document-scoped handles, revisions, safe timing/layer flags and
explicit totals; they omit internal IDs, names, media paths/bytes, text and
provider data. Selected clips take priority within limits of 256 clips, 128 tracks
and 64 selected handles. Panel updates coalesce to 10 Hz and reuse cached timeline
projection. Commands capture context before approval, including CraftAI's separate
command path. Existing project summaries and marker-write restrictions remain.

[Evidence](plugin-validation.json) records 22 new hidden real-app checks with zero
windows shown: actual selection, seek/playback, timing metadata, timeline edits,
Undo, frozen worker context during consent, unsubscribe, close/reopen, same-project
replacement, explicit consent, separate panel/command grants and native denial.
All 10 focused contract suites passed, including clean SDK distribution/type checks
and CraftAI forwarding. Existing SDK (12), panel actions (27) and development
session integration regressions passed. Compilation, structure and whitespace
checks passed. Native approvals use scripted fixtures; no visual-layout claim is
made for this API-only stage. Full battery, other platforms and packaged runtime
remain unverified. No installer, SDK publication, commit or push was made.


### Atomic clip edit transaction outcome

SDK 0.3.0 adds command `editor.stage()` under `clips.write` plus `editor.read`,
retaining API 1. One batch of at most 64 typed operations can move or shorten
overlay, audio, text and effect clips on their existing tracks. Native staging
validates the frozen context, then the host validates private target bindings,
full-project placement, source ranges and locks. Linked clips, main-track edits,
new overlaps, source extension, ripple and mixed marker/caption/AI/export writes
remain outside this slice. Ordered operations compose; final-state validation
permits swaps. Trims preserve speed-scaled source windows, fade envelopes and
measured word timing. Nothing applies until successful completion and a fresh,
single-use native commit authorization. A failed operation rejects every edit.

[Evidence](plugin-validation.json) records 25 hidden real-app transaction checks
with zero windows shown. Settings, panel actions and CraftAI use the real typed
SDK worker and the same prepared reducer batch, actual changed counts and one
Undo step. Validation covers refusal, Stop, stale projects, scope, locks, linked
clips, collisions, worker failure, panel close and package disable. Preflight
planning is side-effect free; commit acknowledgements come from actual history
state rather than speculative reducer execution. SDK declarations reject invented
operations, mutated read-only snapshots and direct panel writes. All 22 distinct
focused SDK/plugin/history/layer/project suites and six hidden plugin integration
suites passed. Compilation, structure and whitespace checks passed. An additional
broader selection passed nine suites and failed two unrelated caption environment
checks: sandbox access to a Whisper log and a Windows-only APPDATA dependency.
No full-battery, other-platform or packaged-runtime claim is made. No installer,
SDK publication, commit or push was made.


### Declarative plugin UI actions outcome

SDK 0.4.0 adds optional same-package command registrations in the Plugins menu
and clip context menu, retaining API 1. Validated labels, fixed host icons and
selection/lane predicates create no extra execution permission. Host controls own
parameter entry, busy/locked/unsupported states, native approval, progress and
actual results. Zero-parameter actions start from their menu click. The existing
command runner provides scoped cancellation, single-use edit authorization and
Undo. Registrations are versioned, bounded, removed on disable/removal/reload and
marked during development. Reload preserves unrelated installed action runs.
The command scaffold registers its starter action; chapter-markers 1.1.0 exposes
its existing command in the dev menu without adding a scenario feature.

[Evidence](plugin-validation.json) records 46 hidden real-app checks and zero
windows shown. It covers parameter/default/enum entry, selection and multi-select,
real worker execution and Undo/Redo, errors/refusal/Stop, stale contexts, package
cleanup, developer generations and native-view masking. Long submenus remain in
the viewport and accept wheel input without closing. Header menus are portaled
outside the layout container. Host screenshots were inspected. All
14 distinct focused contract/SDK/type/menu suites and 6 existing hidden plugin
integration suites passed. A developer-test loading race was fixed by waiting
for log content; it was not a production runtime failure. Compilation, structure
and whitespace checks passed. Keyboard tests synthesize DOM events, including
focusout suppressed during quiet programmatic blur. Native OS focus and permission
answers were not manually tested; approvals are fixtures, with no foreground
fallback. AI/GIF-specific use through the new menus, full-battery, packaged-runtime
and other-platform verification remain outstanding. No installer, SDK publication,
commit or push was made.


### Main-track reorder outcome

SDK 0.5.0 adds `timeline.reorder` plus `editor.read`, keeping API 1. An ordered
`reorder` operation names an opaque main clip and a destination handle or append.
Gaps are preserved verbatim and transition handling must explicitly reject changed
boundaries or clear their incoming records. Private host planning validates all
affected clips, including omissions, against locks, linked partners, motion-pin
dependencies and the 64-clip limit. Mixed free/main transactions share the native
single-use commit, immutable reducer receipt and one-step Undo path. Safe optional
sequence index/transition/overlap metadata supports bounded author snapshots.

[Evidence](plugin-validation.json) records 40 reorder contract checks, 19 native
staging checks, 36 SDK authoring checks, 21 focused suites and 32 hidden real-app
checks. Settings, menu, panel and CraftAI execute the actual SDK worker; preview
and export confirm the new first source. Existing free editing and UI actions
passed hidden regressions. Window show events: 0. Compilation, structure and
whitespace passed. Native consent answers are fixtures; full-battery, packaged
runtime and other-platform checks remain outstanding. Main split/trim, ripple
and linked-partner editing remain separate stages. No installer, publication,
commit or push was made.


### Main-track split and trim outcome

SDK 0.6.0 adds the separate `timeline.edit` permission, requiring `editor.read`.
`split` creates a source-continuous right piece with a private host ID;
`trim-main` crops a source window and fills removed time beyond overlap with
explicit gaps. Both preserve the timeline clock, existing gaps, free-track
timing and markers. Speed, source-time keyframes and fade continuity are retained;
entry/exit animations stay on surviving exterior edges. Explicit policies reject
transition boundaries or preserve retained overlap without moving neighbors.
The host checks all clips, dependencies and new IDs before one native-authorized
atomic batch. Old permissions cannot acquire range-edit access.

Validation outcome on macOS: 49 range contract checks and
23 native staging/permission checks passed. The typed SDK-built package
passed 39 hidden real-app checks through Settings, the Plugins menu, a panel
and CraftAI. These cover ordered split/trim, mixed free edits, explicit overlap
handling, gaps, locks, links, refusal, stale edits, Stop, revocation and one-step
Undo/Redo. Preview and export agree on retained source footage, internal trim
gaps and a trailing black interval. The trailing-gap export retained exactly
12.75 seconds. Window show events: 0.

All 20 focused plugin/state suites passed; clean SDK distribution and authoring
passed 36 checks. Existing main reorder and free-edit hidden regressions passed
32 and 25 checks, also with no shown windows. Renderer compilation, structure
and whitespace checks passed. Native consent answers are scripted fixtures.
Full-battery, packaged-runtime and other-platform checks remain outstanding.
[Retained evidence](plugin-validation.json) includes results and paths.
No installer, publication, commit or push was made.


### Explicit linked picture/audio transactions outcome

SDK 0.7.0 adds `clips.linked` with bounded opaque link metadata and explicit
`split-linked` / `trim-linked` operations. Both handles identify one aligned
main/overlay picture plus audio pair. Private planning validates full membership,
source/time offsets, locks, source bounds, dependencies and final placement.
Right halves receive new host-owned IDs and a new link. Existing grants keep
rejecting implicit linked writes. Exact shared source arithmetic, complete
prepared clip arrays, native single-use authorization and immutable receipts
retain synchronization and one-step Undo across Settings, menus, panels and
CraftAI. Ripple, shifted-pair edits, link/unlink and linked reorder remain future
contracts.

Validation outcome on macOS: 57 linked contract checks and
26 native staging/permission checks passed, plus all 21 focused plugin/state
suites. Clean SDK distribution, public types and authoring passed 36 checks.
The SDK-built package passed 44 hidden real-app checks through Settings, menus,
a panel and CraftAI, including actual main/overlay pair operations, one-step
Undo/Redo, mixed batches, gaps, overlap, missing/locked partners, refusal, stale
edits, Stop and revocation. Window show events: 0.

Preview and export agree on retained picture slices and black trim intervals.
Exported audio RMS was 0.124945 / 0.124940 in retained slices
(minimum .01) and 0.000000 / 0.000000 in internal/trailing gaps
(maximum .002). The trailing-gap export retained 12.75 seconds with audio.

Existing main-range, free-edit and UI-action hidden regressions passed
39, 25 and 46 checks respectively, all with no shown windows. Compilation,
structure and whitespace passed. Native consent answers are scripted; the test's
document comparison ignores only derived `media.wave` updates. Full-battery,
packaged-runtime and other-platform checks remain outstanding.
[Retained evidence](plugin-validation.json) includes results and paths.
No installer, publication, commit or push was made.
