// The chat log beside the project (docs/architecture/project-file.md). A project document
// (<name>.clipcraft.json) holds the timeline, media and settings; its CraftAI conversations are
// written next to it as <name>.clipcraft.chat.json and merged back on open. The chat is most of a
// project's bytes and changes on every agent step, so keeping it apart lets a chat change skip
// rewriting the document, and keeps the document small for anything that reads it directly.
// Older files that still embed `craftAI` load as before; the first save moves it out.
const fs = require('node:fs');

const chatPath = (file) => `${String(file).replace(/\.json$/i, '')}.chat.json`;

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return -Infinity; } };
// An embedded chat newer than the sidecar wins: an older ClipCraft (which saves the chat inside
// the document) worked on the project after this version last wrote the sidecar. This version never
// embeds a chat, so a document that holds one and is the newer file carries the latest conversations.
const embeddedWins = (docFile, chatFile, docEmbedsChat) => docEmbedsChat && mtime(docFile) > mtime(chatFile);

// The sidecar's text, or null when the project has none or its document's own embedded chat is
// newer. documentText: the document as read, to tell whether it embeds a chat.
function readChat(file, documentText = '') {
  const target = chatPath(file);
  if (embeddedWins(file, target, /"craftAI"\s*:/.test(documentText))) return null;
  try { return fs.readFileSync(target, 'utf8'); } catch { return null; }
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

module.exports = { chatPath, readChat, writeChat, mergeChat, documentFor, embeddedWins };
