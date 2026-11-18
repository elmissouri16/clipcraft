# Plugin SDK and authoring tools

Trusted Node extensions use the experimental `@clipcraft/plugin-sdk/extension`
entry. See [current host status](plugin-extension-host.md),
[save/export hooks](plugin-extension-hooks.md) and
[general video export](plugin-extension-exports.md), plus
[typed, bounded events](plugin-extension-events.md). The older command/panel
contracts below are historical. The runtime and recipes have been retired; use
[the current SDK guide](../../packages/plugin-sdk/README.md) and
[retirement/migration rules](plugin-legacy-retirement.md).

## Current authoring contract

SDK 0.8.0 targets host API 1 and ClipCraft 2.0.0. Use the root package for
manifest/creative contracts, `@clipcraft/plugin-sdk/extension` for the general
Node context and `@clipcraft/plugin-sdk/authoring` for Node authoring tools.
The executable template is `extension`; the other templates create declarative
creative packs. Specialized speech/AI/provider types and command/panel clients
are not part of the current SDK.

Build source outside the editor, then install its compiled payload. Development
sessions capture a separate generation with temporary trust/settings/secrets;
see [Node development and diagnostics](plugin-extension-development.md).
Use [ordinary services](plugin-extension-host-services.md),
[managed jobs/files](plugin-extension-jobs-files.md),
[views](plugin-extension-views.md), events and hooks to compose features.
Raw Node files, network and processes are available after explicit trust.

The [SDK README](../../packages/plugin-sdk/README.md) is the current author guide.
[Compatibility and stored-data policy](plugin-sdk-compatibility.md) defines
updates and migrations; [SDK validation](plugin-sdk-validation.md) records local
checks and the unexecuted remote CI matrix. Passing development checks does not
approve publication or SDK v1.

## Historical recipe authoring design

The remainder records the earlier implementation sequence and its evidence.
Its command/panel permissions, specialized contributions and source conventions
do not add APIs to the current Node contract.

This stage makes the existing extension runtime usable by plugin authors. The SDK now includes
[read-only editor context](plugin-editor-context.md) and
[bounded clip transactions](plugin-edit-transactions.md),
[declarative menu registrations](plugin-ui-actions.md), and
[main-track reorder transactions](plugin-main-reorder.md) and
[main-track split and trim](plugin-main-ranges.md), plus
[explicit linked split and trim](plugin-linked-edits.md), and
[link management and pair movement](plugin-link-management.md), and
[explicit linked reordering](plugin-linked-reorder.md), and
[bounded ripple removal](plugin-ripple.md), and
[clip lifecycle and track placement](plugin-lifecycle.md), and
[static text, picture and audio properties](plugin-properties.md), and
[bounded speed, source curves and effects](plugin-automation.md), and
[native toolbar/inspector controls](plugin-native-controls.md), plus
[picked media and reviewed upload jobs](plugin-media-jobs.md), and
[managed local speech tools/models](plugin-local-tools.md). The current SDK is
`@clipcraft/plugin-sdk` 0.8.0, targeting host plugin API 1 and ClipCraft 2.0.0+.
SDK package version and manifest `apiVersion` are separate contracts.

## Deliverables and boundaries

- A browser-safe SDK with command dispatch helpers, typed manifests, command
  contexts, panel clients, local error codes and explicit subscription disposal.
- A Node CLI to scaffold source projects, type-check, compile fixed assets,
  validate directories/archives, inspect declared capabilities, watch local builds
  and package installable archives without overwriting existing output.
- Build the SDK distribution from the editor's canonical shared validators and
  package reader. Published artifacts must be self-contained, with no imports
  pointing back into a ClipCraft checkout and no runtime code evaluation in the CLI.
- Separate author source (`src`, dependencies, TypeScript, README) from the fixed
  installable `dist` payload. Bundled panel scripts use IIFE; commands export `run`
  as a standalone module. No dependency resolution or compiler runs inside the editor.
- Legacy sandboxed entries refuse Node/external imports. Trusted Node entries
  allow bundled dependencies; both reject missing exports/assets, oversized bundles,
  incompatible manifests and unknown workspace files in the installable output.
  Validation verifies structure/compatibility, not the safety or correctness of
  arbitrary authored logic. The actual sandbox and host remain authoritative.
- Rebuild source locally and report diagnostics. Installed package snapshots stay
  immutable: changing bytes requires a version bump and explicit reinstallation.
  Command/panel editor reload and isolated creative rendering previews are provided
  by [development sessions](plugin-development.md). Reviewed cross-version panel
  preference copying, pack browsing/previews and disposable preview-cache cleanup
  are documented in [the usability guide](plugin-usability-expansion.md). Temporary
  provider/export-preset tests use detached development snapshots; marketplace/signing retains
  its separate distribution plan.

## Implementation sequence

1. Create SDK runtime helpers, public declarations and a capability/support matrix.
2. Add canonical validator bundling and a self-contained SDK distribution build.
3. Add CLI scaffolding for panel, command, effect, transition, export preset and
   AI provider packages, with source/output separation and safe output ownership.
4. Add typed checking, bundling, directory/archive validation, inspection, packaging
   and local watch diagnostics. Errors use stable tool/SDK codes; existing host
   errors are wrapped as host rejection rather than classified by message guessing.
5. Check declarations with positive/negative TypeScript fixtures, package parity
   against every shipped example, adversarial CLI inputs and clean-room SDK install.
6. Use the generated panel/command in a real isolated hidden Electron run. Verify
   SDK calls, typed dispatch, consent, results, disposal and unchanged project history.
   Record evidence and limits. No installer or npm publication is part of this stage.

Public author instructions live in the SDK README. The capability matrix describes
what API 1 actually supports, including read-only context and same-package panel
command allowlists for marker/clip edits and [reviewed panel AI, caption and GIF
actions](plugin-panel-reviewed-actions.md). Types describe method shapes, not proof of host permissions. A disposed
client unsubscribes immediately and rejects further use; it does not undo a storage
write or project commit the host already accepted.


## Authoring entry point

Read [the SDK README](../../packages/plugin-sdk/README.md) for creation commands,
public types, lifecycle/error semantics, the complete capability matrix and local
SDK installation. The supported source convention is TypeScript: commands.ts and
panel.ts compile with fixed strict settings and separate WebWorker/DOM libraries.
Static contribution templates need no compiler invocation. No TypeScript compiler
runs inside the installed editor. A small workspace lock serializes builds; the
last published build remains available after failed compilation/validation. Source
watch warns when changed bytes reuse a plugin version and does not auto-install.

Creative extensions now support bundled sound and font assets alongside multiple
effects/transitions. See [content packs](plugin-content-packs.md) and the public
SDK README for formats, authoring, limits, licensing and lifetime semantics.

Creator-facing packs additionally support title/caption styles, .cube/color
looks, source-time motion presets, native in-app creation, project dependency
recovery and MP3/OGG/TTF/OTF assets. The public SDK README is the author contract;
[creative expansion](plugin-creative-expansion.md) records the full six-item scope.
