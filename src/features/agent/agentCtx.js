// The editor context an agent request runs with (docs/design/external-agent-mcp.md). CraftAI and
// external MCP agents build it here, so both write through the same guards: every dispatch carries
// the request's agentToken (a user edit without one interrupts the request), and nothing is written
// once the owner is gone (isCurrent) or stopped (isStopped).
export function makeAgentCtx({ app, provider, getProject, dispatch, settle, requestId, isCurrent, isStopped, chatImageIds = [], allowPluginCommands = false }) {
  const live = () => isCurrent() && !isStopped();
  return {
    ...app,
    allowPluginCommands,
    chatImageIds,
    provider,
    getProject: () => {
      if (!isCurrent()) throw new Error('The project changed.');
      return getProject();
    },
    dispatch: (action) => { if (live()) dispatch({ ...action, agentToken: requestId }); },
    editActive: () => app.getAgentEdit?.()?.token === requestId,
    editInterruption: () => app.getAgentInterruption?.(),
    addProbed: (...args) => live() ? app.addProbed?.(...args, requestId) : null,
    startExport: (...args) => live() ? app.startExport?.(...args) : undefined,
    runExtensionCommand: (input,callbacks) => {if(!live()||!allowPluginCommands)throw Error('Editing stopped.');return app.runExtensionCommand(input,{...callbacks,agentToken:requestId,isCanceled:()=>!live()});},
    api: window.api, settle,
    // Undo only what this request did: the user's earlier edits stay.
    undoOwn: () => {
      if (!live() || app.getAgentEdit?.()?.token !== requestId || !app.getAgentEdit?.()?.steps.length) return false;
      dispatch({ type: 'undoAgentEdit', token: requestId });
      return true;
    },
  };
}
