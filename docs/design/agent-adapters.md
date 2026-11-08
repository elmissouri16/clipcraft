# One tool contract, one adapter per agent

Status: phases 0–2 done, phase 3 next (2026-11-08). Branch: `feat/agent-adapters`.

## Goal

Codex and Claude get **the same tools, the same access and the same treatment of every call**.
ClipCraft owns one tool contract; each agent gets a thin adapter that only translates the wire
format. The one intended difference is image generation (Codex only). Anything else that differs
is a bug, and a parity test fails on it.

Out of scope: guidance for particular kinds of videos, extra examples or prompt rules aimed at one
genre. Results improve by making the shared tools behave well, not by steering the model.

## What is already the same (verified)

- **Tool list:** every group is loaded for both (`runNativeAgent.js`): 72 editor tools plus
  `complete_edit`. Codex also gets `generate_image`/`generate_images`.
- **Schemas:** each tool's JSON Schema, after going through Claude's SDK MCP server (Zod), matches
  what Codex receives: 72 of 72 tools, no lost descriptions, enums, `required` fields, item types
  or limits. Checked by listing the tools back through an MCP client.
- **Execution:** one renderer runner (`createToolRunner`), one completion check, one serialized
  queue, one result builder in `main.cjs` (JSON text plus labelled JPEG frames).
- **Result size:** no tool result in the last Claude or Codex project came near Claude's MCP output
  cap. The largest was about 35k characters (Codex `get_project`).

## What differs today

| # | Area | Codex | Claude | Effect |
|---|---|---|---|---|
| 1 | Turn budget | no limit | `maxTurns: 100` per attempt | a long edit (Codex runs reached 144 calls) gets cut short on Claude |
| 2 | Provider built-ins | features off by flag; whatever app-server still exposes (to inventory: plan/todo, image viewing, patching under a read-only sandbox) | `tools: []`, nothing (no todo list) | access level not equal, and nobody tracks which built-ins remain |
| 3 | Instructions | `baseInstructions` **and** the same text again in every turn's prompt | `systemPrompt` **and** the same text again in every turn's prompt | duplicated text for both; delivered by different routes |
| 4 | Tool call timeout | none on the ClipCraft side | 15 min (MCP server) | a long render can fail on Claude only |
| 5 | Conversation memory | in-memory thread, lost on restart (then history replay) | persisted SDK session, resumed | different memory after a restart |
| 6 | Tool names | `add_text` | `mcp__clipcraft__add_text` | error text names tools that do not match what Claude sees |
| 7 | Error results | `success: false` | `isError: true` | equivalent; keep, but specified in one place |
| 8 | Web research | setting, default on | setting, default off | intended: one switch each (just shipped) |
| 9 | Image generation | yes | no | intended |

## Shared tool behavior that costs a literal-minded agent most

From the last Claude run (TV brands, 101 calls, 35 failed). These are flaws in the shared tools,
so fixing them helps both agents:

- **Completion check deadlock** (13 failed `complete_edit` calls, about 50 calls lost):
  - a failure from the wrong tool (`set_animation` on a title) cannot be cleared by the right tool
    (`edit_text`);
  - the error does not list operation IDs or say how to clear them;
  - a failure whose clip was deleted can never clear.
- **Error text that names the problem but not the tool:** `set_animation` on a title should say
  "titles animate with `edit_text` `anim_in`/`anim_out`".
- **Needless rejections:**
  - font names are case-sensitive ("Montserrat" refused although "montserrat" exists);
  - titles and clips use different names for the same animation (`fade` vs `fade_in`);
  - a keyframe error doesn't state the clip's timeline range.
- **Graphics cache:** no size limit; 13 GB on disk filled the drive and failed renders for both agents.

## Design

### The contract (one module, provider-neutral)

`electron/agents/contract.cjs` (main) with its renderer half in `runNativeAgent.js`:

- `tools`: name, description, JSON Schema. Built once per request from `TOOL_DECLARATIONS` and the
  user's MCP tools, then filtered **only** by `capabilities`.
- `instructions`: the one system text (shared prompt, live revision, web research line from
  `research.cjs`). Delivered once per session through the adapter's system channel; each turn
  carries only the user request and context.
- `capabilities`: `{ imageGeneration, webResearch }` computed in one function from provider and
  settings. The only place a provider name may change what is offered.
- `limits`: one set for both agents: tool calls per request, tool call timeout, completion
  attempts, images per result. Enforced by the host, not by provider options: the host counts calls
  and answers past the budget with a clear error; provider limits (`maxTurns`) are set above the
  host budget so they never trigger first.
- `call(name, args) → { text, images[], isError }`: validation, execution, completion check,
  operation IDs, events. Already shared; it moves behind this interface unchanged.
- `history`: one policy. Each request carries the same prepared history to both agents; provider
  sessions are a cache that may be dropped at any time without changing what the agent knows.

### The adapters (wire format only)

`electron/agents/adapters/codex.cjs` and `electron/agents/adapters/claude.cjs`, each implementing:

- `start({ instructions, tools, capabilities, limits })`: Codex `thread/start` with `dynamicTools`;
  Claude `createSdkMcpServer` + `query` options.
- `send({ prompt, images })` → final text, token usage.
- `onToolCall(name, args)` → `contract.call` → `toWire(result)`: Codex `contentItems`, Claude MCP
  `content` blocks.
- `onSearch` → the shared search event.
- `stop()`, `dispose()`.

Adapters may not add, drop or rename tools, add instructions, or apply their own limits. The tool
name prefix Claude sees is mapped back in the adapter, and error text uses the bare names.

### Built-ins: zero for both, then the same additions

- Both agents start with **no provider built-ins**. For Codex, every remaining app-server built-in
  is listed in phase 0 and switched off, or the session is refused if one cannot be.
- Anything useful from a built-in becomes a ClipCraft tool given to both. Example: a task list
  (`update_plan`) shown in the chat, if phase 0 finds Codex uses one.
- Web research stays the only provider built-in, behind the same switch for both.

## Phase 0 results: what each agent sends its model

`node scripts/agent-inventory.mjs` runs the installed agents through ClipCraft's own launch code
against a local fake model API (`tests/fixtures/fake-model-server.cjs`), with temporary config
folders: no account, token or network. Results on Codex CLI 0.167.0 and Claude Code 2.1.319:

| | Codex | Claude |
|---|---|---|
| ClipCraft tools | 74 (72 shared + 2 image) | 72, full schemas (only Claude Code's own placeholder is deferred) |
| Provider built-ins | `view_image` (any local image file), `request_user_input` (Plan mode only) | none |
| Web research | `web_search` (switch) | `WebSearch`, `WebFetch` (switch) |
| ClipCraft instructions | developer message, and again in the first user message | system text, and again in the first user message |
| Provider wrapper text | sandbox permissions note, environment block | 62-character SDK line, environment block |
| Request options | parallel tool calls, reasoning summary, model's default effort | adaptive thinking, effort high by default, 32k max tokens |
| Limits | none | 100 turns per attempt |

Also found: Codex features that ClipCraft does not switch off are still active in its sessions
(`experimentalFeature/list`): browser use, computer use, image viewing, a sleep tool, tool
suggestions and others, and `unified_exec` remains on although ClipCraft passes
`unified_exec=false`. None of them reaches the model as a tool except `view_image` and
`request_user_input`, but phase 2 switches them off explicitly so a Codex update cannot expose them.

Every native request now appends a line to `<userData>/logs/agent-runs.jsonl`
(`electron/agents/runReport.cjs`): provider, model, web research, calls and failures per tool,
completion check failures, duration, tokens, outcome. Counts only.

## Phase 1 results

- `electron/agents/contract.cjs`: the wire tool list (JSON Schema, wire names, `retry_of`).
- `runNativeAgent.js` exports `nativeTools(provider)` and `nativeSystemPrompt(revision)`: the one
  tool list and instruction text, used by the app and the inventory.
- `electron/agents/adapters/codex.cjs` and `adapters/claude.cjs`: each starts its agent with the
  shared tools, runs one turn and closes. `nativeAgents.cjs` is the session manager (session reuse,
  request prompt, completion re-prompt, duplicate callbacks, redaction) for both.
- Verified unchanged: the inventory before and after the refactor is identical for both agents
  (tools, instruction text, request options); native unit suites and the real-app native check
  (`tests/unit/agents/test-native-agents-ui.cjs`) pass.

## Phase 2 results

- **Built-ins:** every Codex feature that can put a tool in front of the model is switched off
  (`CODEX_FEATURES_OFF` in `codexNative.cjs`, also used by the step path), including `view_image`.
  Codex 0.167 still offers `request_user_input` (no switch exists; inert outside Plan mode, and
  ClipCraft refuses it) and keeps `unified_exec` on internally, with no tool reaching the model.
- **Limits:** `contract.cjs` `LIMITS`: 300 tool calls per request (`complete_edit` always allowed),
  15 minutes per call, 3 completion attempts, 6 images; enforced by the session manager for both
  agents. Claude's own `maxTurns` and MCP timeout sit above them.
- **Instructions once:** `nativeSystemPrompt()` is fixed text sent once per session through the
  system channel (with the web research line); `nativeRequestContext(revision)` travels with each
  request. Neither agent sees the instructions repeated in the request any more.
- **Identical tool text:** Claude's tool server lists the contract's JSON Schemas directly (its Zod
  round trip added ±2^53 bounds to every integer field). The contract writes text and schemas both
  transports carry unchanged: three-dot ellipses (Claude rewrote `…`) and limits as description
  text, since Codex drops `maxItems`. The renderer still validates calls against the original limits.
- **Memory:** already one policy: sessions live in memory for both, and a fresh session (new
  settings, restart, error) receives the prepared chat history.
- **Tool names:** Claude's `mcp__clipcraft__` prefix comes from the SDK and cannot be removed; all
  ClipCraft text uses bare names, which both agents map.
- **Verified at the wire:** `tests/unit/agents/test-agent-parity.mjs` runs both installed agents
  against the fake model API and fails on any difference in ClipCraft tools, descriptions, schemas,
  instruction text or placement, request context, or unexpected built-ins (skips when an agent is
  not installed). `test-agent-limits.mjs` covers the limits.

## Phases

0. **Inventory (no behavior change).**
   - Log the tool list each agent actually exposes per turn: Codex app-server items and tool
     names; Claude's `system/init` message tools.
   - Record turn counts, call counts and failures per run in a run report
     (`<userData>/logs/agent-runs.jsonl`: provider, model, calls, failed calls, completion
     failures, duration, tokens; no prompt text).
1. **Contract and adapters.** Move the existing code behind the interfaces above: `nativeAgents.cjs`
   becomes the session manager, `codexNative.cjs` the Codex adapter, the Claude half moves out.
   Behavior unchanged; the existing tests pass untouched.
2. **Align the differences** (table rows 1–6):
   - one host budget and one tool call timeout;
   - instructions sent once, through the system channel;
   - zero built-ins plus shared replacements;
   - one history policy;
   - bare tool names in all text.
3. **Shared tool fixes** (behavior, no new instructions):
   - completion check errors list each operation ID with how to clear it;
   - any call naming a failure in `retry_of` clears it;
   - failures on deleted clips clear;
   - errors name the right tool;
   - font names in any case, animation name aliases, keyframe range in errors;
   - graphics cache limit with Settings size and Clear.
4. **Parity tests** (`tests/unit/agents/test-agent-parity.mjs`, using the Codex protocol fixture
   and the real Claude SDK MCP server with a stubbed model):
   - same tool names (apart from the image capability) and identical schemas after transport;
   - identical instructions text;
   - the same call gives the same result payload, text and images;
   - same limits and timeouts, same web and image gating, same completion behavior;
   - a scripted call sequence played through both adapters ends at the same project revision.
5. **A/B in the real app.** The same request (with a reference video) through both agents; compare
   run reports. Acceptance: no failure class that occurs on one agent only, and no completion check
   loop longer than two calls.

## Acceptance

- One function decides what each agent is offered; image generation is its only provider-specific
  rule (web research follows the switch).
- The parity test runs in the battery and fails on any added, missing or changed tool, schema,
  instruction text, limit or result shape between the adapters.
- Run reports exist for both agents, so "worse" is measured, not guessed.
