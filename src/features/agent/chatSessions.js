import { normalizeTimelineAttachments } from './timelineAttachments.js';
import { normalizeToolActivity } from './activityData.js';
import { normalizeChatImages } from './imageAttachments.js';
import { normalizeChatVideos } from './videoAttachments.js';
// Project-owned conversations. Only completed turns enter saved model context;
// an interrupted request can be displayed without replaying unfinished tools.
const record = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const newChatSession = () => ({
  id: crypto.randomUUID(), title: 'New chat', messages: [], contents: [], draft: '', timelineAttachments: [], images: [], videos: [], queue: [], queuePaused: false,
});

export function normalizeMessageQueue(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(item => {
    if (!record(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.text !== 'string' || !item.text.trim()) return false;
    seen.add(item.id); return true;
  }).map(item => ({ id: item.id, text: item.text.trim(), timelineAttachments: normalizeTimelineAttachments(item.timelineAttachments), ...(normalizeChatImages(item.images).length ? { images: normalizeChatImages(item.images) } : {}), ...(normalizeChatVideos(item.videos).length ? { videos: normalizeChatVideos(item.videos) } : {}) }));
}

export function normalizeChatSessions(value) {
  const seen = new Set();
  const sessions = (Array.isArray(value?.sessions) ? value.sessions : []).filter((s) => {
    if (!record(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id)) return false;
    seen.add(s.id); return true;
  }).map((s) => ({
    id: s.id, title: typeof s.title === 'string' ? s.title : 'New chat',
    timelineAttachments: normalizeTimelineAttachments(s.timelineAttachments),
    images: normalizeChatImages(s.images),
    videos: normalizeChatVideos(s.videos),
    draft: typeof s.draft === 'string' ? s.draft : '',
    queue: normalizeMessageQueue(s.queue),
    // Reopening a project never submits saved instructions automatically.
    queuePaused: normalizeMessageQueue(s.queue).length > 0,
    messages: (Array.isArray(s.messages) ? s.messages : []).filter((m) => record(m)
      && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').map((m) => ({
      ...(m.role === 'user' ? { timelineAttachments: normalizeTimelineAttachments(m.timelineAttachments), ...(normalizeChatImages(m.images).length ? { images: normalizeChatImages(m.images) } : {}), ...(normalizeChatVideos(m.videos).length ? { videos: normalizeChatVideos(m.videos) } : {}) } : {}),
      role: m.role, text: m.pending ? 'Interrupted. Send another message to continue.' : m.text,
      ...(record(m.contextUsage) ? { contextUsage: Object.fromEntries(['requests', 'inputChars', 'avoidedChars', 'tools', 'abbreviated']
        .map((key) => [key, Number.isFinite(m.contextUsage[key]) && m.contextUsage[key] >= 0 ? m.contextUsage[key] : 0])) } : {}),
      // Provider-reported token usage for native replies (counts only).
      ...(record(m.tokenUsage) ? { tokenUsage: Object.fromEntries(['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens']
        .map((key) => [key, Number.isFinite(m.tokenUsage[key]) && m.tokenUsage[key] >= 0 ? m.tokenUsage[key] : 0])) } : {}),
      ...(record(m.error) && typeof m.error.error === 'string' ? { error: {
        error: m.error.error, suggestModel: !!m.error.suggestModel,
        ...(['edit_interrupted','edit_timeout','edit_limit'].includes(m.error.code) ? { code:m.error.code } : {}),
        ...(record(m.error.interruption) && typeof m.error.interruption.action === 'string' ? { interruption: {
          action: m.error.interruption.action.slice(0, 64),
          ...(typeof m.error.interruption.track === 'string' ? { track: m.error.interruption.track.slice(0, 32) } : {}),
          fields: (Array.isArray(m.error.interruption.fields) ? m.error.interruption.fields : []).filter(field => typeof field === 'string').slice(0, 16).map(field => field.slice(0, 64)),
        } } : {}),
        ...(typeof m.error.link === 'string' ? { link: m.error.link } : {}),
        ...(typeof m.error.linkLabel === 'string' ? { linkLabel: m.error.linkLabel } : {}),
      } } : {}),
      steps: (Array.isArray(m.steps) ? m.steps : []).filter((step) => record(step)
        && typeof step.id === 'string' && typeof step.label === 'string').map((step) => ({
        ...step, activity:normalizeToolActivity(step.activity), ...(step.status === 'running' ? { status: 'error', detail: 'Interrupted before completion.' } : {}),
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

export const hasChatContent = (p) => !!p.craftAI?.sessions?.some((s) => s.messages?.length || s.draft?.trim() || s.timelineAttachments?.length || s.images?.length || s.videos?.length || s.queue?.length);
