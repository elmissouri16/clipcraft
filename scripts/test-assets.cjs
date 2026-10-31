// Asset pack library: folder-backed manifest loading (electron/assets.cjs), the Media
// tree classification (src/assetsLib.js) and the add-to-timeline mapping both sides agree
// on. Usage: node scripts/test-assets.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assets = require('../electron/assets.cjs');

(async () => {
  // ---- assetsRoot resolution: env override > smoke test folder > userData ----
  assert.equal(assets.assetsRoot('/ud', { CLIPCRAFT_ASSETS_DIR: '/somewhere/pack' }), path.resolve('/somewhere/pack'));
  assert.equal(assets.assetsRoot('/ud', { FVE_SMOKE: '/smoke' }), path.join('/smoke', 'clipcraft-assets-test'));
  assert.equal(assets.assetsRoot('/ud', {}), path.join('/ud', 'clipcraft-assets'));
  assets.ensureRoot(assets.assetsRoot('/ud', { CLIPCRAFT_ASSETS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cc-assets-')) }));

  // ---- readLibrary on a synthetic root ----
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-lib-'));
  fs.mkdirSync(path.join(root, 'Sound FX'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sound FX', 'pop.wav'), 'x');
  fs.writeFileSync(path.join(root, 'Sound FX', 'pop.webp'), 'x');
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ items: [
    { name: 'Pop', file: 'Sound FX/pop.wav', group: 'Sound FX', sub: 'UI', kind: 'audio', duration: 0.4, poster: 'Sound FX/pop.webp' },
    { name: 'Gone', file: 'Sound FX/gone.wav', group: 'Sound FX', sub: 'UI', kind: 'audio', duration: 1 },
    { name: 'Escape', file: '../outside.wav', group: 'Sound FX', sub: 'UI', kind: 'audio' },
  ] }));
  const lib = assets.readLibrary(root);
  assert.equal(lib.hasLibrary, true);
  assert.equal(lib.total, 2); // the escaping entry is refused
  assert.equal(lib.counts['Sound FX'], 2);
  const pop = lib.items.find((i) => i.name === 'Pop');
  assert.equal(pop.missing, false);
  assert.equal(pop.path, path.join(root, 'Sound FX', 'pop.wav'));
  assert.equal(pop.poster, path.join(root, 'Sound FX', 'pop.webp'));
  assert.equal(lib.items.find((i) => i.name === 'Gone').missing, true); // flagged, not dropped
  const noLib = assets.readLibrary(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-nolib-')));
  assert.deepEqual([noLib.hasLibrary, noLib.total], [false, 0]);

  // ---- the real pack manifest parses to Hamza's counts ----
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'asset-pack', 'library-manifest.json'), 'utf8'));
  const proot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pack-'));
  fs.writeFileSync(path.join(proot, 'library.json'), JSON.stringify({ items: pack.items }));
  const plib = assets.readLibrary(proot);
  assert.equal(plib.total, 312);
  assert.deepEqual(plib.counts, { Music: 111, 'Sound FX': 144, Transitions: 25, Overlays: 32 });
  const musicSubs = {};
  for (const i of plib.items.filter((x) => x.group === 'Music')) musicSubs[i.sub] = (musicSubs[i.sub] || 0) + 1;
  assert.deepEqual(musicSubs, { Library: 54, 'آهات': 57 });
  // Add-to-timeline mapping over the whole real pack (module level): the lane follows the
  // file's REAL kind. The manifest has kind anomalies — files whose media type differs
  // from their folder's purpose: 1 Music .mp4 (360x360) and 2 Sound FX videos. They map by
  // kind like everything else (the Music place badging shows the .mp4 as a video).
  for (const i of plib.items) {
    assert.equal(assets.laneFor(i), i.kind === 'video' ? 'overlay' : 'audio', `${i.name} (${i.kind})`);
  }
  assert.equal(plib.items.filter((i) => i.group === 'Music' && i.kind === 'video').length, 1);
  assert.equal(plib.items.filter((i) => i.group === 'Sound FX' && i.kind === 'video').length, 2);

  // ---- renderer helpers (src/assetsLib.js) agree + classify truthfully ----
  const rl = await import('../src/assetsLib.js');
  assert.equal(rl.assetAddWhere({ kind: 'audio' }), 'main'); // addFile routes audio to the audio lane by type
  assert.equal(rl.assetAddWhere({ kind: 'video' }), 'overlay');
  assert.deepEqual(rl.ASSET_GROUPS, ['Sound FX', 'Transitions', 'Overlays']); // Music is NOT an Assets group

  const media = [
    { id: 'v1', type: 'video', name: 'person.mp4', path: '/m/person.mp4' },
    { id: 'v2', type: 'video', name: 'x-rev.mp4', path: '/cache/x-rev.mp4', origin: 'reverse' },
    { id: 'a1', type: 'audio', name: 'song.mp3', path: '/m/song.mp3' },
    { id: 'i1', type: 'image', name: 'photo.png', path: '/m/photo.png' },
    { id: 't1', type: 'audio', name: 'Voice - hello.mp3', path: '/ud/voiceovers/v.mp3', credit: { license: 'piper' } },
    { id: 't2', type: 'audio', name: 'Voice - hi.mp3', path: '/ud/voiceovers/v2.mp3', origin: 'tts' },
    { id: 'd1', type: 'audio', name: 'abc-detach.wav', path: '/cache/abc-detach.wav' }, // pre-tag render: name pattern
    { id: 'r1', type: 'audio', name: 'voiceover-2026-01-01.m4a', path: '/ud/recordings/voiceover-2026-01-01.m4a' }, // own recording: NOT speech
  ];
  const c = rl.mediaTreeCounts(media);
  assert.deepEqual(c, { all: 8, video: 2, audio: 5, image: 1, speech: 2, processed: 2 });
  assert.deepEqual(rl.mediaTreeFilter(media, 'speech').map((m) => m.id), ['t1', 't2']);
  assert.deepEqual(rl.mediaTreeFilter(media, 'processed').map((m) => m.id), ['v2', 'd1']);
  assert.equal(rl.mediaTreeFilter(media, 'all').length, 8);
  assert.equal(rl.mediaTreeFilter(media, 'image').length, 1);
  assert.equal(rl.isSpeechMedia(media[7]), false);

  console.log('ASSETS OK');
})().catch((e) => { console.error(e); process.exit(1); });
