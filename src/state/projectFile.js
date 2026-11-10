// The project document and its chat log, saved apart (docs/architecture/project-file.md). The
// document is everything but `craftAI`; the chat is `craftAI` when it has content. App's autosave
// tells the two kinds of change apart so an agent step (chat) never rewrites the document, and a
// timeline edit never rewrites the chat. Pure helpers: no React, no IO.
import { hasChatContent } from '../features/agent/chatSessions.js';

const docs = new WeakMap(); // project -> its document, so the serializer's identity cache hits
export function projectDoc(project) {
  let doc = docs.get(project);
  if (!doc) { const { craftAI, ...rest } = project; doc = rest; docs.set(project, doc); }
  return doc;
}
// The chat worth storing, or null (an empty default chat leaves no sidecar).
export const projectChat = (project) => (hasChatContent(project) ? project.craftAI : null);
// Same document: every top-level field apart from the chat is the same value. The reducers keep
// untouched fields by identity, so this is exact and cheap.
export function sameDoc(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a).filter((k) => k !== 'craftAI'), kb = Object.keys(b).filter((k) => k !== 'craftAI');
  return ka.length === kb.length && ka.every((k) => k in b && a[k] === b[k]);
}
// Which part of the project changed between two snapshots, for App's autosave. Conservative: only a
// change that swaps the chat and leaves every other field identical takes the chat-only path; any
// other new project object writes the document, exactly as the single-file autosave did (so a field
// mutated in place behind a fresh top-level object is still saved).
export function classifyChange(previous, project) {
  if (!previous) return { doc: true, chat: true };
  if (previous === project) return { doc: false, chat: false };
  const chat = previous.craftAI !== project.craftAI;
  return { doc: !(chat && sameDoc(previous, project)), chat };
}
// A loaded document with its sidecar's text merged in: the sidecar wins over an embedded legacy chat.
export function mergeChat(project, chatJson) {
  if (!chatJson || typeof chatJson !== 'string') return project;
  try { const chat = JSON.parse(chatJson); if (chat && typeof chat === 'object' && !Array.isArray(chat)) return { ...project, craftAI: chat }; } catch { /* a torn sidecar: the document's own chat, if any, stands */ }
  return project;
}
