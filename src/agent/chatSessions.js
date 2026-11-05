// Project-owned conversations. Only completed turns enter saved model context;
// an interrupted request can be displayed without replaying unfinished tools.
const record = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const newChatSession = () => ({
  id: crypto.randomUUID(), title: 'New chat', messages: [], contents: [], draft: '', style: null,
});

export function normalizeChatSessions(value) {
  const seen = new Set();
  const sessions = (Array.isArray(value?.sessions) ? value.sessions : []).filter((s) => {
    if (!record(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id)) return false;
    seen.add(s.id); return true;
  }).map((s) => ({
    id: s.id, title: typeof s.title === 'string' ? s.title : 'New chat',
    draft: typeof s.draft === 'string' ? s.draft : '',
    style: typeof s.style === 'string' ? s.style : null,
    messages: (Array.isArray(s.messages) ? s.messages : []).filter((m) => record(m)
      && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').map((m) => ({
      role: m.role, text: m.pending ? 'Interrupted. Send another message to continue.' : m.text,
      ...(record(m.contextUsage) ? { contextUsage: Object.fromEntries(['requests', 'inputChars', 'avoidedChars', 'tools', 'abbreviated']
        .map((key) => [key, Number.isFinite(m.contextUsage[key]) && m.contextUsage[key] >= 0 ? m.contextUsage[key] : 0])) } : {}),
      ...(record(m.error) && typeof m.error.error === 'string' ? { error: {
        error: m.error.error, suggestModel: !!m.error.suggestModel,
        ...(typeof m.error.link === 'string' ? { link: m.error.link } : {}),
        ...(typeof m.error.linkLabel === 'string' ? { linkLabel: m.error.linkLabel } : {}),
      } } : {}),
      steps: (Array.isArray(m.steps) ? m.steps : []).filter((step) => record(step)
        && typeof step.id === 'string' && typeof step.label === 'string').map((step) => ({
        ...step, ...(step.status === 'running' ? { status: 'error', detail: 'Interrupted before completion.' } : {}),
      })),
      // Undo history is not serialized, so restored replies cannot undo an edit.
    })),
    contents: (Array.isArray(s.contents) ? s.contents : []).filter((turn) => record(turn)
      && ['user', 'model'].includes(turn.role) && Array.isArray(turn.parts)),
  }));
  return { version: 1, sessions, activeSessionId: sessions.some((s) => s.id === value?.activeSessionId)
    ? value.activeSessionId : sessions[0]?.id || null };
}

// Detach saved data from the agent's mutable contents array and omit live Undo
// affordances while retaining pending flags for interruption recovery on load.
export function snapshotChatSessions(chat) {
  return JSON.parse(JSON.stringify({ ...chat, sessions: chat.sessions.map((s) => ({
    ...s, messages: s.messages.map(({ changed, ...message }) => message),
  })) }));
}

export const hasChatContent = (p) => !!p.craftAI?.sessions?.some((s) => s.messages?.length || s.draft?.trim());
