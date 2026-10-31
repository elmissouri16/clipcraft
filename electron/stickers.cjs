// Animated stickers: Google's Noto Animated Emoji (https://googlefonts.github.io/noto-emoji-animation/), free under
// CC BY 4.0, no account or key. The list (about 900 emoji, with categories and tags) is cached for a week; a
// sticker is downloaded once, as a GIF (FFmpeg plays it in the export; animated WebP it cannot read), when it is
// first added.
// Pure module: the caller passes `fetch` (Electron's net.fetch in the app, a mock in tests).
const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
const FILE_URL = (cp) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.gif`;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;
const CODEPOINT = /^[0-9a-f]{2,6}(_[0-9a-f]{2,6})*$/;

const CREDIT = {
  license: 'CC BY 4.0', providerName: 'Noto Animated Emoji (Google)', landing: 'https://googlefonts.github.io/noto-emoji-animation/',
  line: 'Animated emoji: Noto Emoji by Google, CC BY 4.0',
};

// The character(s) of a codepoint id such as "1f600" or "1f44b_1f3fd", for the grid.
const charOf = (cp) => String.fromCodePoint(...cp.split('_').map((h) => parseInt(h, 16)));

// [{ id, char, name, category, tags }] sorted by popularity (most used first).
async function list(fetchImpl, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, 'noto-list.json');
  let data = null;
  try {
    if (Date.now() - fs.statSync(cache).mtimeMs < WEEK) data = JSON.parse(fs.readFileSync(cache, 'utf8'));
  } catch { /* no cache yet */ }
  if (!data) {
    try {
      const res = await fetchImpl(LIST_URL, { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      fs.writeFileSync(cache, JSON.stringify(data));
    } catch (e) {
      // Offline: an old list is better than none.
      try { data = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { throw new Error('The sticker list needs an internet connection the first time.'); }
    }
  }
  return (data.icons || [])
    .filter((i) => CODEPOINT.test(i.codepoint || ''))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .map((i) => ({
      id: i.codepoint, char: charOf(i.codepoint),
      name: String((i.tags || [])[0] || i.name || '').replace(/:/g, '').replace(/[-_]/g, ' ').trim(),
      category: (i.categories || [])[0] || 'Other',
      tags: (i.tags || []).map((t) => String(t).replace(/:/g, '').replace(/[-_]/g, ' ')),
    }));
}

const fileOf = (dir, cp) => path.join(dir, `noto-${cp}.gif`);

// The GIF of a sticker on this PC (downloaded the first time). { path, name, credit }
async function get(fetchImpl, dir, cp, name = '') {
  if (!CODEPOINT.test(cp || '')) throw new Error('Unknown sticker.');
  fs.mkdirSync(dir, { recursive: true });
  const file = fileOf(dir, cp);
  if (!fs.existsSync(file)) {
    let res;
    try {
      res = await fetchImpl(FILE_URL(cp), { credentials: 'omit' });
    } catch {
      throw new Error('No internet connection: the sticker could not be downloaded.');
    }
    if (!res.ok) throw new Error(`The sticker could not be downloaded (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES || buf.subarray(0, 3).toString('ascii') !== 'GIF') throw new Error('The sticker download was not a GIF.');
    fs.writeFileSync(`${file}.part`, buf);
    fs.renameSync(`${file}.part`, file);
  }
  return { path: file, name: `${name || cp} (animated).gif`, credit: CREDIT };
}

// Codepoints already downloaded (shown animated in the grid, from the disk).
function downloaded(dir) {
  try {
    return fs.readdirSync(dir).map((f) => /^noto-([0-9a-f_]+)\.gif$/.exec(f)?.[1]).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { list, get, downloaded, fileOf, charOf, CREDIT };
