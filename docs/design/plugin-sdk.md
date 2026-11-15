# Plugin SDK and authoring tools

This stage makes the existing extension runtime usable by plugin authors. The SDK now includes
[read-only editor context](plugin-editor-context.md) and
[bounded clip transactions](plugin-edit-transactions.md),
[declarative menu registrations](plugin-ui-actions.md), and
[main-track reorder transactions](plugin-main-reorder.md) and
[main-track split and trim](plugin-main-ranges.md), plus
[explicit linked split and trim](plugin-linked-edits.md). The current SDK is
`@clipcraft/plugin-sdk` 0.7.0, targeting host plugin API 1 and ClipCraft 2.0.0+.
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
- Refuse Node/external imports, missing exports/assets, oversized bundles,
  incompatible manifests and unknown workspace files in the installable output.
  Validation verifies structure/compatibility, not the safety or correctness of
  arbitrary authored logic. The actual sandbox and host remain authoritative.
- Rebuild source locally and report diagnostics. Installed package snapshots stay
  immutable: changing bytes requires a version bump and explicit reinstallation.
  Command/panel editor reload is now provided by [development sessions](plugin-development.md).
  Cross-version storage migration, richer editor APIs,
  marketplace/signing and rendering/provider development sessions remain later stages.

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
what API 1 actually supports, including read-only context and the marker-write restriction on panel command
allowlists. Types describe method shapes, not proof of host permissions. A disposed
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
