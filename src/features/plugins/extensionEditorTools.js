// The editor's own editing tools for extensions (context.editor.tools). These are the tools CraftAI
// and outside MCP agents use (src/features/agent/tools.js), run by the same validating runner: every
// write is simulated against the reducer first and refused if it would break the timeline.
// One run() is one edit: it opens an agent edit, runs its calls in order and closes it, so the user
// undoes the whole batch in one step. With atomic (the default) a failing call rolls the batch back.
import { externalTools, PROJECT_TOOLS } from '../agent/externalHost.js';
import { createToolRunner } from '../agent/tools.js';
import { makeAgentCtx } from '../agent/agentCtx.js';
import { validateToolCall } from '../../../shared/toolArguments.mjs';
import { sameDoc } from '../../state/projectFile.js';

// Not offered: project management, the agent's own bookkeeping, running other extensions (an
// extension composes those through commands and services), and Undo (a batch is its own Undo step).
const EXCLUDED = new Set([...PROJECT_TOOLS.map((tool) => tool.name), 'complete_edit', 'load_tools', 'recall_context',
  'delegate_video_analysis', 'list_plugin_commands', 'run_plugin_command', 'undo']);
export const EDITOR_TOOL_LIMITS = { calls: 64, resultBytes: 512 * 1024 };
const BUSY = 'The editor is busy with another edit (CraftAI, an outside agent or a drag). Retry in a moment.';

// app(): { screen(), project(), loadVersion(), dispatch, settle, pilotApp, craftBusy() } (App.jsx).
export function createExtensionEditorTools(app) {
  let queue = Promise.resolve();
  const declarations = () => externalTools('').tools.filter((tool) => !EXCLUDED.has(tool.name) && !tool.name.startsWith('mcp_'));
  const list = () => declarations().map(({ name, description, parameters }) => ({ name, description, parameters }));

  async function execute(input, check) {
    const host = app();
    if (!input || typeof input !== 'object' || !Array.isArray(input.calls) || !input.calls.length || input.calls.length > EDITOR_TOOL_LIMITS.calls) throw new Error(`Run 1 to ${EDITOR_TOOL_LIMITS.calls} editor tool calls at a time.`);
    const tools = declarations(), atomic = input.atomic !== false;
    // Every call is checked before anything is written.
    const calls = input.calls.map((call, index) => {
      if (!call || typeof call !== 'object' || typeof call.name !== 'string' || (call.args !== undefined && (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)))) throw new Error(`Editor tool call ${index + 1} needs a name and an args object.`);
      if (!tools.some((tool) => tool.name === call.name)) throw new Error(`Unknown editor tool "${call.name}". Use editor.tools.list() for the available tools.`);
      const args = call.args || {}, error = validateToolCall({ name: call.name, args }, tools);
      if (error) throw new Error(`${call.name} (call ${index + 1}): ${error}`);
      return { name: call.name, args };
    });
    if (host.screen() !== 'editor') throw new Error('No project is open.');
    if (host.craftBusy() || host.pilotApp.getAgentEdit?.()) throw new Error(BUSY);
    await check?.();
    const token = crypto.randomUUID(), before = host.project(), loadVersion = host.loadVersion();
    host.dispatch({ type: 'beginAgentEdit', token });
    await host.settle();
    if (host.pilotApp.getAgentEdit?.()?.token !== token) throw new Error(BUSY);
    let stopped = false, failure = null;
    const isCurrent = () => app().screen() === 'editor' && app().project().id === before.id && app().loadVersion() === loadVersion;
    const ctx = makeAgentCtx({ app: host.pilotApp, provider: '', getProject: () => app().project(), dispatch: host.dispatch, settle: host.settle, requestId: token, isCurrent, isStopped: () => stopped });
    const runner = createToolRunner({ ...ctx, requestId: token, isCanceled: () => stopped || !isCurrent() });
    const results = [];
    try {
      for (const [index, call] of calls.entries()) {
        let result;
        try { await check?.(); result = await runner.run(call.name, call.args); await host.settle(); }
        catch (error) { result = { error: error.message }; }
        if (!result || typeof result !== 'object') result = { error: 'The tool returned no result.' };
        if (JSON.stringify(result).length > EDITOR_TOOL_LIMITS.resultBytes) result = { error: 'The tool result is too large to return to an extension.' };
        results.push(result);
        // A user edit during the batch ends the agent edit: stop there and say so.
        if (!ctx.editActive()) { failure = { index, name: call.name, error: 'The project was changed by the user during this edit.', interrupted: true }; break; }
        if (result.error && atomic) { failure = { index, name: call.name, error: result.error }; break; }
      }
      if (failure && atomic && !failure.interrupted) while (ctx.undoOwn()) await host.settle();
    } finally {
      stopped = true;
      app().dispatch({ type: 'endAgentEdit', token });
      await app().settle();
    }
    if (failure && (atomic || failure.interrupted)) throw new Error(`Editor tool ${failure.name} (call ${failure.index + 1}) failed: ${failure.error}${atomic && !failure.interrupted ? ' Nothing from this run was kept.' : ''}`);
    return { results, changed: isCurrent() && !sameDoc(before, app().project()) };
  }

  return {
    list,
    // One run at a time: edit boundaries never interleave.
    run(input, check) { const task = queue.then(() => execute(input, check)); queue = task.catch(() => {}); return task; },
  };
}
