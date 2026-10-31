// Favorite sounds, videos and photos, kept across projects in <userData>/favorites.json.
// An entry: { key, type: 'audio' | 'video' | 'photo', source: 'library' | 'stock' | 'file', item, addedAt }.
// `item` is what the app needs to use it again: a library or stock search result (downloaded again or taken from
// the download cache) or, for imported files, the file path with its thumbnails.
const fs = require('fs');
const path = require('path');

const TYPES = ['audio', 'video', 'photo'];
const SOURCES = ['library', 'stock', 'file'];
const MAX = 2000;

function file(dir) {
  return path.join(dir, 'favorites.json');
}

function list(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// What the UI gets: imported files that were moved or deleted are flagged instead of dropped.
function listForUi(dir) {
  return list(dir).map((e) => (e.source === 'file' ? { ...e, missing: !fs.existsSync(e.item.path) } : e));
}

function valid(e) {
  if (!e || typeof e.key !== 'string' || e.key.length > 600 || !TYPES.includes(e.type) || !SOURCES.includes(e.source)) return false;
  if (!e.item || typeof e.item !== 'object' || JSON.stringify(e.item).length > 16000) return false;
  if (e.source === 'file' && (typeof e.item.path !== 'string' || !path.isAbsolute(e.item.path))) return false;
  return true;
}

// Adds the entry, or removes it when its key is already a favorite. Returns the new list.
function toggle(dir, entry) {
  if (!valid(entry)) throw new Error('This item cannot be added to favorites.');
  const cur = list(dir);
  const next = cur.some((e) => e.key === entry.key)
    ? cur.filter((e) => e.key !== entry.key)
    : [{ key: entry.key, type: entry.type, source: entry.source, item: entry.item, addedAt: Date.now() }, ...cur].slice(0, MAX);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${file(dir)}.part`, JSON.stringify(next, null, 1));
  fs.renameSync(`${file(dir)}.part`, file(dir));
  return listForUi(dir);
}

module.exports = { list: listForUi, toggle };
