// External agents in the renderer (docs/design/external-agent-mcp.md). An outside agent's calls run
// through the same tool host as native agents (toolHost.js), with the same tools and instructions.
// There are no chat requests, so an edit opens on the first call and closes when complete_edit
// accepts it (one Undo step), when nothing is left to validate, or when it is interrupted.
import { nativeTools, nativeSystemPrompt, nativeRequestContext } from './runNativeAgent.js';
import { createToolHost } from './toolHost.js';
import { makeAgentCtx } from './agentCtx.js';
import { projectRevision } from './context.js';

const S = { type: 'STRING' };
export const PROJECT_TOOLS = [
  { name: 'get_status', description: 'ClipCraft status: Home or the editor, the open project (id, name, file, revision, save state), whether CraftAI is busy and whether an edit awaits complete_edit. Call it first.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'list_projects', description: 'The projects on ClipCraft Home, newest first: auto-saved projects and project files. Each has an id for open_project.', parameters: { type: 'OBJECT', properties: { query: { ...S, description: 'Only projects whose name contains this text.' } } } },
  { name: 'create_project', description: 'Start a new empty project and open it in the editor. The current project is saved first.', parameters: { type: 'OBJECT', properties: {
    format: { ...S, enum: ['16:9', '9:16', '1:1', '4:5', '21:9'], description: '16:9 landscape, 9:16 vertical, 1:1 square, 4:5 portrait, 21:9 ultrawide.' },
    fps: { type: 'INTEGER', enum: [24, 30, 60] }, name: { ...S, description: 'Project name.' } }, required: ['format'] } },
  { name: 'open_project', description: 'Open a project in the editor by its id from list_projects, or by the path of a .clipcraft.json file. The current project is saved first.', parameters: { type: 'OBJECT', properties: { id: S, path: { ...S, description: 'Absolute path of a project file.' } } } },
  { name: 'save_project', description: 'Save the open project to its file. Give path (absolute, ending in .clipcraft.json, in an existing folder) to save a project that has no file yet, or a copy under a new name; existing files are never overwritten. Every project is also auto-saved for Home.', parameters: { type: 'OBJECT', properties: { path: S } } },
  { name: 'close_project', description: 'Save the open project and return to Home.', parameters: { type: 'OBJECT', properties: {} } },
];
const PROJECT_NAMES = new Set(PROJECT_TOOLS.map((tool) => tool.name));
const NO_PROJECT = 'No project is open. Call list_projects and open_project, or create_project.';
// contract.cjs LIMITS.toolCallsPerRequest, counted per edit (test-external-host checks they match).
export const TOOL_CALLS_PER_EDIT = 300;
const CRAFT_BUSY = 'CraftAI is editing this project in ClipCraft. Retry when it finishes.';

// The list every external agent is offered: the project tools, then the native list excluding plugin commands. The
// user's own MCP servers are not re-exported (the outside agent can connect them itself).
export function externalCapabilities(provider) { return { imageGeneration: provider === 'codex-sdk' }; }
export function externalTools(provider) {
  const { catalog, tools } = nativeTools(externalCapabilities(provider).imageGeneration ? 'codex-sdk' : 'external', [], { pluginCommands: false });
  return { catalog, tools: [...PROJECT_TOOLS, ...tools] };
}
export const externalInstructions = () => `${nativeSystemPrompt()}
ClipCraft runs as a desktop app and you edit the project open in it while the user watches. Call get_status first. Use list_projects, open_project or create_project when no project is open. Each change you make is part of an edit that complete_edit validates; the user can undo each validated edit as one step. If a result says the project changed, the user edited it: read get_project and continue from the current timeline.`;

// app: what App.jsx provides (getters, never stale): screen(), project(), loadVersion(), dispatch,
// settle, pilotApp, provider(), craftBusy(), projects { list, create, open, save, close, status },
// onActivity(event).
export function createExternalHost(app) {
  let edit = null, queue = Promise.resolve(), client = null;
  // What lasts for the outside agent's whole connection, across its edits: the identity its frames were
  // presented under (the main process names it per MCP session) and its search results (search_sounds /
  // search_stock ids used by a later add_sound / add_stock).
  let session = { id: null, searchResults: new Map() };
  const current = new Map(); // callId -> edit, for cancel
  let declarations = externalTools(app.provider());

  const activity = (event) => { try { app.onActivity?.(event); } catch { /* the panel is optional */ } };

  const openEdit = async () => {
    const token = crypto.randomUUID(), project = app.project(), loadVersion = app.loadVersion();
    app.dispatch({ type: 'beginAgentEdit', token });
    await app.settle();
    if (app.pilotApp.getAgentEdit?.()?.token !== token) return null;
    const contents = [];
    const state = { token, projectId: project.id, loadVersion, calls: 0, stopped: false, client: client?.name || 'External agent', started: Date.now() };
    const isCurrent = () => app.screen() === 'editor' && app.project().id === state.projectId && app.loadVersion() === state.loadVersion;
    const ctx = { ...makeAgentCtx({ app: app.pilotApp, provider: app.provider(), getProject: app.project, dispatch: app.dispatch, settle: app.settle,
      requestId: token, isCurrent, isStopped: () => state.stopped }), evidenceId: session.id || token, searchResults: session.searchResults };
    state.isCurrent = isCurrent;
    state.host = createToolHost({ ctx, contents, onEvent: (event) => { activity({ ...event, editId: token, client: state.client }); if (state.callId && event.status === 'running' && event.label) window.api.externalProgress?.({ callId: state.callId, label: event.label }); },
      isCanceled: () => state.stopped || !isCurrent(), requestId: token, tools: declarations.tools, catalog: declarations.catalog });
    activity({ type: 'edit-start', editId: token, client: state.client });
    return state;
  };
  // reason: validated | read | interrupted | canceled | switched | released
  const closeEdit = (reason) => {
    const state = edit;
    if (!state) return;
    edit = null;
    const changed = (() => { try { return state.isCurrent() && state.host.changed(); } catch { return false; } })();
    // Its changes are the top Undo step only while the edit still owns the agent transaction: a manual
    // edit in the meantime committed them and took the top of the history, so an Undo offered for the
    // edit would revert the user's own change instead (undoable: false).
    const owns = (() => { try { return app.pilotApp.getAgentEdit?.()?.token === state.token; } catch { return false; } })();
    app.dispatch({ type: 'endAgentEdit', token: state.token });
    activity({ type: 'edit-end', editId: state.token, client: state.client, reason, changed, undoable: changed && owns, validated: reason === 'validated' });
  };

  const status = () => {
    const screen = app.screen(), project = screen === 'editor' ? app.project() : null;
    return { app: 'ClipCraft', screen, connected_as: client?.name || null, craftai_busy: !!app.craftBusy(),
      project: project ? { id: project.id, name: project.name || 'Untitled', format: project.ratio, fps: project.fps, ...app.projects.status(), revision: projectRevision(project) } : null,
      edit_open: !!edit, validation_pending: !!edit && edit.host.pendingValidation(),
      ...(project ? { context: nativeRequestContext(projectRevision(project)) } : {}) };
  };

  async function projectCall(name, args) {
    if (name === 'get_status') return status();
    if (name === 'list_projects') return { projects: await app.projects.list(args.query) };
    if (app.craftBusy()) return { error: CRAFT_BUSY };
    // Leaving the project ends the open edit; its changes stay (and can be undone).
    const pendingNote = edit?.host.pendingValidation() ? { note: 'The previous project had changes not validated with complete_edit; they were kept.' } : {};
    if (name === 'save_project') { if (app.screen() !== 'editor') return { error: NO_PROJECT }; return app.projects.save(args.path); }
    closeEdit('switched');
    let result;
    if (name === 'create_project') result = await app.projects.create(args);
    else if (name === 'open_project') result = await app.projects.open(args);
    else result = await app.projects.close();
    return result?.error ? result : { ...result, ...pendingNote, status: status() };
  }

  async function editorCall(call) {
    if (app.screen() !== 'editor') return { error: NO_PROJECT };
    if (app.craftBusy()) return { error: CRAFT_BUSY };
    if (edit && !edit.isCurrent()) closeEdit('switched');
    if (!edit) {
      edit = await openEdit();
      if (!edit) return { error: 'The editor is busy (the user is dragging, or another edit is running). Retry in a moment.' };
    }
    const state = edit;
    if (call.name !== 'complete_edit' && ++state.calls > TOOL_CALLS_PER_EDIT) return { error: `This edit reached its limit of ${TOOL_CALLS_PER_EDIT} tool calls. Call complete_edit to finish it.` };
    state.callId = call.callId;
    current.set(call.callId, state);
    let result;
    // The host throws before running a call that it must refuse (stopped, or the user changed the
    // project): that still ends this edit below.
    try { result = await state.host.enqueue({ name: call.name, args: call.args }); }
    catch (error) { result = { error: error.message }; }
    finally { current.delete(call.callId); state.callId = null; }
    if (edit !== state) return result;
    if (state.host.staleError) { closeEdit('interrupted'); return { ...result, error: state.host.staleError, project_changed_by_user: true }; }
    if (state.host.canceled()) { closeEdit(state.stopped ? 'canceled' : 'switched'); return result; }
    if (call.name === 'complete_edit' && result?.ready) { closeEdit('validated'); return result; }
    if (!state.host.pendingValidation()) { closeEdit('read'); return result; }
    return state.host.changed() ? { ...result, validation_pending: true } : result;
  }

  // One call at a time, in arrival order: edit boundaries and project switches never interleave.
  // A call canceled while it still waits its turn never runs.
  const withdrawn = new Set();
  function call({ callId, name, args, client: from, session: sessionId }) {
    if (from?.name) client = from;
    if (typeof sessionId === 'string' && sessionId && sessionId !== session.id) session = { id: sessionId, searchResults: new Map() };
    const run = () => {
      if (withdrawn.delete(callId)) return { error: 'The call was canceled before it ran.', canceled: true };
      return PROJECT_NAMES.has(name) ? projectCall(name, args || {}) : editorCall({ callId, name, args: args || {} });
    };
    const task = queue.then(run).catch((error) => ({ error: error.message || 'The call failed.' }));
    queue = task.then(() => {}, () => {});
    return task;
  }

  return {
    call,
    declarations: () => declarations,
    // The tool list changes with the image capability (Codex sign-in in ClipCraft).
    refresh() { declarations = externalTools(app.provider()); return declarations; },
    cancel(callId) {
      const state = current.get(callId);
      if (!state) { withdrawn.add(callId); return; }
      state.stopped = true;
      window.api.agentCancel?.(state.token).catch(() => {});
    },
    // The agent went idle without complete_edit and CraftAI is about to run: its edit ends (changes
    // kept, one Undo step) so the editor is free. Nothing happens while one of its calls still runs.
    yieldEdit() {
      if (!edit || current.size) return false;
      closeEdit('interrupted');
      return true;
    },
    // The agent disconnected, went idle or the user pressed Disconnect.
    async release() {
      if (edit) { edit.stopped = true; window.api.agentCancel?.(edit.token).catch(() => {}); }
      await queue;
      closeEdit('released');
      if (client) activity({ type: 'agent-released', client: client.name });
      client = null; session = { id: null, searchResults: new Map() };
    },
    status,
  };
}
