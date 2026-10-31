// Templates: slot order and filling (renderer helpers), and the package / store client (main process) against a
// fake store. Usage: node scripts/test-templates.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fillSlot, slotList, templateMeta } from '../src/templates.js';

const require = createRequire(import.meta.url);
process.env.FVE_TEMPLATES_URL = 'https://store.test';
const tpl = require('../electron/templates.cjs');

// ---- slots ----
const p = {
  ratio: '9:16', width: 720, height: 1280,
  media: [{ id: 'a', type: 'video', duration: 10, path: '' }, { id: 'b', type: 'image', path: '' }],
  videoClips: [
    { id: 'v1', mediaId: 'a', in: 0, out: 2, speed: 1, slot: true },
    { id: 'v2', mediaId: 'a', in: 2, out: 3, speed: 1 },
    { id: 'v3', mediaId: 'b', in: 0, out: 1.5, speed: 1, slot: true },
  ],
  overlayClips: [{ id: 'o1', mediaId: 'a', start: 0.5, in: 0, out: 2, speed: 2, slot: true }],
  textClips: [], audioClips: [], stickerClips: [],
};
const s = slotList(p);
assert.deepEqual(s.map((x) => [x.track, x.clip.id, x.start, x.duration]), [['video', 'v1', 0, 2], ['overlay', 'o1', 0.5, 1], ['video', 'v3', 3, 1.5]]);
assert.deepEqual(templateMeta(p), { ratio: '9:16', width: 720, height: 1280, duration: 4.5, slots: 3 });
// A long video is cut to the slot, a short one slowed down, a photo shown for the slot's length; the length never changes.
assert.deepEqual(fillSlot(p.videoClips[0], { id: 'n', type: 'video', duration: 9 }), { mediaId: 'n', in: 0, out: 2, filled: true });
const slow = fillSlot(p.videoClips[0], { id: 'n', type: 'video', duration: 1 });
assert.equal((slow.out - slow.in) / slow.speed, 2);
assert.deepEqual(fillSlot(p.videoClips[2], { id: 'n', type: 'image' }), { mediaId: 'n', in: 0, out: 1.5, speed: 1, filled: true });
const fast = fillSlot(p.overlayClips[0], { id: 'n', type: 'video', duration: 30 });
assert.equal((fast.out - fast.in) / 2, 1, 'a 2x clip keeps its speed and length');
console.log('slots ok');

// ---- package ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-tpl-'));
const src = path.join(tmp, 'src');
fs.mkdirSync(src);
fs.writeFileSync(path.join(src, 'clip.MP4'), 'video-bytes');
fs.writeFileSync(path.join(src, 'song.mp3'), 'audio-bytes');
fs.writeFileSync(path.join(src, 'unused.mp4'), 'x');
const project = {
  name: 'Beach: days?', ratio: '9:16',
  media: [
    { id: 'a', name: 'clip.MP4', type: 'video', path: path.join(src, 'clip.MP4'), thumb: 'C:/cache/t.jpg', wave: 'w', proxy: 'p' },
    { id: 'b', name: 'song.mp3', type: 'audio', path: path.join(src, 'song.mp3') },
    { id: 'c', name: 'unused.mp4', type: 'video', path: path.join(src, 'unused.mp4') },
  ],
  videoClips: [{ id: 'v1', mediaId: 'a', in: 0, out: 1, slot: true }, { id: 'g', gap: true, in: 0, out: 1 }],
  overlayClips: [], audioClips: [{ id: 'au', mediaId: 'b', start: 0, in: 0, out: 1 }], stickerClips: [], textClips: [],
};
await assert.rejects(tpl.pack(project, { slots: 0 }, tmp), /Make replaceable/);
const out = path.join(tmp, 'out');
fs.mkdirSync(out);
const a = await tpl.pack(project, { ratio: '9:16', duration: 1, slots: 1 }, out);
const b = await tpl.pack(project, { ratio: '9:16', duration: 1, slots: 1 }, out);
assert.equal(path.basename(a.dir), 'Beach days');
assert.equal(path.basename(b.dir), 'Beach days 2', 'an existing package is never overwritten');
assert.deepEqual(a.files.sort(), ['m0.mp4', 'm1.mp3', 'template.json']);
const doc = JSON.parse(fs.readFileSync(path.join(a.dir, 'template.json'), 'utf8'));
assert.equal(doc.format, 'clipcraft-template');
assert.deepEqual(doc.project.media.map((m) => [m.id, m.path]), [['a', 'm0.mp4'], ['b', 'm1.mp3']]);
assert.ok(!('thumb' in doc.project.media[0]) && !('proxy' in doc.project.media[0]), 'cache fields are dropped');
assert.ok(!JSON.stringify(doc).includes(src.replace(/\\/g, '\\\\')), 'no path of this PC in the package');
fs.rmSync(path.join(src, 'clip.MP4'));
await assert.rejects(tpl.pack(project, { slots: 1 }, out), /moved or deleted/);
console.log('package ok');

// ---- store client against a fake store ----
const files = {
  'template.json': fs.readFileSync(path.join(a.dir, 'template.json')),
  'm0.mp4': Buffer.from('video-bytes'), 'm1.mp3': Buffer.from('audio-bytes'),
  'thumb.jpg': Buffer.from('jpg'), 'preview.mp4': Buffer.from('preview'),
};
const ID = '0123456789ab';
const base = `https://store.test/api/v1/templates/${ID}`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let corrupt = false;
const calls = [];
const stream = (buf) => ({ getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(buf) })) }; } });
const fake = async (url, opts = {}) => {
  calls.push([url, opts.method || 'GET']);
  if (url.startsWith('https://store.test/api/v1/templates?') || url === 'https://store.test/api/v1/templates') {
    return { ok: true, status: 200, json: async () => ({ templates: [{ id: ID, title: 'Beach', thumb: `${base}/files/thumb.jpg`, preview: `${base}/files/preview.mp4` }, { id: '../x' }], categories: [{ name: 'Travel', count: 1 }], page: 1, pages: 1, total: 1 }) };
  }
  if (url === base) {
    return { ok: true, status: 200, json: async () => ({ template: { id: ID, title: 'Beach', files: Object.entries(files).map(([name, buf]) => ({ name, size: buf.length, sha256: sha(buf), url: `${base}/files/${name}` })) } }) };
  }
  if (url === `${base}/use`) return { ok: true, status: 204 };
  const name = url.slice(`${base}/files/`.length);
  if (files[name]) return { ok: true, status: 200, body: stream(corrupt && name === 'm0.mp4' ? Buffer.from('evil-bytes!') : files[name]) };
  return { ok: false, status: 404 };
};
const listed = await tpl.list(fake, { q: 'beach', ratio: '9:16', evil: 'x' });
assert.equal(listed.templates.length, 1, 'bad ids are dropped');
assert.ok(calls[0][0].includes('q=beach') && calls[0][0].includes('ratio=9%3A16') && !calls[0][0].includes('evil'));
const cache = path.join(tmp, 'cache');
const th = await tpl.thumb(fake, cache, listed.templates[0]);
assert.equal(fs.readFileSync(th, 'utf8'), 'jpg');
assert.equal(await tpl.thumb(fake, cache, { id: ID, thumb: 'https://evil.test/x.jpg' }), null, 'files outside the store are refused');
corrupt = true;
await assert.rejects(tpl.download(fake, cache, ID), /damaged/);
corrupt = false;
const progress = [];
const got = await tpl.download(fake, cache, ID, (f) => progress.push(f));
const proj = JSON.parse(got.json);
assert.equal(proj.media[0].path, path.join(cache, ID, 'm0.mp4'));
assert.equal(fs.readFileSync(proj.media[0].path, 'utf8'), 'video-bytes');
assert.deepEqual(proj.template, { id: ID, title: 'Beach' });
assert.ok(!fs.existsSync(path.join(cache, ID, 'preview.mp4')), 'the preview is not part of the download');
assert.equal(progress[progress.length - 1], 1);
await tpl.use(fake, ID);
assert.deepEqual(calls[calls.length - 1], [`${base}/use`, 'POST']);
await assert.rejects(tpl.download(fake, cache, '../../etc'), /Unknown template/);
console.log('store ok');

// ---- legacy packages still open; an unpublished store feed is an empty store, not an error ----
// The same package, but its template.json carries the legacy v1 format id (written before the rename).
const ID2 = '0123456789cd';
const base2 = `https://store.test/api/v1/templates/${ID2}`;
const legacyDoc = JSON.parse(files['template.json'].toString('utf8'));
legacyDoc.format = 'caprocket-template'; // the legacy v1 format id — kept here to prove the read shim
const files2 = { ...files, 'template.json': Buffer.from(JSON.stringify(legacyDoc)) };
const fake2 = async (url, opts = {}) => {
  if (url === base2) {
    return { ok: true, status: 200, json: async () => ({ template: { id: ID2, title: 'Beach', files: Object.entries(files2).map(([name, buf]) => ({ name, size: buf.length, sha256: sha(buf), url: `${base2}/files/${name}` })) } }) };
  }
  if (url === `${base2}/use`) return { ok: true, status: 204 };
  const name = url.slice(`${base2}/files/`.length);
  if (files2[name]) return { ok: true, status: 200, body: stream(files2[name]) };
  return { ok: false, status: 404 };
};
const got2 = await tpl.download(fake2, path.join(tmp, 'cache2'), ID2);
assert.equal(JSON.parse(got2.json).media[0].path.endsWith('m0.mp4'), true, 'a legacy-format package downloads and opens');
// The store feed answering 404 (not published yet) lists as empty instead of throwing.
const gone = async () => ({ ok: false, status: 404 });
assert.deepEqual(await tpl.list(gone, {}), { templates: [], categories: [], page: 1, pages: 1, total: 0 }, 'a 404 store feed is an empty store');
console.log('legacy + empty-store ok');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('TEMPLATES OK');
