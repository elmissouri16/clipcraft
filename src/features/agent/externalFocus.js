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
  if (event.type === 'edit-start') return { focus: { runKey, requestId: event.editId, agent: event.client || 'External agent', live: null, trail: [] }, changed: true };
  if (event.type === 'edit-end' || event.type === 'agent-released') return focus ? { focus: null, changed: true } : { focus, changed: false };
  if (event.type !== 'tool' || !focus || event.editId !== focus.requestId) return { focus, changed: false };
  const targets = event.activity?.targets;
  if (event.status === 'running') return { focus: { ...focus, live: targets ? pick(event) : null }, changed: true };
  const trail = event.status === 'done' && targets ? [...focus.trail, pick(event)].slice(-TRAIL) : focus.trail;
  return { focus: { ...focus, live: null, trail }, changed: true };
}
