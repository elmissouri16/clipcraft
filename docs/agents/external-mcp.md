# External agents over MCP

An agent you run outside ClipCraft, such as Claude Code, Codex or any MCP client, can edit in
ClipCraft while the desktop app is open. It gets the same editor tools and instructions as
CraftAI's native agents, plus tools to open, create, save and close projects. No model runs inside
ClipCraft for these sessions. Design and decisions: [`docs/design/external-agent-mcp.md`](../design/external-agent-mcp.md).

## Turning it on

1. Open **Settings > External agents** and switch on **Allow external agents** (off by default).
2. Copy the setup for your agent from the same page. It names this install's binary and folder:
   - **Claude Code:** `claude mcp add clipcraft -s user -e ELECTRON_RUN_AS_NODE=1 -- "<ClipCraft binary>" "<bridge.cjs>" "--dir" "<userData>/mcp"`
   - **Codex:** a `[mcp_servers.clipcraft]` block for `~/.codex/config.toml`, with
     `tool_timeout_sec = 900` because exports and renders can take minutes.
   - **Other clients:** the usual `mcpServers` JSON.
3. The first call from a new agent asks you in ClipCraft: **Allow** or **Don't allow**. Allowed
   agents are listed in Settings and can be removed there.

The command runs ClipCraft's own binary in Node mode (`ELECTRON_RUN_AS_NODE=1`), so no separate
Node install is needed. In development, `node electron/agents/external/bridge.cjs --dir <folder>`
works too.

## How it behaves

- **App closed:** the MCP server still starts and lists the tools ClipCraft last offered; every call
  says to open ClipCraft. Open the app and the next call works without restarting the agent.
- **One agent at a time:** the first agent that makes a call holds the editor until it disconnects,
  you press **Disconnect** (top bar, Home, the CraftAI panel or Settings), or it makes no calls for
  30 minutes. Another agent is refused with the name of the one connected.
- **CraftAI pauses** while an outside agent holds the editor, and outside agents are refused while
  CraftAI is running a request.
- **Edits:** an edit starts with the agent's first change and ends when `complete_edit` accepts it.
  Each accepted edit is one Undo step. If you change the project during an agent's edit, its next
  call is told so, and the call after that continues from the current timeline.
- **Activity:** the CraftAI panel shows the agent's steps in a read-only conversation named after
  it, saved with the project.

## Tools

The six project tools come first, then the native editor list (`nativeTools()` in
`src/features/agent/runNativeAgent.js`):

| Tool | Does |
|---|---|
| `get_status` | Home or editor, the open project (id, name, file, revision, save state), whether CraftAI is busy, whether an edit awaits `complete_edit` |
| `list_projects` | Home's projects, newest first, each with an id for `open_project` |
| `create_project` | a new project in one of Home's five formats (16:9, 9:16, 1:1, 4:5, 21:9) |
| `open_project` | by id from `list_projects`, or by the path of a `.clipcraft.json` |
| `save_project` | to the project's file, or with `path` to a new `.clipcraft.json` (never overwrites another file) |
| `close_project` | back to Home |

Image generation is offered only when CraftAI's assistant is Codex (it needs that sign-in). Your
own MCP tool servers from Settings are not passed on; connect them to the outside agent directly.

## Where things live

- `electron/agents/external/bridge.cjs`: the stdio MCP server the agent starts.
- `electron/agents/external/endpoint.cjs`: the app's local socket (`<userData>/mcp`, user-only),
  the token, the one-agent lock, approval and timeouts.
- `electron/agents/external/host.cjs`: routes calls to the renderer and back through
  `electron/agents/toolResult.cjs`, the result builder native agents use.
- `src/features/agent/externalHost.js`: project tools and edit boundaries, running editor calls
  through `toolHost.js`, the same tool host as native agents.

## Tests

- `tests/unit/agents/test-external-bridge.mjs`: bridge and endpoint in plain Node.
- `tests/unit/agents/test-external-contract.mjs`: same tools, schemas, instructions and limit as
  the native agents; refusals on Home and while CraftAI runs.
- `tests/unit/agents/test-external-agents-ui.cjs` (`FVE_SMOKE_MODE=external-agents`): the real app
  with an agent connected through the bridge.
