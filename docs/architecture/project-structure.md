# Project structure

ClipCraft uses feature folders for its renderer and service folders for Electron.
This is a source-layout change. Saved `.clipcraft.json` projects, IPC channel
names, editor behavior and persistent user-data locations retain their formats.

```text
src/
  main.jsx                 Renderer entry point
  app/                     Application shell and app-level UI
  components/ui/           Reusable controls
  state/                   Project normalization, reducer and history
  styles/                  Application and frame-inspection CSS
  features/
    agent/                 Agent loops, tools, context and chat UI
    audio/                 Audio UI, monitoring and meters
    effects/               Effects, grading, LUTs and presets
    export/                Export orchestration and text rendering
    inspector/             Clip and project inspection UI
    library/               Media, assets, stock and favorites UI
    preview/               Composition, transforms and frame inspection
    recording/             Recording hooks and dialogs
    templates/             Template replacement and slot UI
    text/                  Captions, fonts and text rendering
    timeline/              Timeline UI, timing, motion and drag/drop
electron/
  main.cjs                 Application windows and IPC registration
  preload.cjs              Sandboxed renderer bridge
  agents/                  Providers, native runtimes, MCP and frame tools
  audio/                   Speech, transcription and audio processing
  export/                  Layers, text streaming, render jobs and fonts
  library/                 Assets, stock, sounds, generation and templates
  media/                   FFmpeg, proxies, geometry and media analysis
  project/                 Saved projects, autosaves and favorites
  recording/               Recording service, windows and preloads
  system/                  Settings, updates, telemetry and cancellation
tests/
  unit/<feature>/          Standalone Node regression suites
  smoke/                   Real Electron UI checks and their dispatcher
  fixtures/                Test-only CLIs, servers and service stubs
scripts/                   Development and maintenance commands
shared/                    Cross-process contracts and bundled LUT data
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

Test code belongs under `tests/`, outside the packaged Electron services. The
main process loads the smoke dispatcher only when `FVE_SMOKE` is set. Runtime
code must not import unit tests or fixtures. Add tests to the corresponding
feature directory; the runner discovers them recursively.

## Commands

```sh
npm run dev                  # Renderer + Electron, watching nested services
npm run dev:renderer         # Renderer only
npm run test:structure       # Static imports and folder boundaries
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
