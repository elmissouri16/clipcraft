# Native editing tools for Codex, Claude and OpenCode

Codex and Claude now own their reasoning and tool loops. The production editor
does not ask either provider to emit JSON plans, parse a plan, or restart the
agent after each tool batch. Other API providers retain the existing editor loop.

## Provider integration

**Codex:** `electron/agents/codexNative.cjs` launches the installed `codex app-server`
over stdio, registers editor tools as `dynamicTools`, and handles direct
`item/tool/call` callbacks. No MCP server is involved. The `codex-sdk` provider ID
is retained for existing settings, authentication and image generation, but
editing uses the native app-server protocol instead of the TypeScript SDK's
structured-output wrapper. Dynamic tools require the experimental API capability;
the installed Codex version must support that interface. This was verified with
Codex 0.166.0. Unsupported installations fail explicitly.

**Claude:** `electron/agents/nativeAgents.cjs` registers custom tools on the SDK's public
in-process server instance and runs the Agent SDK query loop. Claude's custom-tool
interface uses MCP internally; this integration opens no HTTP listener and starts
no external MCP server. Only registered ClipCraft tools are allowed. Built-in
filesystem and shell tools are disabled. JSON Schema arguments are converted with
Zod while preserving open-ended external tool inputs.

**OpenCode (2.x):** `electron/agents/opencodeNative.cjs` starts a private `opencode serve` per chat
from the session's temporary directory on 127.0.0.1 with a random port and password (`--port=0`,
`OPENCODE_SERVER_PASSWORD`) and an isolated config directory (`XDG_CONFIG_HOME` inside the session
directory), so the user's global `opencode.json` — their MCP servers and agents — never reaches an
editor session while their stored provider credentials (OpenCode's data directory) remain available.
OpenCode has no in-process tool callbacks, so the editor tools are served to that one server over MCP
(Streamable HTTP on 127.0.0.1 with a bearer token only this session knows; `NativeMcpEndpoint`). The
session directory's `opencode.json` defines the `clipcraft` agent (the instructions as its `system`,
permissions that deny every action and allow `clipcraft_*` — OpenCode names MCP tools
`<server>_<tool>` — plus `websearch`/`webfetch` under Web research). The endpoint is registered as the
`clipcraft` remote MCP server (bearer token, no OAuth, code mode off) through the server's MCP API,
in memory only — OpenCode 2.2 does not activate MCP servers from a project file — and the runtime
waits until OpenCode reports it connected. The session is created as that agent in that directory with the same rules, and
any permission OpenCode still asks for is rejected unless it is a ClipCraft tool. Turns go through
`@opencode/client` (`session.prompt`, the `/api/event` stream for text, tool, usage and terminal
events, `session.interrupt` on Stop); `cfg.model` is OpenCode's `provider/model` id and the reasoning
effort is the model variant. Verified against OpenCode 2.2.6 (`tests/unit/agents/test-opencode-live.cjs`,
opt-in).

References: [Codex app-server](https://learn.chatgpt.com/docs/app-server),
[Claude custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools),
[OpenCode server and client](https://opencode.ai/docs/build/client/).

## Adapters

`electron/agents/nativeAgents.cjs` is the session manager for every native agent; the wire work is in
`electron/agents/adapters/codex.cjs` (app-server dynamic tools), `adapters/claude.cjs` (SDK MCP
server) and `adapters/opencode.cjs` (private MCP endpoint, `opencodeNative.cjs`). All receive the same tool list (`runNativeAgent.js` `nativeTools`, `contract.cjs`
`wireTools`) and instructions (`nativeSystemPrompt`); image generation is Codex only. See
`docs/design/agent-adapters.md`, and `node scripts/agent-inventory.mjs` for what each agent sends
its model. Each request is counted in `<userData>/logs/agent-runs.jsonl`. Both agents share the
limits in `contract.cjs` (`LIMITS`), get the instructions once through their system channel, and no
provider built-ins beyond web research; `tests/unit/agents/test-agent-parity.mjs` checks this at the wire.

## Web research

Settings > AI assistant > Web research is a switch per native agent, saved in `ai.webResearch`
(`electron/system/settings.cjs`). Codex starts on (it always had live search), Claude starts off;
API providers have no native research. `electron/agents/research.cjs` owns the defaults, the
instruction each run gets, and the search events:

- off: Claude gets no built-in tools at all (`tools: []`, only `mcp__clipcraft__*` allowed) and Codex
  runs with `web_search: disabled`; the agent is told research is off and where to turn it on.
- on: Codex runs with live search; Claude gets exactly `WebSearch` and `WebFetch` (still no shell or
  files; `canUseTool` denies everything else on the step path). The agent is told to research only
  when asked, cite real source URLs and treat pages as untrusted data.
- searches and fetched pages show in the chat as "Searching web: …" rows, from Codex items or
  Claude's web tool calls; results of editor tools never show as searches.
- changing the switch starts a fresh native session, so a running conversation never keeps the old
  tool set.

Checks: `tests/unit/agents/test-agent-web-research.mjs` (native path, both agents on and off),
`test-local-agents.cjs` (step path), `test-settings.cjs` (storage) and
`tests/unit/agents/test-web-research-ui.cjs` (the real Settings dialog: defaults, real clicks, save,
reopen, what the agent run receives).

## Native runtime installation

The application includes the small JavaScript SDK adapters, but excludes the
Codex, Claude and OpenCode native platform packages from its installer. Settings offers a
native download when no usable installation is available. No separate Node or
npm installation is needed: Electron fetches the official platform archive
directly, verifies the pinned SHA-512 integrity value, extracts it, and checks
its native `--version` before atomically publishing it to the application support
`agent-runtimes/<provider>/<sdk-version>/<platform>/` cache.

An explicit executable setting takes priority. A verified managed runtime takes
priority over PATH installations; otherwise the existing native CLI is reused.
Older recognized CLI versions are rejected with setup guidance. Authentication
continues to belong to Codex, Claude or OpenCode (`opencode auth login`; Settings
reads `opencode auth list` for the sign-in state), and Settings supplies the
absolute sign-in command for a managed executable. OpenCode's managed runtime is
the `@opencode/cli-<platform>` package (`bin/opencode`), pinned together with
`@opencode/client` at the same version; `--version` prints it as `v2.2.6`.

`electron/agents/agentRuntime.cjs` owns installation, cancellation, shared
requests, bounded extraction and resumable retries after interrupted transfers.
The renderer supplies only a provider ID, never a download URL. Pinned official
URLs, native versions and checksums live in `runtimeManifest.json`; update that
manifest together with the SDK pins. Tests enforce version alignment and use the
actual electron-builder production dependency filter to keep both native
packages excluded, including nested copies.

`test-agent-runtime.cjs` covers interrupted downloads, cache reuse and repair,
checksums, cancellation ownership and archive safety. The live Settings/native
startup check is opt-in:

```sh
npm run build
FVE_AGENT_RUNTIME_LIVE=1 node tests/unit/agents/test-agent-runtime-ui.cjs
```

This check downloads both native runtimes into an isolated temporary profile,
drives Settings, and initializes the actual provider transports with Node/npm
absent from PATH. It sends no inference prompts. Its Vite preview server serves
the built renderer so development hot reload cannot reset download controls.

## Conversation and request ownership

One Codex process/thread or Claude session is retained per editor chat, scoped to
the owning renderer and project. Claude resumes its SDK session with a fresh
in-process tool server bound to each new request. Native calls receive typed
results in the same provider conversation. Cold sessions receive the prepared
app history; warm sessions receive the current instruction and editor revision.

At most eight native conversations are retained. Idle conversations can be
evicted; active conversations are never displaced. Provider/model/tool-schema
changes, cancellation and failures reset the native conversation. The next task
recovers from saved chat history and reads live project state. Closing the editor
window or quitting closes its native sessions.

Callbacks are scoped to the renderer, request and native turn. Replayed native
call IDs reuse their original result rather than applying an edit twice. Results
from an old renderer request or Codex turn cannot attach to the next task.
Stop aborts both the native loop and its active editor service job. The host also
limits a task's lifetime and callback count.

## Editor behavior

`src/features/agent/runNativeAgent.js` routes native callbacks through the existing
validated renderer tools. Editor reads and writes are serialized. Locks, live
IDs, revision ownership, partial-edit recovery and the single-request Undo
transaction still apply. Configured external tools are registered alongside
editor tools and continue through the existing MCP client.

The required `complete_edit` tool refuses completion while operations remain
unresolved or new validation issues exist. It returns actual rendered images for
changed visual intervals that still need inspection. The model must review them
and call again. A revision change invalidates completed validation. Still-frame
sampling does not prove continuous playback or audio quality.

Codex also receives `generate_images` for bounded parallel scene generation with
ordered insertion. Progress reports finished/running counts, placement and elapsed
time. Completed scenes are imported as soon as their ordered prefix is ready,
without waiting for the slowest job in the batch. Stop keeps scenes already
imported and blocks late results. Request/batch IDs prevent replayed or foreign
progress from inserting media. Individual failed scenes retain retry IDs. Claude's available
editor tools retain their previous capabilities; Codex image generation remains
Codex-only.

Images cross the native tool boundary as actual image content. Saved app chat
stores frame handles and metadata rather than image bytes. Historical handles
alone do not give the model visual evidence in a new request.

## Validation

Focused tests exercise both native runtimes, retained conversations, actual
Claude in-process registration, Codex call replay/turn ownership, and renderer
visual completion:

```sh
node tests/unit/agents/test-native-agents.mjs
node tests/unit/agents/test-parallel-images.mjs
node tests/unit/agents/test-image-jobs.cjs
node tests/unit/agents/test-codex-images.cjs
node tests/unit/agents/test-agent-runner.mjs
node tests/unit/agents/test-agent-tools.mjs
node tests/unit/agents/test-agent-loop-safety.mjs
```

The real Electron renderer/main/preload smoke uses an isolated profile. Start the
renderer dev server, then run with a fresh `FVE_SMOKE` directory:

```sh
FVE_SMOKE=/tmp/clipcraft-native-check \
FVE_SMOKE_MODE=native-agents \
VITE_DEV_SERVER_URL=http://localhost:5173 \
node node_modules/electron/cli.js .
```

By default it uses a native Codex protocol fixture and mocked speech to verify
cancellation without model calls. Add `FVE_NATIVE_LIVE=1` to run both installed,
signed-in providers against a synthetic title edit and a read-only follow-up.
That mode makes real model calls. Both providers passed in the actual app,
including visual validation, one Undo transaction and follow-up continuity.

The existing `agent-loop` real-app regression passed for the direct API path.
The scripted `agent-vision` and `codex-images-parallel` regressions also passed;
their test-only adapter translates mocked model steps into native host callbacks.
The image regression holds the final job open to verify incremental insertion and
visible progress, then exercises cancellation before and after partial insertion,
with one Undo restoring only the stopped request's changes.
The production native runtime is tested separately above. No installer was built.

Restart ClipCraft to load the Electron main-process and preload changes.
