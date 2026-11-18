# Project structure

ClipCraft uses feature folders for its renderer and service folders for Electron.
This is a source-layout change. Saved `.clipcraft.json` projects, IPC channel
names, editor behavior and persistent user-data locations retain their formats.

```text
src/
  main.jsx                 Renderer entry point
  app/                     Application shell and app-level UI
  components/ui/           Reusable controls
  state/                   Project normalization, reducer, history and the project file split
                           (projectFile.js: document vs chat sidecar, docs/architecture/project-file.md)
  styles/                  Application and frame-inspection CSS
  features/
    agent/                 Agent loops, tools, context and chat UI
    audio/                 Audio UI, monitoring and meters
    effects/               Effects, grading, LUTs and presets
    export/                Export orchestration and text rendering
    inspector/             Clip and project inspection UI
    library/               Media, assets, stock and favorites UI
    plugins/               Plugin management, development controls and panel dock
    preview/               Composition, transforms and frame inspection
    recording/             Recording hooks and dialogs
    templates/             Template replacement and slot UI
    text/                  Captions, fonts and text rendering
    graphics/              Motion graphics as media: render, swap, re-draw, fonts
    timeline/              Timeline UI, timing, motion and drag/drop
electron/
  main.cjs                 Application windows and IPC registration
  preload.cjs              Sandboxed renderer bridge
  agents/                  Providers, native runtimes, MCP and frame tools
    adapters/              One wire adapter per native agent (Codex, Claude, OpenCode) over contract.cjs
    external/              MCP server for outside agents (HTTP), agent install, one-agent lock
  audio/                   Speech, transcription and audio processing
  export/                  Layers, text streaming, render jobs and fonts
  graphics/                Motion graphics sandbox, runtime and renderer
  library/                 Assets, stock, sounds and Openverse
  media/                   FFmpeg, proxies, geometry and media analysis
  project/                 Saved projects, their chat sidecars, autosaves and favorites
  recording/               Recording service, windows and preloads
  system/                  Settings, UI language and cancellation
tests/
  unit/<feature>/          Standalone Node regression suites
  smoke/                   Real Electron UI checks and their dispatcher
  fixtures/                Test-only CLIs, servers and service stubs
packages/plugin-sdk/       Public author SDK source, types and Node authoring CLI
                           (generated dist bundles the canonical editor contracts)
scripts/                   Development and maintenance commands
shared/                    Cross-process contracts, the AI provider presets (providers.json), the UI
                           dictionaries (i18n/en|fr|es.json, docs/design/localization.md) and bundled LUT data
docs/                      Documentation grouped by subject
```

Feature-specific components live in that feature's `components/` directory.
Keep shared controls in `src/components/ui/`; put renderer state changes in
`src/state/store.js`. Keep privileged services in Electron and expose them through
the existing preload bridge. Renderer agent tools still own validated editor
mutations, while Electron owns provider credentials and external processes.

Keep the Electron entry points stable. Recording window HTML, JavaScript and
preloads stay together. Frame inspection has its own agent preload and renderer
entry component. Treat paths relative to the owning module, not the process's
working directory, unless an API explicitly takes an application root.

`electron/plugins/extensionViews.cjs` owns native workbench view lifetimes.
`extensionViewSessions.cjs` owns its bounded, exclusive private-session leases and
fail-closed cleanup before reuse; it does not expose session objects to extensions.

`shared/pluginLifecycle.mjs` validates bounded public clip/track lifecycle
proposals. Private preparation and commit tokens remain in `src/state/store.js`.
`shared/pluginProperties.mjs` similarly validates static typed clip properties.
`shared/pluginAutomation.mjs` validates fixed-duration speed, source-time curves
and existing effect-resource operations. The SDK build bundles these canonical validators.

`shared/pluginLocal.mjs` validates the curated local-adapter declarations and fixed
recipes. `electron/plugins/localTools.cjs` owns model/tool setup and native jobs;
`electron/plugins/authoring.cjs` owns temporary provider/export test lifetimes.

Pure rendering projection, layer sound/visibility and main-track timing live in
`shared/projectRender.mjs`. The store re-exports the same functions for existing
renderer callers. Host services import the shared module directly: `src/` is
absent from the release payload. `npm run test:runtime-deps` checks literal
Electron/shared imports against `build.files`; `test:structure` includes it.
Computed resource paths, dependency pruning and ASAR/installer execution still
need their separate distribution checks.

Test code belongs under `tests/`, outside the packaged Electron services. The
main process loads the smoke dispatcher only when `FVE_SMOKE` is set. Runtime
code must not import unit tests or fixtures. Add tests to the corresponding
feature directory; the runner discovers them recursively.

## Commands

```sh
npm run dev                  # Renderer + Electron, watching nested services
npm run dev:renderer         # Renderer only
npm run test:structure       # Static imports and folder boundaries
npm run sdk:verify           # SDK suites and candidate tarball in new temp output
npm test -- --list           # List standalone suites
npm test -- agents           # Run one feature's tests
npm test                     # Run all standalone suites; retain failure logs
```

The test runner stores per-suite logs and JSON results in a temporary directory.
It reports failures rather than hiding tests that need unavailable fixtures,
platform tools or external services. Passing focused tests is not a claim that
the entire battery passes.

Actual Electron UI checks retain their environment-based interface:

```sh
FVE_SMOKE=/tmp/clipcraft-structure-ui \
FVE_SMOKE_MODE=structure \
VITE_DEV_SERVER_URL=http://localhost:5173 \
node node_modules/electron/cli.js .
```

Start the renderer first and use a fresh smoke directory to isolate settings,
autosaves and browser storage. Native provider checks use fixtures by default;
live provider checks require their existing explicit opt-in environment flags.
The `structure` smoke checks relocated window resources and preloads without
opening a camera stream or recording the screen. Existing `ui-stability`,
`native-agents`, `agent-loop` and `codex-images-parallel` modes cover editor paths.

Installer packaging and pushes require the explicit authorizations in
`AGENTS.md`.

See [reorganization validation](reorganization-validation.md) for the measured
before/after test baseline and real-app checks for this layout change.


The plugin panel/storage/action UI runners default to quiet tests: isolated hidden
windows, no foreground activation on macOS, and non-focusable editor windows.
`FVE_SMOKE_QUIET=1` enables this mode for compatible smoke workflows. Functional
DOM/preload/IPC/worker checks still run in Electron. The panel runner explicitly
skips native Tab/Shift-Tab host-focus assertions in quiet mode; hidden child-view
capture may fail with `UnknownVizError` and never triggers a foreground fallback.
Set `FVE_SMOKE_QUIET=0` only when an interactive focus/layout check is needed.

`src/features/plugins/components/PluginCommandFields.jsx` renders the shared
native command fields for Settings, dialogs and `PluginInspector`. `PluginToolbar`
uses the same verified action catalog and `usePluginActions` command owner.

`shared/pluginMediaJobs.mjs` defines fixed picked-source recipes and HTTPS
origin/review schemas. `electron/plugins/mediaJobs.cjs` owns captured sources and
single-use adoption records; `uploadJobs.cjs` owns digest-checked snapshots and
bounded HTTPS PUT transport. `uploadReview.cjs` and the host `PluginUploadReview`
collect per-request destination/credential consent outside plugin renderers.

`shared/pluginContent.mjs` owns creative-pack asset definitions, path/byte limits
and structural checks. The package reader fingerprints declared asset buffers;
the manager supplies retained fonts and owns durable sound copies. Renderer
integration uses the existing audio-library and text-font modules.

Creative catalogs live in `shared/{fontCatalog,textCatalog,filterCatalog,motionCatalog}.mjs`
so host/SDK validation and renderer controls use the same original IDs. Renderer
modules re-export their historical paths. `pluginStyles`, `pluginColor`,
`pluginMotion` and `pluginDependencies` contain bounded data contracts and explicit
replacement plans. `cubeLut.mjs` owns the shared renderer parser.

`electron/plugins/packBuilder.cjs` owns draft snapshots and associated font/LUT
copies; `packageWriter.cjs` publishes validated bytes exclusively.
`src/features/plugins/packCandidates.js` strips source words/timing into reusable
appearance snapshots. The native creator and project-dependency components live
with the other plugin UI. Decoder font discovery is test-only in
`tests/fixtures/pack-fonts.cjs`; runtime modules never import it.


`shared/pluginBrowser.mjs` owns stable favorites/filtering; `pluginBrowserApply.mjs`
prepares typed ordinary editor actions from a freshly verified contribution.
`electron/plugins/{browserPreferences,contentPreview,preferenceMigration,previewCache}.cjs`
own the private host browsing data, bounded sample inputs, reviewed preference
copying and disposable sound-preview files/leases. Matching renderer components
live under `src/features/plugins/components/`. The preview renderer accepts pure
validated data directly and never registers development dependencies with project
render catalogs. Existing audio-library previews share the host cache service.


`examples/plugin-showcase/recipes` holds text-only sound/font builder inputs;
`examples/plugins` remains directly valid payloads. `scripts/create-plugin-showcase.cjs`
uses the public SDK to prepare archives and a sample project outside the checkout,
with original media generated by `plugin-showcase-assets.cjs`. The development-only
`launch-plugin-showcase.cjs` supplies an isolated Electron user-data directory and
uses the guarded `plugin-showcase` smoke mode for verification or a visible demo.

`shared/pluginIcon.mjs` validates optional local PNG identity artwork, including
byte and pixel bounds. Icons participate in immutable package fingerprints and
the SDK asset build. The read-only native icon endpoint rechecks installed bytes;
`PluginIdentityIcon` supplies a bounded image cache and monogram fallback.

`shared/extensionServices.cjs` owns bounded portable service schemas and runtime
validation, shared by host, worker and published SDK helpers.
`shared/extensionCapabilities.cjs` owns feature revisions.
`shared/extensionConfiguration.mjs` validates project-owned extension namespaces
and prepares anchored settings actions; writes use ordinary editor/draft commits.
