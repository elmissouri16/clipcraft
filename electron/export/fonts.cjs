// Fonts the user adds (.ttf / .otf / .woff / .woff2): copied into one folder so they stay for every project.
// The renderer loads them from their bytes (the page only allows fonts from the app itself).
const fs = require('fs');
const path = require('path');

const EXT = ['.ttf', '.otf', '.woff', '.woff2'];
const MAX_BYTES = 30 * 1024 * 1024;

// The font's own name from its 'name' table (full name, else family); null for WOFF files or unreadable ones.
function fontName(buf) {
  try {
    const tag = buf.toString('latin1', 0, 4);
    if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag)) return null;
    const n = buf.readUInt16BE(4);
    let off = -1;
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16;
      if (buf.toString('latin1', rec, rec + 4) === 'name') off = buf.readUInt32BE(rec + 8);
    }
    if (off < 0) return null;
    const count = buf.readUInt16BE(off + 2);
    const strings = off + buf.readUInt16BE(off + 4);
    const found = {};
    for (let i = 0; i < count; i++) {
      const r = off + 6 + i * 12;
      const platform = buf.readUInt16BE(r);
      const id = buf.readUInt16BE(r + 6);
      if (id !== 1 && id !== 4) continue;
      const len = buf.readUInt16BE(r + 8);
      const at = strings + buf.readUInt16BE(r + 10);
      let s;
      if (platform === 3 || platform === 0) {
        s = '';
        for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(buf.readUInt16BE(at + k));
      } else if (platform === 1) s = buf.toString('latin1', at, at + len);
      else continue;
      // Windows (3) names win over Mac (1) ones.
      if (s.trim() && (!found[id] || platform === 3)) found[id] = s.trim();
    }
    return found[4] || found[1] || null;
  } catch {
    return null;
  }
}

const nameFromFile = (file) => path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const idOf = (file) => `custom-${path.basename(file).toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;

// [{ id, name, file }] sorted by name.
function list(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => EXT.includes(path.extname(f).toLowerCase()))
    .map((f) => {
      const file = path.join(dir, f);
      let name = null;
      try {
        // The whole file: the name table can sit anywhere in it (files are at most MAX_BYTES).
        name = fontName(fs.readFileSync(file));
      } catch {
        // keep the file name
      }
      return { id: idOf(f), name: name || nameFromFile(f), file };
    })
    // Two files of the same font: the file name tells them apart.
    .map((f, i, all) => (all.some((o, j) => j !== i && o.name === f.name) ? { ...f, name: `${f.name} (${path.basename(f.file)})` } : f))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Copies font files into dir. The same file added twice is kept once. Returns { added: [ids], skipped: [names] }.
function add(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  const added = [];
  const skipped = [];
  for (const src of files) {
    const ext = path.extname(src).toLowerCase();
    let size = 0;
    try {
      size = fs.statSync(src).size;
    } catch {
      // unreadable
    }
    if (!EXT.includes(ext) || !size || size > MAX_BYTES) {
      skipped.push(path.basename(src));
      continue;
    }
    const base = path.basename(src, ext).replace(/[^\w .-]+/g, '_').slice(0, 80) || 'font';
    let name = `${base}${ext}`;
    const bytes = fs.readFileSync(src);
    for (let k = 2; fs.existsSync(path.join(dir, name)); k++) {
      if (fs.readFileSync(path.join(dir, name)).equals(bytes)) break;
      name = `${base} ${k}${ext}`;
    }
    fs.writeFileSync(path.join(dir, name), bytes);
    added.push(idOf(name));
  }
  return { added, skipped };
}

function fileOf(dir, id) {
  return list(dir).find((f) => f.id === id)?.file || null;
}

function remove(dir, id) {
  const file = fileOf(dir, id);
  if (file) fs.unlinkSync(file);
}

module.exports = { list, add, fileOf, remove, fontName, EXT };
