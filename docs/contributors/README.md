# Contributor documentation

Use this index for architecture, implementation contracts, design history and development checks. The [editor handbook and developer tutorials](../README.md) cover using and extending the application.


[ClipCraft feature overview](../../README.md#editing-tools) · [Getting started](../../README.md#getting-started)

## Editor, media and export

- [The project file and its chat sidecar](../architecture/project-file.md)
- [Bundled, system and imported fonts](../media/fonts.md) — loading, availability and export checks.
- [VoiceStudio extension setup](../media/voicestudio.md)
- [Word animation](../design/WORD-MODE-ADDENDUM.md)
- [Editable motion graphics](../design/motion-graphics.md)
- [Export quality](../export/EXPORT-QUALITY.md)
- [Effect export storage and failure handling](../export/EFFECT-STORAGE.md)
- [Online media sources and project credits](../architecture/openverse-media.md)
- [Export containers, codecs and cover images](../architecture/export-experience.md#output-formats)

## CraftAI and external agents

- [Native agent tools](../agents/native-agent-tools.md)
- [External agents over MCP (Claude Code, Codex)](../agents/external-mcp.md)
- [AI providers: one table, four protocols](../agents/ai-providers.md)
- [AI thinking controls](../agents/ai-thinking.md)
- [Agent editing](../agents/agent-editing.md)
- [Editorial agent: plans, transcript cuts, critique and beats](../agents/editorial-agent.md)
- [Long source clip discovery and reviewed preview cards](../agents/source-discovery.md)
- [Optional native analysis subagents](../agents/analysis-subagents.md)
- [Edit vocabulary and reference videos](../agents/edit-vocabulary.md)
- [Visual tool activity and inline exports](../agents/tool-activity.md)

## Install or author a plugin

Start with the system guide to install a package or the SDK quick start to write one.

- [Plugin system and author contract](../design/plugin-system.md)
- [Public plugin SDK and authoring tools](../../packages/plugin-sdk/README.md) — typed helpers, scaffolding, checking, bundling, validation and packaging.
- [SDK entry points, runtime feature keys and examples](../design/plugin-sdk.md)
- [Extension API guide](../design/plugin-extension-api.md) — every context namespace with examples, lifecycle rules, limits and known gaps.
- [Runnable Node extensions](../../examples/extensions/README.md) — speech, AI, media, export and editor features through general APIs.
- [Creative pack examples and demo project](../../examples/plugin-showcase/README.md)
- [Creative sounds, fonts, styles, motion, effects and transitions](../design/plugin-content-packs.md)
- [Plugin developer sessions](../design/plugin-extension-development.md) — temporary Node snapshots, reload, build watching and runtime diagnostics.
- [SDK capability discovery, typed services, project settings and debugger attach](../design/plugin-sdk-general-contracts.md).
- [SDK compatibility, data lifecycle and distribution](../design/plugin-sdk-compatibility.md).
- [Historical executable retirement and compatibility](../design/plugin-legacy-retirement.md).

## Extension contracts

- [Current trusted Node extension contract](../design/plugin-extension-host.md) — commands, events, services, hooks, jobs and native views.
- [Trusted extension project inspection](../design/plugin-project-inspection.md)
- [Custom clip and track types](../design/plugin-custom-timeline.md) — typed saved data, native timeline/inspector controls and shader/media rendering.
- [Authored GLSL effects and transitions](../design/plugin-glsl.md) — shader functions, GPU validation and shared rendering.
- [Open extension surfaces and rendering](../design/plugin-open-extension-surfaces.md) — active pre-alpha SDK expansion and verification.
- [Native extension actions and property controls](../design/plugin-extension-native-controls.md) — live action state, icons and selected clip bindings with Undo.
- [Trusted extension workbench views](../design/plugin-extension-views.md)
- [Trusted extension shortcuts](../design/plugin-extension-shortcuts.md)
- [Trusted extension messages](../design/plugin-extension-messages.md)
- [Extension UI, processes and editor expansion](../design/plugin-extension-expansion.md) — native prompts/status/tabs/menus, streaming helpers, project lifecycle, GIF and caption styling.
- [Trusted extension events](../design/plugin-extension-events.md)
- [Trusted extension save/export hooks](../design/plugin-extension-hooks.md)
- [Document lifecycle hooks](../design/plugin-document-lifecycle-hooks.md) — close validation/preparation and read-only open/create/close notifications.
- [Typed extension-defined hook points](../design/plugin-custom-hooks.md)
- [Trusted extension video export](../design/plugin-extension-exports.md)
- [Managed extension jobs and file publication](../design/plugin-extension-jobs-files.md)
- [General marker edits, file pickers and host tools](../design/plugin-extension-document-tools.md)
- [Application services and atomic caption tracks](../design/plugin-extension-host-services.md)
- [CraftAI through ordinary extension services](../design/plugin-extension-ai.md)
- [Ordinary extension commands in CraftAI](../design/plugin-extension-agent-commands.md)

## Contributing to the editor

- [Project structure and development commands](../architecture/project-structure.md)
- [Design system](../design/DESIGN-SYSTEM.md)
- [Localization: en, fr, es through one dictionary](../design/localization.md)
- [Editor usability and UI regression coverage](../design/editor-usability.md)
- [Agent evaluation harness](../agents/agent-eval.md)
- [Agent tool contract and adapters plan](../design/agent-adapters.md)
- [External agents over MCP plan](../design/external-agent-mcp.md)

## Earlier plugin designs and migration history

These design records describe the retired command sandbox, specialized provider recipes and panel protocols. New executable plugins use the trusted Node contract above.

- [Sandboxed plugin command SDK](../design/plugin-commands.md)
- [Custom plugin panels](../design/plugin-panels.md) — isolated docked interfaces, read-only summary SDK, theme/focus contracts and failure recovery.
- [Plugin AI workflows](../design/plugin-ai-workflows.md) — caption sharing, bounded chapter generation and host review.
- [Plugin caption translation](../design/plugin-caption-translation.md) — enum inputs, source-track selection, side-by-side review and hidden translated tracks.
- [Plugin GIF export jobs](../design/plugin-gif-export.md) — bounded local rendering, destination protection, cancellation and verified artifacts.
- [Plugin AI providers](../design/plugin-ai-providers.md) — declarative services, scoped credentials, destination consent and host-owned requests.
- [Historical managed local tools/models](../design/plugin-local-tools.md) — retired speech recipe; current implementations use ordinary Node extensions.
- [Picked media and destination jobs](../design/plugin-media-jobs.md) — managed imports/process recipes and reviewed bounded HTTPS uploads.
- [Reviewed panel actions](../design/plugin-panel-reviewed-actions.md) — host AI/caption review and verified path-free GIF receipts.
- [Historical native plugin controls](../design/plugin-native-controls.md) — retired recipe toolbar actions and inspector drafts; use current Node registrations above.
- [Plugin UI actions](../design/plugin-ui-actions.md) — declarative menu entries, selection conditions and host command controls.
- [Plugin edit transactions](../design/plugin-edit-transactions.md) — atomic, permission-gated clip moves and trims.
- [Plugin editor context](../design/plugin-editor-context.md) — permission-gated selection, playback and bounded timeline metadata.
- [Linked plugin split and trim](../design/plugin-linked-edits.md) — explicit picture/audio partners and synchronized atomic edits.
- [Main-track plugin split and trim](../design/plugin-main-ranges.md) — source continuity, explicit gaps and retained transition overlap.
- [Linked plugin reorder](../design/plugin-linked-reorder.md) — explicit companion pairs, preserved offsets, transition policies and atomic sequencing.
- [Plugin source automation](../design/plugin-automation.md) — fixed-duration speed, source-time curves and validated effect-slot editing.
- [Plugin static properties](../design/plugin-properties.md) — typed text/style, picture geometry/opacity, volume/mute and edge fades.
- [Plugin clip lifecycle](../design/plugin-lifecycle.md) — bounded creation/deletion/duplication, explicit track creation and placement.
- [Plugin ripple removal](../design/plugin-ripple.md) — bounded clock removal, explicit free-clip/pair scope, gap and transition policies.
- [Main-track plugin reorder](../design/plugin-main-reorder.md) — explicit gap/transition policies and atomic transactions.
- [Plugin permission and transaction review](../design/plugin-transaction-review.md) — permission matrix, ordered mixtures, commit/revocation boundaries and bounded generated/app evidence.

## Implementation history and verification

These records describe particular development snapshots, platform runs and release checks.

- [Pre-alpha SDK defect followup](../design/plugin-api-hardening.md) — resolved registration, replay, configuration, picker and view defects.
- [Adopted extension media retention](../design/plugin-media-retention.md) — startup ownership cleanup and project/Undo protections.
- [Author docs and packaged extension verification](../design/plugin-authoring-packaged-followup.md) — current examples, packaged install/trust/Undo/views and cold restart.
- [Plugin API review, 2026-11-18](../design/plugin-api-review.md) — defects found and fixed, what was added and what remains.
- [Creative expansion audit](../design/plugin-creative-expansion.md): native pack authoring, project dependency recovery and six-item acceptance evidence.
- [Plugin usability expansion](../design/plugin-usability-expansion.md): pack search/favorites/previews, reviewed preference migration, live rendering authoring and safe preview-cache cleanup.
- [Plugin implementation roadmap](../design/plugin-roadmap.md)
- [Plugin production-readiness audit](../design/plugin-production-readiness.md) — prioritized release blockers, evidence gaps and acceptance criteria; v1 remains on hold.
- [Plugin candidate release gate](../design/plugin-release-readiness.md) — fixed-candidate full battery, integration fixes, artifact provenance and unresolved failures; production hold remains.
- [Reorganization validation](../architecture/reorganization-validation.md)
- [Agent editing validation](../agents/agent-editing-validation.md)
- [Agent loop reliability](../agents/agent-loop-validation.md)
- [Extension discovery, lifecycle and fixture stabilization](../design/plugin-extension-stabilization.md).
- [Portable package admission and live-library followup](../design/plugin-extension-package-hardening.md).
- [Creative intake and macOS/Linux development verification](../design/plugin-extension-platform-followup.md).
- [Native export reliability and lower-third example followup](../design/plugin-extension-reliability-followup.md).
- [Bounded package work and SDK source capture](../design/plugin-extension-resource-admission.md).
- [Native extension-view keyboard acceptance](../design/plugin-extension-keyboard.md).
- [Closed extension-view package retention](../design/plugin-extension-view-cleanup.md).
- [Native view layout and modal focus](../design/plugin-extension-layout.md).
- [Normal-session observations and remaining retention limits](../design/plugin-extension-normal-session.md).
- [Bounded private-session reuse and stable SDK payloads](../design/plugin-extension-session-reuse.md).
- [Bounded SDK archive publication](../design/plugin-extension-package-publication.md).
- [Archive boundaries, metadata and nested compression](../design/plugin-extension-archive-limits.md).
- [Native encoder FIFO handoff and recovery](../design/plugin-extension-fifo-handoff.md).
- [Combined full application regression and fixture corrections](../design/plugin-extension-full-regression.md).
- [SDK verification command and nonpublishing CI](../design/plugin-sdk-validation.md).
- [Fresh-cache SDK correction and Mac/Linux verification](../design/plugin-sdk-cache-followup.md).
- [Self-contained ASAR worker and native view](../design/plugin-extension-asar-views.md).
- [Unfinished gates skipped in the resumed pass](../design/plugin-extension-unfinished.md).
- [Remote SDK matrix, installed-app acceptance and release automation](../design/plugin-remote-acceptance.md).
- [Bounded inventory recovery enumeration](../design/plugin-extension-recovery-bounds.md).
- [Native-media ASAR paths and decoded exports](../design/plugin-extension-native-media-paths.md).
- [Preview/preference read bounds and final local plugin selection](../design/plugin-extension-storage-bounds.md).
- [Plugin management layout](../design/plugin-management-layout.md) — research, configuration hierarchy and packaged icons.
