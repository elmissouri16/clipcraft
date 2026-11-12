// The chat log beside the project (docs/architecture/project-file.md). A project document
// (<name>.clipcraft.json) holds the timeline, media and settings; its CraftAI conversations are
// written next to it as <name>.clipcraft.chat.json and merged back on open. The chat is most of a
// project's bytes and changes on every agent step, so keeping it apart lets a chat change skip
// rewriting the document, and keeps the document small for anything that reads it directly.
// Older files that still embed `craftAI` load as before; the first save moves it out.
const fs = require('node:fs');

const chatPath = (file) => `${String(file).replace(/\.json$/i, '')}.chat.json`;

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return -Infinity; } };
// The renderer's rule for a chat worth keeping (src/features/agent/chatSessions.js hasChatContent):
// an older ClipCraft always writes `craftAI`, even for an empty default chat, so only content counts.
const chatHasContent = (chat) => !!(chat && Array.isArray(chat.sessions) && chat.sessions.some((s) => s && (
  s.messages?.length || (typeof s.draft === 'string' && s.draft.trim()) || s.timelineAttachments?.length || s.images?.length || s.videos?.length || s.queue?.length)));
// The chat a document embeds, or null: a cheap text test first, the parse only for files that have one.
function embeddedChat(documentText) {
  if (!documentText || !/"craftAI"\s*:/.test(documentText)) return null;
  try { const chat = JSON.parse(documentText)?.craftAI; return chat && typeof chat === 'object' ? chat : null; } catch { return null; }
}
// An embedded chat with content, newer than the sidecar, wins: an older ClipCraft (which saves the chat
// inside the document) worked on the project after this version last wrote the sidecar. This version
// never embeds a chat, so a document that holds one and is the newer file carries the latest
// conversations. An empty embedded chat (the older app's default) never outranks a sidecar: that would
// drop every conversation after a round trip through the older version.
const embeddedWins = (docFile, chatFile, embedded) => chatHasContent(embedded) && mtime(docFile) > mtime(chatFile);

const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available */ } };
// The text of a chat file, null when there is none. A read that fails for another reason (a sync
// client or scanner holding the file) is retried, then thrown: opening with an empty chat would make
// the next save replace the real one. A file that is not JSON is moved aside as <file>.bad, never
// deleted, and reads as no chat.
function readChatFile(target) {
  let text;
  for (let attempt = 0; ; attempt++) {
    try { text = fs.readFileSync(target, 'utf8'); break; } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (attempt >= 3) { const e = new Error(require('../system/i18n.cjs').t('main.chat_log_unreadable', { code: error.code || error.message })); e.code = 'CHAT_UNREADABLE'; throw e; }
      pause(60);
    }
  }
  try { const chat = JSON.parse(text); if (chat && typeof chat === 'object' && !Array.isArray(chat)) return text; } catch { /* moved aside below */ }
  try { fs.renameSync(target, `${target}.bad`); } catch { /* left in place; it still reads as no chat */ }
  return null;
}

// The sidecar's text, or null when the project has none or its document's own embedded chat is
// newer. documentText: the document as read, to tell whether it embeds a chat.
function readChat(file, documentText = '') {
  const target = chatPath(file);
  if (embeddedWins(file, target, embeddedChat(documentText))) return null;
  return readChatFile(target);
}
// The document for a path the user picked: the sidecar itself, when its document sits next to it.
function documentFor(file) {
  if (!/\.chat\.json$/i.test(file)) return file;
  const doc = file.replace(/\.chat\.json$/i, '.json');
  return fs.existsSync(doc) ? doc : file;
}

// Write the chat atomically, or remove it when json is null (a project with no conversations).
function writeChat(file, json) {
  const target = chatPath(file);
  if (json == null) { try { fs.unlinkSync(target); } catch { /* nothing to remove */ } return true; }
  fs.writeFileSync(`${target}.part`, json, 'utf8');
  fs.renameSync(`${target}.part`, target);
  return true;
}

// A loaded document with its sidecar merged in: the sidecar wins over an embedded legacy chat.
function mergeChat(project, chatJson) {
  if (!chatJson) return project;
  try { const chat = JSON.parse(chatJson); if (chat && typeof chat === 'object') return { ...project, craftAI: chat }; } catch { /* a torn sidecar: the document's own chat, if any, stands */ }
  return project;
}

module.exports = { chatPath, readChat, readChatFile, writeChat, mergeChat, documentFor, embeddedWins, chatHasContent };
