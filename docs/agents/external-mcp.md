# External agents over MCP

An agent you run outside ClipCraft, such as Claude Code, Codex or any MCP client, can edit in
ClipCraft while the desktop app is open. It gets the same editor tools and instructions as
CraftAI's native agents, plus tools to open, create, save and close projects. No model runs inside
ClipCraft for these sessions. Design and decisions: [`docs/design/external-agent-mcp.md`](../design/external-agent-mcp.md).

## Turning it on

1. Open **Settings > External agents** and switch on **Allow external agents** (off by default).
   ClipCraft then serves MCP at `http://127.0.0.1:39217/mcp`, for this computer only and only to
   agents that send its key.
2. Under **Agents on this computer**, press **Install** next to Claude Code, Codex or OpenCode
   (shown when ClipCraft finds it). It adds ClipCraft to that agent's own user settings, for all its
   projects. Start a new session of the agent to load the tools. **Remove** takes it out again.
   For any other MCP client, **Copy setup** gives the address and key as `mcpServers` JSON.
3. The first call from a new agent asks you in ClipCraft: **Allow** or **Don't allow**. Allowed
   agents are listed in Settings and can be removed there.

## How it behaves

- **App closed or switch off:** the agent cannot connect. Open ClipCraft, then reconnect the server
  in the agent (Claude Code: `/mcp`) or start a new session.
- **One agent at a time:** the agent that makes a call holds the editor. While it works (a call
  running, or one in the last 2 minutes) other agents are refused with its name and CraftAI waits.
  Once it has been idle for 2 minutes, another agent or CraftAI can take over. **Disconnect** (top
  bar, Home, the CraftAI panel or Settings) ends its session at once.
- **CraftAI comes first** while it is running a request: outside agents are refused until it ends.
- **Edits:** an edit starts with the agent's first change and ends when `complete_edit` accepts it.
  Each accepted edit is one Undo step. If you change the project during an agent's edit, its next
  call is told so, and the call after that continues from the current timeline.
- **Activity:** the CraftAI panel shows the agent's steps in a read-only conversation named after
  it, saved with the project. The timeline shows its work as it shows CraftAI's: the clips and range
  the running tool works on are spotlit with a "<agent> · <tool>" chip, and each finished change leaves
  a trail that fades a few seconds after the edit ends (docs/agents/agent-editing.md).

## Tools

Use these tools to find, open and save projects. Once a project is open, the agent can also call the [native editing tools](native-agent-tools.md).

| Tool | What it does |
|---|---|
| `get_status` | Reports whether ClipCraft is on Home or in the editor. Includes the open project's ID, name, file, revision and save state, plus CraftAI activity and any edit awaiting `complete_edit`. |
| `list_projects` | Lists projects on Home, newest first. Pass a returned ID to `open_project`. |
| `create_project` | Creates a project in 16:9, 9:16, 1:1, 4:5 or 21:9 format. |
| `duplicate_project` | Opens an independent copy of the current project. Supply `name` to give the copy a title. Both projects appear on Home. |
| `open_project` | Opens a project by ID or by the path to its `.clipcraft.json` file. |
| `save_project` | Saves to the current file. Supply an unused `path` to save a new file. ClipCraft keeps the conversation beside it in a [chat sidecar](../architecture/project-file.md). |
| `close_project` | Closes the current project and returns to Home. |

To reuse an edit, ask your agent, “Open Episode 1, duplicate it as Episode 2, and work on Episode 2.”
The copy has its own autosave and starts a fresh CraftAI conversation. Both projects reference the
same source media. To keep a project file for the copy as well, call `save_project` with a new path.

Image generation is offered only when CraftAI's assistant is Codex (it needs that sign-in). Your
own MCP tool servers from Settings are not passed on; connect them to the outside agent directly.

## Where things live

- `electron/agents/external/endpoint.cjs`: the MCP server (Streamable HTTP on 127.0.0.1), the key,
  host and browser checks, the one-agent lock, approval and timeouts.
- `electron/agents/external/install.cjs`: finding Claude Code, Codex and OpenCode and writing
  ClipCraft into their settings.
- `electron/agents/external/host.cjs`: routes calls to the renderer and back through
  `electron/agents/toolResult.cjs`, the result builder native agents use.
- `src/features/agent/externalHost.js`: project tools and edit boundaries, running editor calls
  through `toolHost.js`, the same tool host as native agents.

## Tests

- `tests/unit/agents/test-external-endpoint.mjs`: the server with the MCP SDK's HTTP client.
- `tests/unit/agents/test-external-install.cjs`: the real agent CLIs in a temporary home, including
  a real Claude Code health check against the server.
- `tests/unit/agents/test-external-contract.mjs`: same tools, schemas, instructions and limit as
  the native agents; refusals on Home and while CraftAI runs.
- `tests/unit/agents/test-external-agents-ui.cjs` (`FVE_SMOKE_MODE=external-agents`): the real app
  with an agent connected over HTTP, and Install for Claude Code.
