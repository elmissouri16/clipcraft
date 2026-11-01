// Per-project autosave store: every project the user works on is kept in its OWN slot
// under <userData>/autosave/, so going Home and opening another project never strands the
// previous one (the old design kept a single shared crash-recovery snapshot that any
// other project overwrote). A slot is one JSON file per project id:
//
//   <root>/<id>.json   { id, title, file, ratio, thumb, updatedAt, project }
//   <root>/index.json  [{ id, title, file, ratio, thumb, updatedAt }] — newest first
//
// `file` is the project's own .clipcraft file when it has one (the binding: the slot and
// the file describe the same project id, and opening either finds the same state); it is
// null for a project that was never saved to a file — those live ONLY here, which is the
// point: they survive Home navigation, other projects, and app restarts.
//
// Hygiene: the store keeps at most CAP projects; writing beyond the cap evicts the OLDEST
// slots (never the one just written). All writes are tmp-file + rename, so a crash mid-
// write never leaves a torn slot. Ids are sanitized to a safe filename alphabet — a
// hostile or corrupt id can never escape the store directory.
//
// Plain-Node friendly (no Electron imports) so scripts/test-autosave.cjs can drive it.

const fs = require('node:fs');
const path = require('node:path');

const CAP = 24; // projects kept in the store; the brief's floor is 20
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

const slotPath = (root, id) => (ID_OK.test(String(id || '')) ? path.join(root, `${id}.json`) : null);
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

function prune(root, entries, keepId) {
  const kept = [];
  for (const e of entries) {
    if (kept.length < CAP || e.id === keepId) { kept.push(e); continue; }
    const f = slotPath(root, e.id);
    if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  }
  return kept;
}

// record: { id, title, file, ratio, thumb, updatedAt, projectJson } — projectJson is the
// project serialized by the renderer (the same JSON a .clipcraft file would hold).
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
    writeJsonAtomic(file, slot);
    const entry = { id: slot.id, title: slot.title, file: slot.file, ratio: slot.ratio, thumb: slot.thumb, updatedAt: slot.updatedAt };
    const rest = listSlots(root).filter((e) => e.id !== slot.id);
    const entries = prune(root, [entry, ...rest], slot.id);
    writeJsonAtomic(indexPath(root), entries);
    return entry;
  } catch {
    return null;
  }
}

function readSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && s.project ? s : null;
  } catch {
    return null;
  }
}

function deleteSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return false;
  let gone = false;
  try { fs.unlinkSync(file); gone = true; } catch { /* not there */ }
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

module.exports = { CAP, writeSlot, readSlot, listSlots, deleteSlot, slotForFile, slotPath };
