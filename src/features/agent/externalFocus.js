// Timeline spotlight and trail for an outside agent (docs/agents/agent-editing.md): the App.agentFocus
// value CraftPilot derives from a turn's steps, derived here from the external host's activity events
// (externalHost.js). Those carry the tool host's activity.targets, so one edit shows exactly as one
// CraftAI request does: the running tool's targets are live, each finished change joins the trail, and
// the edit's end starts the hold and fade. Pure: no React, never throws on a malformed event.
const TRAIL = 24;
const pick = (event) => ({ id: `${event.editId}:${event.id}`, name: event.name, title: event.activity?.title || event.label || '', targets: event.activity.targets, at: Date.now() });

// focus: the open edit's focus or null. Returns { focus, changed }; when changed, focus is the next
// value for onAgentFocus (null ends the run).
export function externalFocusStep(focus, event, runKey) {
  if (!event || typeof event !== 'object') return { focus, changed: false };
  // An edit opens on the agent's first call, reads included: the focus begins with the first tool
  // that has targets, so a get_project after a finished edit leaves that edit's held trail alone.
  if (event.type === 'edit-start') return { focus, changed: false };
  if (event.type === 'edit-end' || event.type === 'agent-released') return focus ? { focus: null, changed: true } : { focus, changed: false };
  if (event.type !== 'tool') return { focus, changed: false };
  if (focus && event.editId !== focus.requestId) return { focus, changed: false };
  const targets = event.activity?.targets;
  if (!focus && !targets) return { focus, changed: false };
  const base = focus || { runKey, requestId: event.editId, agent: event.client || 'External agent', live: null, trail: [] };
  if (event.status === 'running') return { focus: { ...base, live: targets ? pick(event) : null }, changed: true };
  const trail = event.status === 'done' && targets ? [...base.trail, pick(event)].slice(-TRAIL) : base.trail;
  return { focus: { ...base, live: null, trail }, changed: true };
}
