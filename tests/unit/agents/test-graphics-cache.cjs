// The motion graphics cache (electron/graphics/service.cjs): least recently used graphics go once it
// passes its limit; graphics an open project uses and recently used ones stay; Clear removes the
// rest; a cache hit counts as use; a full cache never fails a render.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { GraphicsService, CACHE_MAX_BYTES, validate } = require('../../../electron/graphics/service.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-graphics-cache-'));
const HOUR = 3600 * 1000;
let now = Date.UTC(2026, 10, 8, 12);
const key = (n) => String(n).repeat(64).slice(0, 64);
function entry(k, mb, ageHours) {
  const dir = path.join(root, k); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graphic.mov'), Buffer.alloc(mb * 1024 * 1024));
  fs.writeFileSync(path.join(dir, 'preview.webm'), 'p');
  const meta = path.join(dir, 'meta.json'); fs.writeFileSync(meta, JSON.stringify({ stats: {} }));
  const t = new Date(now - ageHours * HOUR); fs.utimesSync(meta, t, t);
}
(async () => { try {
  assert.equal(CACHE_MAX_BYTES, 4 * 1024 ** 3);
  const service = new GraphicsService({ root, ffmpegPath: 'ffmpeg', probe: async () => ({}), renderGraphic: async () => { throw new Error('not used'); }, maxBytes: 10 * 1024 * 1024, now: () => now });
  entry(key(1), 4, 50); entry(key(2), 4, 40); entry(key(3), 4, 30); entry(key(4), 4, 20); entry(key(5), 4, 0.05);
  fs.mkdirSync(path.join(root, `${key(6)}.part-${process.pid}-abcd`)); // a render in progress is never counted or removed
  assert.equal(service.usage().entries, 5);
  service.setInUse(7, [key(1)]); // an open project uses the oldest
  const pruned = service.prune();
  assert.ok(pruned.bytes <= 10 * 1024 * 1024 + 4096, `fits the limit (${pruned.bytes})`);
  const left = fs.readdirSync(root).sort();
  assert.ok(left.includes(key(1)), 'a graphic an open project uses stays, however old');
  assert.ok(left.includes(key(5)), 'a graphic used minutes ago stays');
  assert.ok(!left.includes(key(2)) && !left.includes(key(3)), 'the least recently used go first');
  assert.ok(left.includes(`${key(6)}.part-${process.pid}-abcd`), 'a render in progress is left alone');

  // A cache hit marks the graphic as used now.
  const req = { code: 'export default () => "<svg/>"', inputs: {}, fonts: [], width: 64, height: 64, fps: 10, duration_sec: 1 };
  const hit = service.key(validate(req)); entry(hit, 1, 99);
  await service.render(req, { samples: false }).catch(() => {}); // probe/samples are faked; the hit path runs first
  assert.ok(now - fs.statSync(path.join(root, hit, 'meta.json')).mtimeMs < 1000, 'a cache hit counts as use');

  // Clear removes everything an open project does not use.
  const cleared = service.clear();
  assert.deepEqual(fs.readdirSync(root).filter((n) => !n.includes('.part-')), [key(1)]);
  assert.equal(cleared.entries, 1);
  assert.ok(fs.readdirSync(root).includes(`${key(6)}.part-${process.pid}-abcd`), 'Clear keeps a render this app is running');
  service.setInUse(7, []);
  assert.equal(service.clear().entries, 0, 'once no project uses it, Clear removes it too');

  // Partial folders of a render whose app quit or crashed (its process is gone), or of an older version
  // (untagged), are removed when the service starts and by Clear.
  const ended = require('node:child_process').spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  fs.mkdirSync(path.join(root, `${key(8)}.part-${ended}-1a2b3c4d`)); fs.mkdirSync(path.join(root, `${key(9)}.part-1a2b3c4d`));
  const restarted = new GraphicsService({ root, ffmpegPath: 'ffmpeg', probe: async () => ({}), renderGraphic: async () => { throw new Error('not used'); }, now: () => now });
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.includes('.part-')), [`${key(6)}.part-${process.pid}-abcd`], 'stale partial folders are swept at start');
  fs.mkdirSync(path.join(root, `${key(9)}.part-0f0f0f0f`)); restarted.clear();
  assert.ok(!fs.existsSync(path.join(root, `${key(9)}.part-0f0f0f0f`)), 'and by Clear');

  // Quitting aborts every render and removes its partial folder at once.
  let seen;
  const slow = new GraphicsService({ root, ffmpegPath: 'ffmpeg', probe: async () => ({}), now: () => now, renderGraphic: ({ dir, signal }) => new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'text.mov.in'), 'frames'); seen = dir;
    signal.addEventListener('abort', () => reject(Object.assign(Error('Graphic render stopped.'), { name: 'AbortError' })), { once: true });
  }) });
  const pending = slow.render({ ...req, inputs: { n: 2 } }, { samples: false });
  while (!seen) await new Promise((r) => setTimeout(r, 5));
  assert.match(path.basename(seen), new RegExp(`\\.part-${process.pid}-[0-9a-f]{8}$`), 'partial folders name their process');
  slow.abortAll();
  assert.ok(!fs.existsSync(seen), 'the partial folder is removed synchronously');
  await assert.rejects(pending, (e) => e.name === 'AbortError');
  assert.equal(slow.active.size, 0);
  console.log('GRAPHICS CACHE OK (limit, least recently used first, in-use and recent kept, renders in progress kept, cache hit counts as use, clear, stale partial folders swept, renders aborted at quit)');
} finally { fs.rmSync(root, { recursive: true, force: true }); } })().catch((e) => { console.error(e); process.exitCode = 1; });
