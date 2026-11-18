// Per-project autosave store: every project the user works on is kept in its OWN slot
// under <userData>/autosave/, so going Home and opening another project never strands the
// previous one (the old design kept a single shared crash-recovery snapshot that any
// other project overwrote). A slot is one JSON file per project id:
//
//   <root>/<id>.json       { id, title, file, fileStamp, ratio, thumb, updatedAt, project }
//   <root>/chat/<id>.json  the project's CraftAI conversations (project.craftAI), kept apart so a
//                          chat change never rewrites the document (sidecar.cjs); merged on read
//   <root>/index.json      [{ id, title, file, ratio, thumb, updatedAt }] — newest first
//
// `file` is the project's own .clipcraft file when it has one (the binding: the slot and
// the file describe the same project id, and opening either finds the same state); it is
// null for a project that was never saved to a file — those live ONLY here, which is the
// point: they survive Home navigation, other projects, and app restarts.
//
// Hygiene: the store keeps at most CAP projects; writing beyond the cap evicts the OLDEST
// slots whose project file exists (never the one just written, never an unsaved project's only copy). All writes are tmp-file + rename, so a crash mid-
// write never leaves a torn slot. Ids are sanitized to a safe filename alphabet — a
// hostile or corrupt id can never escape the store directory.
//
// Plain-Node friendly (no Electron imports) so tests/unit/editor/test-autosave.cjs can drive it.

const fs = require('node:fs');
const path = require('node:path');

const CAP = 24; // projects kept in the store; the brief's floor is 20
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

const slotPath = (root, id) => (ID_OK.test(String(id || '')) ? path.join(root, `${id}.json`) : null);
const chatPath = (root, id) => (ID_OK.test(String(id || '')) ? path.join(root, 'chat', `${id}.json`) : null);
const removeChat = (root, id) => { const f = chatPath(root, id); if (f) { try { fs.unlinkSync(f); } catch { /* none */ } } };
const indexPath = (root) => path.join(root, 'index.json');

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}

function readIndex(root) {
  try {
    const list = JSON.parse(fs.readFileSync(indexPath(root), 'utf8'));
    if (Array.isArray(list)) return list.filter((e) => e && ID_OK.test(String(e.id || '')));
  } catch { /* rebuilt below */ }
  return null;
}

// The index is a cache of the slot files' headers; if it is missing or torn, rebuild it
// by scanning the slots (a slot file is the source of truth).
function rebuildIndex(root) {
  const entries = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return entries; }
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      if (s && ID_OK.test(String(s.id || ''))) {
        entries.push({ id: s.id, title: s.title || 'Untitled', file: s.file || null, ratio: s.ratio || '', thumb: s.thumb || null, updatedAt: s.updatedAt || 0 });
      }
    } catch { /* a torn slot is skipped, never fatal */ }
  }
  return entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function listSlots(root) {
  const entries = readIndex(root) || rebuildIndex(root);
  return entries
    .filter((e) => slotPath(root, e.id) && fs.existsSync(slotPath(root, e.id)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Over the cap, the oldest slots whose project file still exists go first: their work also lives in
// that file. A slot without a file (or whose file is gone) is the only copy of its project and is never
// evicted, so the store may hold more than CAP slots when that many are unsaved.
function prune(root, entries, keepId) {
  let excess = entries.length - CAP;
  const evict = new Set();
  for (let i = entries.length - 1; i >= 0 && excess > 0; i--) {
    const e = entries[i];
    if (e.id === keepId || !e.file || !fs.existsSync(e.file)) continue;
    evict.add(e.id);
    excess--;
  }
  for (const id of evict) {
    const f = slotPath(root, id);
    if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    removeChat(root, id);
  }
  return entries.filter((e) => !evict.has(e.id));
}

// The identity of a project file on disk ({ mtimeMs, size }), or null when it cannot be read. A slot
// records it for its bound file each time it is written, so opening the slot later can tell whether
// the file changed since (another computer, an outside tool, a backup restore) and open the file instead.
function fileStamp(file) {
  try { const st = fs.statSync(file); return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null; } catch { return null; }
}

// True when a slot's bound file exists and is not the file the slot last saw: its identity differs from
// the recorded stamp, or (a slot written before stamps were kept) the file was modified after the slot.
// Such a slot must not be opened over the file: the file has work the slot never had.
function fileChangedSince(slot) {
  if (!slot || !slot.file) return false;
  const now = fileStamp(slot.file);
  if (!now) return false; // the file is gone: the slot is the only copy left
  const was = slot.fileStamp;
  if (was && typeof was === 'object') return now.mtimeMs !== was.mtimeMs || now.size !== was.size;
  return now.mtimeMs > (Number(slot.updatedAt) || 0);
}

// record: { id, title, file, ratio, thumb, updatedAt, projectJson, chatJson? } — projectJson is the
// project document serialized by the renderer (the same JSON a .clipcraft file would hold, without
// the chat); chatJson is the chat to store beside it (null removes it), or absent to keep the stored one.
// Returns the stored index entry, or null when the record is unusable.
function writeSlot(root, record) {
  try {
    if (!record || !ID_OK.test(String(record.id || ''))) return null;
    const file = slotPath(root, record.id);
    let project;
    try { project = JSON.parse(record.projectJson); } catch { return null; }
    if (!project || typeof project !== 'object') return null;
    fs.mkdirSync(root, { recursive: true });
    const slot = {
      id: record.id,
      title: String(record.title || project.name || 'Untitled'),
      file: record.file ? String(record.file) : null,
      ratio: String(record.ratio || project.ratio || ''),
      thumb: record.thumb || null,
      updatedAt: Number(record.updatedAt) || Date.now(),
      project,
    };
    if (slot.file) slot.fileStamp = fileStamp(slot.file);
    writeJsonAtomic(file, slot);
    if (record.chatJson !== undefined) writeSlotChat(root, slot.id, record.chatJson);
    const entry = { id: slot.id, title: slot.title, file: slot.file, ratio: slot.ratio, thumb: slot.thumb, updatedAt: slot.updatedAt };
    const rest = listSlots(root).filter((e) => e.id !== slot.id);
    const entries = prune(root, [entry, ...rest], slot.id);
    writeJsonAtomic(indexPath(root), entries);
    return entry;
  } catch {
    return null;
  }
}

// The chat beside a slot, written on its own when only the conversation changed. json null removes it.
function writeSlotChat(root, id, json) {
  const file = chatPath(root, id);
  if (!file) return false;
  if (json == null) { removeChat(root, id); return true; }
  if (typeof json !== 'string') return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

// A slot with its chat merged back into project.craftAI (the sidecar wins over an embedded legacy chat).
function readSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!s || !s.project) return null;
    const sidecar = require('./sidecar.cjs');
    // An embedded chat with content in a slot newer than its chat file wins (an older ClipCraft wrote the slot).
    if (sidecar.embeddedWins(file, chatPath(root, id), s.project.craftAI)) return s;
    const chat = sidecar.readChatFile(chatPath(root, id)); // throws when the file is held: the caller reports it
    return chat ? { ...s, project: sidecar.mergeChat(s.project, chat) } : s;
  } catch (error) {
    if (error?.code === 'CHAT_UNREADABLE') throw error;
    return null;
  }
}

function deleteSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return false;
  let gone = false;
  try { fs.unlinkSync(file); gone = true; } catch { /* not there */ }
  removeChat(root, id);
  try {
    const entries = listSlots(root).filter((e) => e.id !== id);
    writeJsonAtomic(indexPath(root), entries);
  } catch { /* index rebuilds from slots on next read */ }
  return gone;
}

// The slot bound to a project FILE (same .clipcraft path), if one exists — opening a file
// adopts its slot's id so file and slot stay one identity.
function slotForFile(root, filePath) {
  if (!filePath) return null;
  return listSlots(root).find((e) => e.file === filePath) || null;
}

module.exports = { CAP, fileStamp, fileChangedSince, writeSlot, writeSlotChat, readSlot, listSlots, deleteSlot, slotForFile, slotPath, chatPath };
