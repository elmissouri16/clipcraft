# External agents over MCP: ClipCraft as a tool server

Status: plan (2026-11-08). Nothing implemented yet.

## Goal

An agent running **outside** ClipCraft (Claude Code, Codex CLI, any MCP client) connects to the
open desktop app and edits exactly as the built-in native agent does: **the same tools, the same
validation, the same completion check, the same undo grouping**, plus tools to manage projects. No
model runs inside ClipCraft for these sessions; the outside agent supplies the reasoning.

Rules:

- Works only while the desktop app is open. With the app closed, the server still answers, and
  every call returns "Open ClipCraft and retry".
- **One agent at a time.** Only one external agent session holds the editor. It cannot run while
  CraftAI (the in-app agent) is running a request, and CraftAI cannot start while it holds the
  editor.
- Off by default. The user turns it on in Settings and approves each new client once.
- No second tool implementation. External sessions reuse the native path (`runNativeAgent.js`,
  `contract.cjs`, the result builder in `main.cjs`). Any difference from the native agents is a bug,
  the same rule as in `agent-adapters.md`.

Out of scope: running a model for the external session, remote (network) access, more than one
connected agent, and changing settings, app updates, MCP server config or deleting projects from
outside.

## How it connects

```
outside agent ──stdio MCP──▶ clipcraft-mcp bridge ──local socket──▶ ClipCraft main ──IPC──▶ renderer tool host
 (Claude Code,               (small node process     (user-only        (lock, limits,        (createToolRunner,
  Codex, …)                   the agent starts)       socket + token)   result builder)       completion check)
```

### Why a bridge, not an HTTP port

Agents start MCP servers as a stdio command more reliably than they connect to a URL, and a local
socket avoids an open TCP port (no DNS rebinding, no other local user reaching it).

- **App side** (`electron/agents/external/endpoint.cjs`): with the setting on, main listens on a
  Unix socket `<userData>/mcp/clipcraft.sock` (directory 0700; if the path is longer than macOS's
  104-character limit, a short path under the OS temp directory is used instead) or, on Windows, a
  named pipe `\\.\pipe\clipcraft-<hash of user>`. It writes `<userData>/mcp/endpoint.json` (0600):
  socket path, random token, app version, pid. It removes both files on quit.
- **Bridge** (`electron/agents/external/bridge.cjs`): a stdio MCP server with no Electron imports.
  The agent starts it. It reads `endpoint.json`, connects with the token, and forwards calls. The
  MCP session lives in the bridge, so it survives app restarts:
  - `initialize` and `tools/list` are answered by the bridge. The tool list comes from the app
    when it is connected, or from the manifest the app last wrote (`<userData>/mcp/tools.json`).
    The bridge sends `notifications/tools/list_changed` when the app's list differs.
  - `tools/call` connects (or reconnects) on demand. If the app is closed it returns
    `isError: "ClipCraft is not open. Open the ClipCraft desktop app, then retry."`
  - `notifications/cancelled` stops the job (the same abort as Stop in CraftAI). A `progressToken`
    gets `notifications/progress` from the existing render, export and image progress events.
  - The bridge is written by hand like `mcp.cjs` (initialize, ping, tools/list, tools/call,
    cancel, progress): no new dependency and fast startup. It accepts the client's protocol version
    when it supports it (`2025-06-18`, `2025-03-26`, `2024-11-05`), otherwise it offers the newest.
    `tests/unit/agents/test-mcp.mjs`'s `McpClient` tests it.
- **Launch command:** the installed app's own binary runs the bridge in Node mode, so users do not
  need Node: `ELECTRON_RUN_AS_NODE=1 <ClipCraft executable> <resources>/app.asar.unpacked/electron/agents/external/bridge.cjs`
  (the bridge goes in `asarUnpack`). In development it is `node electron/agents/external/bridge.cjs`.
  Settings shows the exact command for this install, with copy buttons for both agents:
  - Claude Code: `claude mcp add clipcraft --env ELECTRON_RUN_AS_NODE=1 -- "<exe>" "<bridge>"`
  - Codex: a `[mcp_servers.clipcraft]` block for `~/.codex/config.toml` (command, args, env).

### The one-agent lock (main)

`electron/agents/external/session.cjs` owns one lock, `editorOwner`. Its value is null,
`{ kind: 'craftai', requestId }` or `{ kind: 'external', connectionId, client }`.

- An external session takes the lock on its first tool call. It releases it when the bridge
  disconnects, when the user presses **Disconnect**, or after 30 minutes without calls (the same
  inactivity limit as native runs).
- A second bridge gets `"ClipCraft is connected to <client name>. Disconnect it in ClipCraft
  first."` on every call until the lock is free. It retries on each call, so it takes over once the
  first one leaves.
- `agent:runNative` and `agent:step` take the same lock. While an external agent holds it, CraftAI's
  Send is disabled and says which agent is connected. While CraftAI runs, external calls get
  "CraftAI is editing; retry when it finishes."
- First connection from a client name the user has not approved shows an in-app prompt: *Allow
  "Claude Code" to edit projects in ClipCraft?* Allow / Deny. Approved names are stored in settings
  and can be removed.

## The same treatment as the native agent

### Phase 0 extraction (no behavior change)

Three pieces now inside the native path become shared, so both paths run the same code:

1. **Renderer tool host:** `src/features/agent/toolHost.js` takes `execute`, `remember`, `verify`,
   the failure map, visual requirements and the serialized queue out of `runNativeAgent.js`.
   `createToolHost({ ctx, requestId, tools, catalog, contents, onEvent })` returns
   `{ execute(call), settled(), changed() }`. `runNativeAgent` becomes a thin caller.
2. **Agent context:** `makeAgentCtx(...)` builds the `ctx` object currently assembled in
   `CraftPilot.jsx` (guarded `getProject`/`dispatch`, `editActive`, `undoOwn`, `addProbed`,
   `startExport`, `settle`, `api`). CraftPilot and the external host both use it.
3. **Result builder (main):** `electron/agents/toolResult.cjs` takes the `onTool` body of
   `agent:runNative`: argument validation, alias mapping, run report, contact sheet or frame
   selection, JPEG blocks, `markPresented`. Native runs and external calls both call it.

Acceptance for phase 0: the native unit suites, the parity test and the real-app native check
pass unchanged.

### Tools offered

- **Editor tools:** exactly `nativeTools(provider)`: every tool group, `complete_edit` and
  `retry_of`, built with `contract.cjs` `wireTools`. The only rules that change the list are in one
  function, `externalCapabilities(settings)`:
  - `generate_image`/`generate_images` only when ClipCraft has a signed-in image provider (Codex),
    the same rule as today;
  - the user's own MCP servers (`external` group) are **not** re-exported. The outside agent can
    connect them itself, and re-exporting would nest MCP calls.
- **Instructions:** `nativeSystemPrompt()` is sent as the MCP `initialize` `instructions`, the same
  text native agents get through their system channel. The live revision line
  (`nativeRequestContext`) is returned by `get_status` and in every `get_project` result.
- **Results:** the same JSON text plus labelled JPEG image blocks, the same `isError`, the same
  six-image limit. The tool call timeout (15 minutes) comes from `contract.cjs` `LIMITS`.

### Edit boundaries without a chat request

In CraftAI, one user message is one agent edit (`beginAgentEdit`/`endAgentEdit`): one undo group,
one completion check, one call budget. Externally there are no messages, so:

- An edit opens on the first call that changes the project. It closes when `complete_edit` returns
  `ready: true`: the user can undo it as one step, and the next change opens a new edit.
- The call budget (`LIMITS.toolCallsPerRequest`, 300) counts per edit, not per connection.
- If the user changes the timeline during an edit, the current call fails with the existing
  interruption error ("The project changed… continue from the current timeline"), and the next call
  starts a fresh edit. The session stays connected.
- Nothing can make an outside agent call `complete_edit`. If it disconnects or goes idle with an
  open edit, the changes are kept (and undoable), and the activity panel marks the edit **not
  validated**. Every change result carries `validation_pending: true` until `complete_edit` passes.

### Project management tools (new, external only)

They run in `App.jsx`, through the same functions Home uses. The current project is always flushed
first (`flushAutosave`), as when the user leaves it.

| Tool | Does | Notes |
|---|---|---|
| `get_status` | screen (home/editor), open project (id, name, file, revision, save state), connected client, running export | first call an agent should make |
| `list_projects` | Home's merged list: autosave slots and file recents, newest first (id, name, format, file, modified, open) | the same list Home shows |
| `create_project` | `{ format, fps?, name? }`, format being one of Home's five presets | `startNewProject` |
| `open_project` | `{ id }` from `list_projects`, or `{ path }` to an existing `*.clipcraft.json` | `pickSlot` / `openRecent`; a path joins the known project files only after the user allows it |
| `save_project` | saves to the project's file; `{ path }` saves to a new `.clipcraft.json` (parent folder must exist, never overwrites another file) | no dialog: the agent gives the path |
| `close_project` | back to Home | flushes autosave |

Editor tools return "No project is open. Call `list_projects` and `open_project`, or
`create_project`." on Home. Switching projects ends the open edit, as switching does today.
Deleting projects stays a user action on Home.

### What the user sees

- **Connection indicator** in the top bar and on Home: "Claude Code connected", with Disconnect.
- **Activity:** external calls send the same tool events CraftAI shows (`describeToolActivity`,
  progress) to a read-only session in the CraftAI panel named after the client, saved with the
  project's chats. The user can watch every step and undo any edit.
- **Settings > Agents > External agents:** on/off, status, approved clients (remove), the launch
  commands with copy buttons.

## Phases

0. **Extract** the tool host, agent context and result builder (above). No behavior change.
1. **Endpoint and lock:** socket server, token, endpoint file, setting (off by default), the
   one-owner lock shared with CraftAI, client approval prompt. Renderer `externalHost.js` mounted
   from `App.jsx` (not CraftPilot, which only exists in the editor and is keyed per project).
   Editor tools only, on the open project.
2. **Bridge:** stdio MCP server, cached manifest, reconnect, "not open" errors, cancel and
   progress, Claude Code and Codex launch commands. Check that `ELECTRON_RUN_AS_NODE` runs the
   unpacked bridge in a packaged dev build (a check build only, no release packaging).
3. **Project tools:** the six tools above, plus edit boundaries (open on change, close on
   `complete_edit`, interruption, per-edit budget).
4. **UI:** indicator, Disconnect, activity session, CraftAI disabled while connected, Settings
   section.
5. **Verification in the real app** (below), then the user docs in `docs/agents/external-mcp.md`
   and `project-structure.md` (`npm run test:structure`).

## Verification

- `tests/unit/agents/test-external-bridge.mjs`: against a fake app socket: app closed, then open,
  then restarted mid-session; wrong token refused; a second client refused, then taking over after
  the first leaves; cancel reaches the job; progress forwarded; protocol version negotiation.
- `tests/unit/agents/test-agent-parity.mjs` extended: the external tool list, schemas and
  instructions equal the native ones apart from `externalCapabilities` (no `external` group,
  image tools by sign-in). The test fails on any other difference.
- `tests/unit/agents/test-external-mcp-ui.cjs` (real dev app, `McpClient` through the bridge):
  `create_project` → `import_media` (fixture) → `add_text` → `complete_edit` until ready → one undo
  removes the whole edit → `save_project` to a temp path → `close_project` → `open_project` brings
  it back at the same revision. While connected, CraftAI Send is disabled. A CraftAI run blocks
  external calls. A user edit during an external edit gives the interruption error, and the next
  call continues.
- **Real agents** (manual, needs accounts): the same small request through Claude Code and Codex
  connected over the bridge, compared in `agent-runs.jsonl` with the in-app native run of the same
  request. Acceptance: no failure class that occurs on the external path only.
- Battery: the new suites pass, so the baseline moves from 79/6 to 81 PASS / 6 FAIL (87 files).
  The commit says so.

## Acceptance

- With the setting on and the app open, `claude mcp add …` (or the Codex config) connects, lists
  the native tool list plus the six project tools, and completes an edit that the user can undo as
  one step.
- App closed: the bridge starts, lists tools, and every call says to open ClipCraft. App reopened:
  the next call works without restarting the agent.
- Never two editors at once: a second external agent and CraftAI are both refused with a message
  naming who holds the editor.
- One implementation: the parity test passes, and `runNativeAgent` and the external host share
  `toolHost.js` and `toolResult.cjs`.

## Decisions to confirm

1. **Off by default, approve each client once:** recommended, since an external agent can import
   files and write exports.
2. **Do not re-export the user's MCP servers:** recommended (see Tools offered).
3. **External activity saved as a chat session in the project:** recommended, so the user can see
   later what an outside agent did.
4. **`save_project` with a path writes without a dialog:** limited to new `.clipcraft.json` files
   in existing folders, and never overwrites another file.
