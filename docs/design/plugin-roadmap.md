# Plugin implementation roadmap

Architecture and public contract: [plugin system](plugin-system.md).

The current executable model is the [general Node host](plugin-extension-host.md).
Historical completed recipe stages below record earlier implementation work;
their public runtime/SDK declarations have now been
[retired](plugin-legacy-retirement.md). Creative packs and validated private
editing contracts remain supported. Current regression/release gates remain open.

## Current pre-v1 scope

The maintainer's current direction is to finish the missing SDK capabilities
before v1, without incrementing the SDK or application versions during this work.
Keep SDK 0.8.0, host API 1 and application 2.0.0. Earlier stage text saying
"later" or "deferred" records the original sequence; it does not move the
following requirements outside v1. Production release remains blocked on the
[release gates](plugin-release-readiness.md) as well as the unfinished scope.

- [x] Extend linked split/trim to consistent shifted picture/audio pairs.
- [x] Add explicit linked reordering with per-operation companion allowlists.
- [x] Add [bounded ripple removal](plugin-ripple.md) with explicit affected-clip/pair scope and gap rules.
- [x] Add [bounded clip creation/deletion/duplication, track creation and
  cross-layer placement](plugin-lifecycle.md) contracts.
- [x] Add [bounded static text/style, picture transform/opacity, volume/mute and
  edge-fade editing](plugin-properties.md).
- [x] Add [bounded fixed-duration speed, source-time curves and effect-slot
  editing](plugin-automation.md).
- [x] Add [native toolbar and scoped inspector extension contracts](plugin-native-controls.md).
- [x] Add [host-reviewed panel AI, caption and GIF actions](plugin-panel-reviewed-actions.md).
- [x] Add [picked media import/processing and reviewed host destination/upload jobs](plugin-media-jobs.md).
- [x] Add and verify [creative sound, font, effect and transition packs](plugin-content-packs.md) as installable extensions.
- [x] Finish all six [creator-facing pack additions](plugin-creative-expansion.md): titles/captions, LUT/color, motion, in-app creation, project recovery and more formats.
- [x] Add [permissioned managed local speech tools/models](plugin-local-tools.md) with platform checks.
- [x] Add [isolated live rendering author previews](plugin-usability-expansion.md) without saved ephemeral dependencies.
- [x] Add [temporary provider/export-preset author tests](plugin-development.md) without saved ephemeral dependencies.
- [x] Add [reviewed panel-preference copying across package versions](plugin-usability-expansion.md).
- [x] Add [creative pack search, tags, favorites and actual previews](plugin-usability-expansion.md).
- [x] Add [reviewed unused preview-cache cleanup](plugin-usability-expansion.md) that protects project-owned media.
- [x] Add [versioned feature discovery, typed service contracts, project configuration and local debugger attach](plugin-sdk-general-contracts.md).
- [ ] Finalize capability/version support, reconcile author documentation and
  verify the complete supported SDK against the release/platform matrix.

Current compatibility, retained-data and author migration rules are documented
in [SDK compatibility](plugin-sdk-compatibility.md). Discovery/lifecycle hardening
and reproducible local fixtures are recorded in
[stabilization](plugin-extension-stabilization.md). The combined release item
above stays open until the supported installed/platform matrix is complete.

The [SDK validation command and CI workflow](plugin-sdk-validation.md) now provide
repeatable development checks and candidate checksums. The remote six-job matrix
and the installed-app acceptance on four platforms passed on 2026-11-18
([remote acceptance](plugin-remote-acceptance.md)). Performance budgets, manual
acceptance, signing and a release run keep the combined item above open.

Additional AI-provider wire formats are optional expansion, not a v1 requirement.
Only add one for a named provider/use case that the current OpenAI-compatible
provider contract cannot support; no unspecified adapter work blocks v1.

Each required item needs its own bounded contract, implementation and retained verification.
No checkbox authorizes arbitrary reducer patches, direct shell/filesystem access,
installation-time execution, SDK publication or a public release.

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
Additional provider wire formats require a concrete use case and separate
compatibility checks; they are optional and do not block v1.
- [x] Add [bounded GIF destination jobs and explicitly reviewed HTTPS PUT uploads](plugin-media-jobs.md).
- [x] Keep output selection, local overwrite protection, actual results, upload uncertainty and cancellation in the host.

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
- [x] Add isolated live rendering development previews without saving ephemeral dependencies.
- [x] Add temporary provider/export-preset development tests without saving ephemeral dependencies.
- [x] Add permission-gated [read-only editor context](plugin-editor-context.md), typed snapshots and panel events.
- [x] Add bounded [clip move/trim transactions](plugin-edit-transactions.md) with atomic Undo and native commit authorization.
- [x] Add [main-track reordering](plugin-main-reorder.md) with explicit gap/transition rules, separate permission and atomic Undo.
- [x] Add [main-track split/trim](plugin-main-ranges.md) with source continuity, explicit gaps, retained overlaps and atomic Undo.
- [x] Add [explicit linked picture/audio split and trim](plugin-linked-edits.md) with bounded opaque metadata and atomic Undo.
- [x] Add [link creation/removal and explicit pair movement](plugin-link-management.md), including stored audio offsets and non-ripple main-gap placement.
- [x] Extend linked split/trim to shifted pairs using picture-relative ranges,
  stored audio offsets and private complete-pair plans, without a version bump.
- [x] Add [explicit linked reordering](plugin-linked-reorder.md) with combined grants,
  bounded companion declarations, source/offset preservation and atomic Undo.
- [x] Add [bounded ripple interval removal](plugin-ripple.md) with a separate grant and explicit scope.
- [x] Add [declarative Plugins/clip menu registrations](plugin-ui-actions.md) with host controls and scoped command invocation.
- [x] Add [native toolbar and inspector registration contracts](plugin-native-controls.md) as separate surfaces.
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

- [x] Add host-approved local speech adapters with permissions, pinned model download/import and platform checks.
- [x] Review native runtime isolation separately; approved host tools run fixed recipes, with no plugin shell access.

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


### Explicit link management and pair movement outcome

SDK 0.8.0 adds `clips.links`, separately from the existing aligned split/trim
grant. Commands can link two explicit unlinked picture/audio handles, unlink
one complete pair or move both members while retaining their source windows and
stored audio offset. Overlay moves remain on their original layers; main moves
use explicit empty gaps, leave gaps behind and preserve the main clock. Source
and destination transition boundaries, collisions, locks, incomplete groups,
source bounds and motion-pin dependencies reject the atomic batch. Consumed
gaps count toward the existing affected-clip limit. Native approval, single-use
commit authorization, owner/stale guards, receipts and one-step Undo remain in
force. Private complete-pair plans preserve exact fractional source windows
without allowing generic link synchronization to introduce floating-point drift.

Validation on macOS: 82 link-management contract checks,
37 native staging/authorization checks and all
25 focused plugin/state/export suites passed. Clean SDK
installation, public types, canonical packaging parity and authoring passed
39 checks. The SDK-generated package passed 39 hidden real-app
checks through Settings, menus, panels and CraftAI, including link/unlink,
ordered transactions, shifted main/overlay movement, Undo/Redo, native project
persistence, permission refusal, stale edits, Stop and revocation.

Preview and actual export agree on the moved blue picture and vacated black
time. Exported sound retains the stored offset and is silent both in vacated
time and before its shifted start. The original main duration is retained.
Existing free-edit, linked split/trim and UI-action hidden regressions passed
25, 44, 46 checks respectively. No test windows were shown. Renderer compilation,
structure and whitespace checks passed. [Retained evidence](plugin-validation.json)
contains measured results and artifact paths. Native approvals are scripted;
document comparisons ignore only derived waveform updates. Full-battery,
packaged runtime, physical OS focus and Windows/Linux remain unverified.
Ripple, shifted-pair split/trim and linked reorder remain future work.
No installer, SDK publication, commit or push was made.

### Shifted-pair split and trim pre-v1 outcome

The existing `clips.linked` split/trim operations now accept consistent positive
and negative stored audio offsets. Public times always refer to the picture,
including audio-initiated calls. Each source is cropped at the same relative
position; main gaps, unrelated clips/markers and the original timeline clock
remain fixed. Complete private plans retain stored source/timeline offsets and
reject inconsistent pairs, source violations, locks and unsupported topology.

SDK 0.8.0, API 1 and application 2.0.0 remain unchanged. Verification: 91 contract
checks, 49 native checks, 39 SDK checks and all 60 selected suites passed.
The SDK-built package passed 62 hidden real-app checks, including Settings,
menus, panels, CraftAI and actual picture/audio exports for both offset signs.
Moving-media mixed transactions passed 18 checks plus 12 after a real restart.
Renderer build, structure and whitespace checks passed. Details and limitations:
[linked contract](plugin-linked-edits.md#shifted-pair-pre-v1-verification) and
`shiftedLinkedEdits` in [validation](plugin-validation.json).

All remaining items in the current pre-v1 checklist must still be completed
before SDK 1.0. No installer, SDK publication, commit, push or version bump occurred.

### Explicit linked reorder pre-v1 outcome

`reorder-linked` requires both existing `timeline.reorder` and `clips.links` grants.
The source and every affected linked main neighbour must be explicit complete
pairs; a per-operation companion allowlist cannot grant future implicit edits.
Named sound follows its picture with exact source windows and stored offsets.
Gap identities and unrelated free-track/marker times stay fixed. Transition
rejection/clearing, resulting-clock limits, collisions, locks, motion pins and
the shared operation/affected-clip budgets remain guarded. Ordinary reordering
retains its linked-target restrictions and valid legacy atomic permutations.

The strengthened new suite passed 71 checks including 324 independent-oracle
cases, with three final focused cases for shared audio layers and mixed Undo.
All 61 selected plugin/project/history suites passed. The expanded SDK-built
reorder fixture passed 61 hidden real-app checks plus 11 after a real process
restart, covering Settings, menus, panels, CraftAI, native persistence, moving
picture parity and distinct exported source/companion tones. SDK/renderer builds,
structure and whitespace checks passed. Detailed evidence and limitations:
[linked reorder contract](plugin-linked-reorder.md#verification-outcome) and
`linkedReorder` in [validation](plugin-validation.json).

SDK 0.8.0, host API 1 and application 2.0.0 remain unchanged; package and lock
version files were unchanged. One standalone suite was added, bringing discovery
to 287 suites; this was selected verification, not a new full-battery release pass.
Ripple is the next outstanding editing capability. The remaining pre-v1 checklist
and release/platform gates must still be completed before SDK 1.0. No installer,
SDK publication, version increment, commit or push was made.


### Bounded ripple removal pre-v1 outcome

`timeline.ripple` now stages one `ripple-remove` interval. All affected linked
main pairs must be explicitly named; `clips.links` covers named pairs and
`clips.write` covers named unlinked free clips. Unlisted free tracks and markers
stay at absolute time. Retained gap pieces, source slices and shifted pair
offsets are preserved. Existing transition boundaries must survive unchanged;
collisions, locks, pins, source bounds and the 64-affected-record limit reject
atomically. Main gaps are supported menu targets only with the new permission.

The standalone contract suite passed 102 checks, including 600 independent-oracle
cuts. All 66 selected plugin/project/history/agent/i18n suites passed; the native
edit runtime suite passed 64 checks. The SDK-built fixture passed 34 hidden
real-app checks plus 11 in a fresh process, including Settings, menus, panels,
CraftAI, exact Undo/Redo, save/reopen and moving-picture/tone exports. SDK and
renderer builds, structure and whitespace checks passed. Evidence and limits:
[ripple contract](plugin-ripple.md#verification-outcome) and `rippleEditing` in
[validation](plugin-validation.json).

SDK 0.8.0, API 1 and application 2.0.0 stay unchanged; all package/lock version
files are byte-for-byte unchanged from the start of this work. Two standalone
suite files bring discovery to 289; the 66-suite run is selected regression
coverage, not a new full-battery release pass. Earlier ripple deferrals above
are historical. Clip creation/deletion/duplication and track/layer placement
are the next missing editing contracts. The remaining pre-v1 scope and
release/platform gates still block v1. No installer, publication, commit or push
was made.


### Bounded clip lifecycle and track placement pre-v1 outcome

`clips.manage` now authorizes explicit creation, duplication and deletion, with
`tracks.write` for appending layers and placing clips. Linked variants also need
`clips.links` and both returned handles. New media uses returned source windows;
text uses bounded plain content and effects reuse existing references. Main edits
consume or leave explicit gap time. Existing clock, markers, source offsets,
track states and unlisted clips stay fixed. No implicit relayering or ripple is
granted. Track-only changes produce actual track receipts and one Undo step.

The fixed-candidate selected run passed 71 suites. The contract suite
passed 59 checks including 108 independent source/placement oracle cases; native
runtime passed 75 checks, and panel receipt validation passed 31. The SDK-built
fixture passed 37 hidden real-app checks plus 11 in a fresh process, including
Settings, menus, panels, CraftAI, track-only receipts, save/reopen and actual
picture/tone exports. SDK/renderer builds, structure and whitespace passed.
Evidence: [lifecycle contract](plugin-lifecycle.md) and `clipLifecycle` in
[validation](plugin-validation.json). The earlier selected run's dev-reload
interruption and fixture corrections are retained with the final results.

Two new standalone suites bring discovery to 291. This is selected macOS
regression coverage, not a full-battery release pass. SDK 0.8.0, host API 1 and
application 2.0.0 stay unchanged; all package/lock version files are byte-for-byte
unchanged. Earlier lifecycle deferrals above are historical. Bounded text,
transform, speed, volume, keyframe and effect property edits are next. Remaining
pre-v1 scope and release/platform gates still block v1. No installer, publication,
commit or push was made.


### Static clip property pre-v1 outcome

`clips.properties` now stages typed text/style, picture transforms/opacity and
volume/mute/fade writes. Linked targets also require `clips.links` and both
handles, with both locks and whole private group checks. Caption wording has an
explicit measured-word policy; static writes cannot silently replace curves.
Only requested fade offsets reset. Defaults/no-ops, pins, private tokens and
actual changed-record receipts remain guarded before one Undo step.

The fixed-source selected run passed 78 suites. Contract checks passed
43 cases including 240 independent audio/geometry oracle combinations; native
runtime passed 86 checks. The SDK-built real-app fixture passed 36 checks plus
13 after restart, covering Settings, menus, panels, CraftAI, exact Undo,
measured caption invalidation, actual preview pixels and rendered text/geometry/
volume/fades/mute. SDK/renderer builds and structure/whitespace checks passed.
Evidence: [property contract](plugin-properties.md) and `staticProperties` in
[validation](plugin-validation.json).

Real export acceptance reproduced an existing free-audio mute bug: the muted
clip still sounded in export. Shared projection and both raw export mixers now
omit it; measured video and audio-only regressions retain an audible control
tone. Screenshot comparisons convert the native Display P3 profile to sRGB;
no pixel or audio threshold was relaxed.

The former combined property checklist item is split to retain unfinished speed,
keyframe and effect work. Two new standalone suites bring discovery to
293. SDK 0.8.0, host API 1 and application 2.0.0 remain unchanged, with
all package/lock version files byte-for-byte unchanged. Remaining pre-v1 and
release/platform gates still block v1; no installer, publication, commit or push
was made.


### Bounded source automation pre-v1 outcome

Separate `clips.retime`, `clips.automation` and `clips.effects` grants now
authorize fixed-duration speed, source-time picture/volume curves and existing
effect-resource attachment, slot order, removal, strength and validated plugin
parameters. Linked targets require both handles and `clips.links`; speed updates
both source windows while keeping timeline/source offsets and duration fixed.
Effects require exact dependencies and a private catalog-revision commit guard.
Old static/lifecycle grants retain their prior restrictions.

The fixed-source selected regression passed 83 suites. The new contract
suite passed 55 checks including 135 independent source-window/interpolation
combinations; native runtime passed 119 checks. The SDK-built real-app fixture
passed 38 checks plus 12 after a real process restart, including Settings,
menus, panels, CraftAI, exact Undo/Redo, catalog/command revocation and actual
source-frame, opacity/motion, tone/volume and parameterized-effect exports. The
command stays disabled on restart while its separate rendering dependency stays
enabled. SDK/renderer builds and structure/whitespace checks passed. Evidence:
[contract](plugin-automation.md) and `sourceAutomation` in
[validation](plugin-validation.json).

Two standalone suites bring discovery to 295. This remains selected macOS
coverage, not a new full-battery release pass. SDK 0.8.0, host API 1 and app
2.0.0 remain unchanged; package/lock version files are byte-for-byte unchanged.
Toolbar and inspector extension contracts are next. Other unchecked pre-v1
capabilities and release/platform gates still block v1. No installer, publication,
commit or push was made.


### Native toolbar and inspector pre-v1 outcome

The shared declarative action catalog now supports toolbar buttons/overflow and
host-rendered inspector command drafts. Inspector scope is explicit; selection,
project and load changes discard drafts. Apply captures exact inputs, uses fresh
native consent, and retains normal validation, staged execution and one Undo.
Strict boolean parameters join numeric/enum fields in Settings, dialogs and the
inspector; CraftAI accepts exact typed toggle pairs. Inspector closure cancels
only its own unfinished action, preserving toolbar/menu ownership.

The final fixed-source selected regression passed 85 suites with no failures.
The new contract suite passed 31 checks; the SDK-built Electron fixture
passed 27 checks and 6 after a fresh process restart. Coverage includes native
input dispatch, actual receipts, Undo, consent refusal, locks, selection/load
cancellation, inspector/toolbar ownership, disable/re-enable/removal, narrow
menu reachability, saved values and reset defaults. SDK/renderer builds and
structure/whitespace checks passed; the captured native surface was inspected.
The shared field refactor preserves existing numeric accessibility labels, and
existing GIF/translation/UI regressions passed. Evidence: [contract](plugin-native-controls.md)
and `nativeControls` in [validation](plugin-validation.json).

Two new standalone suites bring discovery to 297. SDK 0.8.0, host API 1 and
app 2.0.0 remain unchanged. This is selected macOS evidence, not a full release
battery. Host-reviewed panel AI/caption/GIF actions are next; other unchecked
pre-v1 capabilities and release/platform gates still block v1. No installer,
publication, commit or push was made.


### Reviewed panel AI, caption and GIF pre-v1 outcome

Panel command allowlists now support the existing chapter AI, caption
translation/write and native GIF contracts. Each run retains a trusted click,
fresh native consent, mandatory host review for proposed chapters/captions, exact
panel lifetime checks and validated inputs/results. Captions require final panel
authorization and document/load/ownership rechecks before one atomic Undo commit.
GIF publication rechecks the live panel at the native exclusive-publication
boundary and records actual completion before returning a path-free metadata
receipt. Published files remain after closure; export consent now says so.

The final fixed-source selected regression passed 87 suites with no failures.
The new broker contract suite passed 21 checks; three public-SDK-built
packages passed 41 Electron checks and 7 after a fresh process restart.
Coverage includes review/denial, single-opening denial, private source-track
sharing, actual marker/caption receipts and Undo, malformed and late model results,
authorization/closure races, locks, disable/re-enable, real GIF pixels/frame count/
duration, exclusive destinations, cancellation, saved captions and package removal.
AI responses are deterministic stubs; the actual worker, host reviews, reducer,
renderer/encoder and save/restart paths are real. SDK/renderer builds and
structure/whitespace checks passed; host captures were inspected. Evidence:
[contract](plugin-panel-reviewed-actions.md) and `reviewedPanelActions` in
[validation](plugin-validation.json).

Two new suites bring discovery to 299. This is selected macOS evidence,
not installed-release, native OS focus, live-provider or cross-platform
certification. SDK 0.8.0, host API 1 and app 2.0.0 remain unchanged; version files
are byte-for-byte unchanged. Media import/processing and host-owned destination
jobs/uploads are next. Other unchecked pre-v1 capabilities and release/platform
gates still block v1. No installer, publication, commit or push was made.


### Picked media and reviewed destination jobs pre-v1 outcome

`media.import` and separate `media.process` now stage one user-picked source into
a verified library item, with fixed PNG resize, PCM WAV extraction and bounded
H.264/AAC video trim. The host owns capture, codecs/arguments, limits, processing,
source verification and single-use adoption. Empty editor timelines are supported
for media jobs; one library membership change is undoable and its owned source
remains available for Redo, saved projects and plugin removal. No implicit clip
insertion or arbitrary source paths are granted.

`export.upload` now stages a reviewed HTTPS PUT of the same run's native GIF,
using declared origins, a user-entered exact-origin URL and optional transient
Bearer token. The host verifies a digest-checked private snapshot, pins public DNS
addresses, retains TLS verification, follows no redirects, bounds transfer and
returns actual acknowledgment/uncertainty metadata. Local artifact publication is
preserved on upload refusal, cancellation or failure. Closing the current panel
retains the truthful completed artifact in the host dock instead of a false
no-changes receipt. Two original examples document the supported recipes and an
explicitly unconfigured destination placeholder.

The final fixed-source selected regression passed 90 suites with no failures.
Media/native contract checks passed 37; the real local HTTPS transport fixture
passed 28. Three public-SDK-built packages passed 30 Electron app checks
plus 4 after a fresh process restart, including source processing, private
path-free receipts, empty-timeline import, atomic Undo, CraftAI ownership, stale
picker/authorization cancellation, denied processing, real GIF bytes, upload review,
exact-origin enforcement, retained local output and removal-safe saved sources.
App transport is stubbed; actual HTTPS transfer is tested separately with a local
TLS server. SDK/renderer builds, localization, structure and whitespace passed.
The final host capture was inspected. Evidence: [contract](plugin-media-jobs.md)
and `mediaAndDestinationJobs` in [validation](plugin-validation.json).

Three suites bring discovery to 302. SDK 0.8.0, host API 1 and app 2.0.0
remain unchanged; version files are byte-for-byte unchanged. This remains selected
macOS evidence, not release certification or live destination compatibility.
Additional reviewed provider protocols are next. Remaining pre-v1 scope and
release/platform gates still block v1. No installer, publication, commit or push
was made.


### Provider scope correction

The maintainer rejected the unspecified additional-provider-protocol requirement.
It referred to extra AI-provider wire formats, not a missing plugin SDK protocol.
The existing OpenAI-compatible declarative provider contract remains supported.
Additional formats are optional integrations justified by a named unsupported
provider/use case. They are removed from the current pre-v1 requirements, without
being marked implemented. Earlier outcome text naming them as next is historical.
Remaining SDK requirements and production verification gates remain open; no runtime
or version change was made.


### Managed local tools/models and temporary service authoring outcome

The curated `speech.whisper` adapter now stages fixed, permissioned local speech
recipes through the public SDK. Settings owns explicit tool approval and pinned
model download/import/removal. Real native inference produces a reviewed,
exclusively saved SRT without changing project state. Models and binaries are
verified before execution; cancellation, ownership and package/generation
revocation prevent late publication. Native programs are separately approved
host tools running as the desktop user, not arbitrary plugin code in an OS sandbox.

Temporary provider tests use fresh destination consent, manually entered transient
keys and bounded OpenAI-compatible text requests. Temporary export presets render
a short detached project snapshot and recheck the author generation at native
publication. Neither joins installed registries or saves ephemeral identities.

Final fixed-source selected regression: 98 PASS / 0 FAIL; discovery: 319 suites.
The four new suites verify contracts and actual hidden Electron workflows,
including real Base-model inference and real short video encoding. A tampered-
package UI guard and missing translation wrappers were corrected; earlier failed
results are retained. Implementation hashes stayed unchanged throughout the final
run. SDK/renderer builds, structure and whitespace checks passed.

Evidence and exact limits: `managedLocalAndAuthoring` in
[validation](plugin-validation.json), [local tools](plugin-local-tools.md) and
[development sessions](plugin-development.md). CLI installation remains a separate
user prerequisite; current inference proof is macOS/Base, and provider requests
use loopback fixtures. Full compatibility/documentation reconciliation and the
release/platform/accessibility/performance gates remain open. SDK 0.8.0, host API 1
and app 2.0.0 remain unchanged. No installer, commit, push or publication was made.


## Trusted Node migration checkpoint

The general extension host is replacing fixed executable recipes. Native views,
messages, shortcuts, document inspection, managed media/processes/services,
save/export preparation and general video export are implemented. The optional
workbench example demonstrates a native managed render command. Versions remain
app 2.0.0, SDK 0.8.0 and host API 1. This checkpoint does not retire the historical
command/panel contracts described above. Current remaining scope and focused
verification are recorded in [extension-host status](plugin-extension-host.md) and
`plugin-validation.json.extensionHostVideoExports`. The full accepted migration
remains active.


## Trusted event checkpoint

The general Node host now includes typed core events and namespaced custom
topics, bounded acknowledged delivery, replay/readiness/disposal, actual edit
provenance and callback revocation at native commit. Native editor, utility,
view/stream compatibility and the frozen focused selection passed. Details and
remaining scope are in [event contracts](plugin-extension-events.md) and
[extension-host status](plugin-extension-host.md); exact evidence is under
`plugin-validation.json.extensionHostEvents`. The accepted migration remains
active and versions are unchanged.

## Node development checkpoint

Built source folders now support native session-scoped trust, captured Node
generations, isolated settings/secrets, stop/commit/resource ordering on reload,
compiled watch and retained runtime diagnostics in Settings. See
[development contracts](plugin-extension-development.md) and
`plugin-validation.json.extensionHostDevelopment` for verification. Legacy
executable migration, release reconciliation, ASAR, full regression and other
platform gates remain open. App 2.0.0, SDK 0.8.0 and host API 1 are unchanged.

## General document/tool migration checkpoint

Node extensions now have revision-scoped marker transactions, native file pickers
and bundled tool discovery. Five replacement source projects are verified in the
real app: chapter markers, dashboard, preferences, clip controls and local media.
The old recipes remain until the remaining AI/caption/transcription/GIF sources
and integrations migrate and legacy execution is retired. See
[API contracts](plugin-extension-document-tools.md),
[Node source examples](../../examples/extensions/README.md) and
`plugin-validation.json.extensionHostDocumentTools` for exact scope and evidence.
Versions remain unchanged and the accepted goal remains active.


## Managed jobs and output examples checkpoint

General Node replacements now cover GIF export, reviewed HTTPS upload and local speech setup/transcription/SRT output. The host adds scoped native job cancellation and verified file publication, without specialized executable extension kinds. The focused selection passed 73 suites; the final style-only adjustment passed 4 affected native UI suites. Native output verification passed 26 checks. Versions remain unchanged. See [managed jobs/files](plugin-extension-jobs-files.md), [migration status](plugin-extension-host.md) and `plugin-validation.json.extensionHostJobsFilesOutputExamples` for source hashes, failures/corrections and limits. The last AI/caption source migrations, legacy runtime retirement and release/platform gates remain open.


## Ordinary AI service checkpoint

Core CraftAI now consumes general services through `ai.engines`; the local AI Node replacement owns transport and credentials. Native model choice/refresh, actual tool calls/results, Undo, cancellation and missing-engine restart behavior passed. The frozen focused selection passed 89 suites with 0 failures; the completed native workflow passed 19 checks. A final fixture-only capture wait was reverified without product changes. See [AI service contract](plugin-extension-ai.md) and `plugin-validation.json.extensionHostAiServiceIntegration`. Versions are unchanged. The last chapter/translation source migrations, general selected-AI access, legacy executable retirement and release/platform gates remain pending.

## General Node runtime retirement

- [x] Retire executable recipes and specialized executable manifest declarations;
  preserve immutable creative assets and explicitly identify historical packages.
- [x] Keep same-version historical/Node payloads distinct, require fresh Node trust
  and retain creative dependency availability through replacement removal.
- [x] Replace fixed GIF controls with general export actions and expose globally
  cancellable managed jobs.
- [x] Verify native migration, current SDK clean installation, mixed-pack export,
  private preparation drafts and the Node utility worker under ASAR.
- [ ] Close the remaining [release prerequisites and platform gates](plugin-legacy-retirement.md).

App 2.0.0, SDK 0.8.0, host API 1 and example versions remain unchanged.
