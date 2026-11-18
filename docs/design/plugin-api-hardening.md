# Pre-alpha SDK defect followup

ClipCraft is pre-alpha. This pass fixes concrete defects without promising a
stable API or preserving obsolete development contracts. App 2.0.0, SDK 0.8.0
and host API 1 are unchanged.

## Fixed behavior

- Opening or canceling either Install picker leaves extension activations and
  their managed jobs running. Selecting a package enters the serialized catalog
  mutation path; actual disable/removal still stops the affected runtime and
  retained enabled extensions resume afterwards.
- Hook registration rejects names other than `project.validateSave`,
  `project.willSave`, `export.validate` and `export.willRender`. Native integration
  registration rejects points other than `voice.engines` and `ai.engines`.
  Public declarations expose those supported names instead of accepting typos.
- Retained-state replay targets the listener requesting it. Multiple queued
  replays remain separate, existing listeners do not receive them again, and
  replay does not suppress a queued live publication. Disposal still removes
  only its own callback.
- A null or undefined event-listener exception is logged without ending the
  activation or skipping subsequent listeners.
- Global and project configuration require finite, acyclic JSON, bounded to
  64 KiB with nesting/item limits. Validation occurs in the worker before
  structured cloning and again in the host. Dates, byte arrays, maps, nonfinite
  numbers, undefined nested values, symbols and sparse arrays reject instead
  of changing meaning in storage. Top-level `undefined` still deletes a key.
- Native numeric settings enforce an explicitly declared step relative to
  `min` (or zero), allowing ordinary floating-point rounding. A select without
  an explicit default uses its first option as the actual default returned by
  configuration reads. Duplicate option values reject.
- The first view `getInfo()` includes the editor's current theme. Layout-only
  updates no longer emit theme callbacks; subsequent reads return the latest
  theme. Packaged assets accept query strings and fragments while retaining
  exact-origin and packaged-file checks.
- Views can compile WebAssembly through `wasm-unsafe-eval`. JavaScript eval,
  inline scripts, remote resources and privileged application IPC remain
  prohibited. Actual WebAssembly compilation is covered in Electron.

## Verification

The original runtime reproduction admitted a misspelled hook, an unknown
integration and a NaN setting; subscribing a second listener incremented the
first listener again. The same reproduction now rejects those registrations
and data, and sends replay only to the second listener.

`test-extension-api-hardening` exercises real worker/host transport, queued
replay, disposal, invalid configuration, defaults and fractional steps.
`test-extension-views` checks query isolation and repeated-layout notifications.
The public-SDK-built API probe runs in the real app and checks both pickers with
an active managed job, actual disable/re-enable, rendered select defaults,
number rejection, initial/current view themes, query assets and WebAssembly.

The initial Electron attempt could not launch inside the filesystem sandbox.
The first outside-sandbox run found a fixture sending an undefined property in
a JSON-only view message; that fixture was corrected. Subsequent native runs
passed. Final verification: 20 focused regression suites passed, all 9 SDK verification
suites passed with unchanged source, and the real-app API probe passed 60
checks. Structure and whitespace checks passed. Receipts and retained earlier
failures are linked from `plugin-validation.json.extensionApiHardening`.

## Still separate

The adopted-media followup is now implemented as [startup ownership cleanup](plugin-media-retention.md).
It reclaims newly tracked abandoned sources, retains the entire creating session
for Undo/in-flight work, protects replaceable recovery/slot snapshots and keeps
sources saved in project files durable. Legacy or uncertain files remain protected.

Operation counts describe submitted operations; richer clip styling is available
through the editor-tool bridge. New UI surfaces, custom clip types and other
capability additions remain separate from defect fixes. No cross-platform,
installed-release, hardware-performance or broad manual acceptance is claimed
by these local checks.
