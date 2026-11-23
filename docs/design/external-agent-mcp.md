# External agents over MCP: ClipCraft as a tool server

Status: implemented on `feat/external-mcp` (2026-11-09); user guide in
[`docs/agents/external-mcp.md`](../agents/external-mcp.md). Verified with the real Claude Code
2.1.319 (it connects to the running app with what Install writes), Codex 0.167.0 (it reads the
written server) and OpenCode 2.2.6 (its CLI writes the entry). Not yet done: a full editing session
driven by a real agent, and a packaged build. The four decisions below were taken as recommended.

Changes from the plan while building it:

- **HTTP inside the app instead of a stdio bridge** (after review): a bridge needed a long,
  install-specific command (binary path, script path, Node mode). Now ClipCraft serves Streamable
  HTTP on `127.0.0.1` and an agent is configured with a URL and a key, written by an Install button
  for Claude Code, Codex and OpenCode. The cost: with the app closed the agent cannot connect at all
  (no "open ClipCraft" answer), and an agent that quits leaves no connection to notice, so the lock
  became "held while working, replaceable when idle" (below).
- `open_project` with a path does not ask again: allowing the agent covers opening its files.
- The tool list check is its own suite (`test-external-contract.mjs`) instead of an extension of
  `test-agent-parity.mjs`, which skips when no agent is installed.
- A read that leaves nothing to validate closes its edit at once, so the user's own edits between
  an agent's reads never count as interruptions.

## Goal

An agent running **outside** ClipCraft (Claude Code, Codex CLI, any MCP client) connects to the
open desktop app and edits exactly as the built-in native agent does: **the same tools, the same
validation, the same completion check, the same undo grouping**, plus tools to manage projects. No
model runs inside ClipCraft for these sessions; the outside agent supplies the reasoning.

Rules:

- Works only while the desktop app is open with the setting on.
- **One agent at a time.** Only one external agent session holds the editor. It cannot run while
  CraftAI (the in-app agent) is running a request, and CraftAI cannot start while it is working.
- Off by default. The user turns it on in Settings and approves each new client once.
- No second tool implementation. External sessions reuse the native path (`runNativeAgent.js`,
  `contract.cjs`, the result builder in `main.cjs`). Any difference from the native agents is a bug,
  the same rule as in `agent-adapters.md`.

Out of scope: running a model for the external session, remote (network) access, more than one
connected agent, and changing settings, app updates, MCP server config or deleting projects from
outside.

## How it connects

```
outside agent ──Streamable HTTP + key──▶ ClipCraft main (127.0.0.1:39217/mcp) ──IPC──▶ renderer tool host
 (Claude Code,                            (lock, approval, limits,                    (createToolRunner,
  Codex, OpenCode, …)                      result builder)                             completion check)
```

- **Endpoint** (`electron/agents/external/endpoint.cjs`, no Electron imports): the MCP SDK's
  Streamable HTTP transport and low-level `Server`, one session per agent, on `127.0.0.1` at the
  port in settings (39217 by default). Only local MCP clients get in: the `Host` header must be this
  server (no DNS rebinding), requests with an `Origin` (browsers) are refused, and every request
  needs `Authorization: Bearer <key>`. The key is created once and kept in settings; it never goes
  to the renderer except in "Copy setup" for other clients. Cancel (`notifications/cancelled`) and
  progress (`_meta.progressToken`) map onto the existing job abort and render progress; tool list
  changes reach open sessions as `notifications/tools/list_changed`.
- **Install** (`electron/agents/external/install.cjs`): finds each agent's CLI (the same search
  folders as the native agents, plus `~/.opencode/bin`) and writes the URL and key into its
  user-level config:
  - Claude Code: `claude mcp add --transport http -s user clipcraft <url> -H "Authorization: Bearer <key>"`
    (`~/.claude.json`, or `$CLAUDE_CONFIG_DIR`); Remove runs `claude mcp remove -s user clipcraft`.
  - Codex: a `[mcp_servers.clipcraft]` table in `config.toml` (`$CODEX_HOME` or `~/.codex`) with
    `url`, `http_headers` and `tool_timeout_sec = 900`; its CLI can only take a key from an
    environment variable. Other tables stay untouched.
  - OpenCode: `opencode mcp add --global --url <url> --header Authorization=Bearer <key> clipcraft`
    (`~/.config/opencode/opencode.json`, `mcp.servers`); it has no remove command, so Remove edits
    the JSON and keeps everything else.
  - Each row shows Not found, Not set up, Set up, or "set up for another address" (Update).

### The one-agent lock (main)

`ExternalEndpoint.owner` is the session holding the editor.

- A session takes it on its first tool call, after the user allowed its client name once.
- While it **works** (a call running, or one finished in the last 2 minutes) another agent is
  refused with its name, and CraftAI cannot start (`agent:runNative` and `agent:step` are refused,
  the panel says who is working).
- Once it is **idle**, another agent's call or a CraftAI request takes the editor over (the idle
  agent's open edit ends, its changes kept). The idle agent's next call claims it again if free.
- It ends when the agent closes its session, the user presses **Disconnect** (its session ends),
  or the setting is turned off. Sessions with no request for an hour are dropped.
- While CraftAI runs (the renderer reports it), no agent can take the editor.

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
  - plugin command discovery/execution is CraftAI-only for now; outside clients cannot load or invoke it;
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
| `duplicate_project` | `{ name? }` copies the open edit and switches to the copy | saves the source first, creates a separate Home slot and starts a fresh chat |
| `open_project` | `{ id }` from `list_projects`, or `{ path }` to an existing `*.clipcraft.json` | `loadSlot` / `loadFile` (Home's open, returning errors instead of dialogs) |
| `save_project` | saves to the project's file; `{ path }` saves to a new `.clipcraft.json` (parent folder must exist, never overwrites another file) | no dialog: the agent gives the path |
| `close_project` | back to Home | flushes autosave |

Editor tools return "No project is open. Call `list_projects` and `open_project`, or
`create_project`." on Home. Switching projects ends the open edit, as switching does today.
Deleting projects stays a user action on Home.

### What the user sees

- **Connection indicator** in the top bar and on Home: "Claude Code connected", with Disconnect.
- **Activity:** external calls send the same tool events CraftAI shows (`describeToolActivity`,
  progress) to a read-only session in the CraftAI panel named after the client, saved with the
  project's chats. The user can watch every step and undo any edit. The timeline spotlight and trail
  (docs/agents/agent-editing.md) follow the same events (`externalFocus.js`), with the client's name
  on the chip.
- **Settings > Agents > External agents:** on/off, status, approved clients (remove), the launch
  commands with copy buttons.

## Phases

0. **Extract** the tool host, agent context and result builder (above). No behavior change.
1. **Endpoint and lock:** the HTTP MCP server, key, setting (off by default), the one-owner lock
   shared with CraftAI, client approval prompt. Renderer `externalHost.js` mounted
   from `App.jsx` (not CraftPilot, which only exists in the editor and is keyed per project).
   Editor tools only, on the open project.
2. **Install:** Claude Code, Codex and OpenCode buttons; "Copy setup" for other clients.
3. **Project tools:** the six tools above, plus edit boundaries (open on change, close on
   `complete_edit`, interruption, per-edit budget).
4. **UI:** indicator, Disconnect, activity session, CraftAI disabled while connected, Settings
   section.
5. **Verification in the real app** (below), then the user docs in `docs/agents/external-mcp.md`
   and `project-structure.md` (`npm run test:structure`).

## Verification

- `tests/unit/agents/test-external-endpoint.mjs` (MCP SDK HTTP client): key, host and browser
  checks; one agent at a time, takeover after idle, CraftAI first; approval; cancel; progress;
  timeouts; tool list changes; Disconnect; restart; port in use.
- `tests/unit/agents/test-external-install.cjs`: the real CLIs, each in a temporary home: Codex
  parses the written table, OpenCode's CLI writes its entry, other servers and settings survive,
  Remove works, and the real `claude mcp list` connects to a running endpoint.
- `tests/unit/agents/test-external-contract.mjs`: the external tool list, schemas and instructions
  equal the native ones apart from `externalCapabilities`; refusals on Home and while CraftAI runs.
- `tests/unit/agents/test-external-agents-ui.cjs` (real dev app, MCP SDK HTTP client):
  `create_project` → `add_text` → `complete_edit` until ready → one undo removes the whole edit →
  user edit interrupts → `save_project` → `close_project` → `open_project`; CraftAI paused and
  refused while the agent works; a second agent refused; Disconnect; a denied agent; Install for
  Claude Code into a temporary home, then the real `claude mcp list` connects to the app; Remove;
  the switch off.
- **Real agents** (manual, needs accounts): the same request through Claude Code, Codex and
  OpenCode, compared in `agent-runs.jsonl` with the in-app native run.

## Acceptance

- With the setting on, Install for an agent and a new session of it lists the native tool list plus
  the project tools and completes an edit that the user can undo as one step.
- Never two editors at once: a working agent blocks other agents and CraftAI, with a message naming
  it; an idle one gives way.
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
