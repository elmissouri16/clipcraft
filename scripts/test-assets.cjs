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
  fs.mkdirSync(path.join(root, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Characters', 'hero.png'), 'x');
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ items: [
    { name: 'Pop', file: 'Sound FX/pop.wav', group: 'Sound FX', sub: 'UI', kind: 'audio', duration: 0.4, poster: 'Sound FX/pop.webp' },
    { name: 'Gone', file: 'Sound FX/gone.wav', group: 'Sound FX', sub: 'UI', kind: 'audio', duration: 1 },
    { name: 'Escape', file: '../outside.wav', group: 'Sound FX', sub: 'UI', kind: 'audio' },
    { name: 'Hero', file: 'Characters/hero.png', group: 'Characters', sub: '', kind: 'image', dims: '800x1000' },
  ] }));
  const lib = assets.readLibrary(root);
  assert.equal(lib.hasLibrary, true);
  assert.equal(lib.total, 3); // the escaping entry is refused
  assert.equal(lib.counts['Sound FX'], 2);
  const pop = lib.items.find((i) => i.name === 'Pop');
  assert.equal(pop.missing, false);
  assert.equal(pop.path, path.join(root, 'Sound FX', 'pop.wav'));
  assert.equal(pop.poster, path.join(root, 'Sound FX', 'pop.webp'));
  assert.equal(lib.items.find((i) => i.name === 'Gone').missing, true); // flagged, not dropped
  // Image kind survives the manifest round-trip (pack 2 is mostly stills) and maps to the
  // overlay lane like video — never to audio, which is where images used to be coerced.
  const hero = lib.items.find((i) => i.name === 'Hero');
  assert.equal(hero.kind, 'image');
  assert.equal(hero.dims, '800x1000');
  assert.equal(assets.laneFor(hero), 'overlay');
  assert.deepEqual(assets.GROUPS, ['Music', 'Sound FX', 'Transitions', 'Overlays', 'Characters', 'Icons', '3D']);
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
    assert.equal(assets.laneFor(i), (i.kind === 'video' || i.kind === 'image') ? 'overlay' : 'audio', `${i.name} (${i.kind})`);
  }
  assert.equal(plib.items.filter((i) => i.group === 'Music' && i.kind === 'video').length, 1);
  assert.equal(plib.items.filter((i) => i.group === 'Sound FX' && i.kind === 'video').length, 2);

  // ---- renderer helpers (src/assetsLib.js) agree + classify truthfully ----
  const rl = await import('../src/assetsLib.js');
  assert.equal(rl.assetAddWhere({ kind: 'audio' }), 'main'); // addFile routes audio to the audio lane by type
  assert.equal(rl.assetAddWhere({ kind: 'video' }), 'overlay');
  assert.equal(rl.assetAddWhere({ kind: 'image' }), 'overlay'); // stills pin onto the overlay lane too
  // Extended 2026-11-01 for pack 2 (Characters / Icons / 3D). Pack AUDIO is NOT in
  // Assets: Music sits in Audio → Music and Sound FX in Audio → Sound FX (Hamza,
  // 2026-11-01 — sound effects belong in Music, with the music).
  assert.deepEqual(rl.ASSET_GROUPS, ['Transitions', 'Overlays', 'Characters', 'Icons', '3D']);

  // ---- bundled pack fallback (test builds): the user's folder wins, the bundle only
  // fills an empty folder, and nothing changes when there is no bundle ----
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bundle-'));
  fs.mkdirSync(path.join(bundleDir, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'Characters', 'b.png'), 'x');
  fs.writeFileSync(path.join(bundleDir, 'library.json'), JSON.stringify({ items: [
    { name: 'Bundled', file: 'Characters/b.png', group: 'Characters', sub: '', kind: 'image' },
  ] }));
  const udEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ud-'));
  assert.equal(assets.bundledRoot(null, { CLIPCRAFT_BUNDLED_PACK_DIR: bundleDir }), bundleDir);
  assert.equal(assets.bundledRoot(null, { CLIPCRAFT_BUNDLED_PACK_DIR: path.join(bundleDir, 'nope') }), null);
  assert.equal(assets.bundledRoot(null, {}), null);
  const resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-res-'));
  assert.equal(assets.bundledRoot(resDir, {}), null); // no clipcraft-pack in resources yet
  fs.cpSync(bundleDir, path.join(resDir, 'clipcraft-pack'), { recursive: true });
  assert.equal(assets.bundledRoot(resDir, {}), path.join(resDir, 'clipcraft-pack'));
  // (a) empty user folder + bundle → the bundle is served, flagged bundled
  const fromBundle = assets.readLibraryFor(udEmpty, { CLIPCRAFT_BUNDLED_PACK_DIR: bundleDir }, null);
  assert.deepEqual([fromBundle.hasLibrary, fromBundle.bundled, fromBundle.total], [true, true, 1]);
  assert.equal(fromBundle.items[0].path, path.join(bundleDir, 'Characters', 'b.png')); // read in place
  assert.equal(fromBundle.userRoot, path.join(udEmpty, 'clipcraft-assets'));
  // (b) a library in the user's folder takes over — the bundle is ignored
  const udOwn = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ud-'));
  const ownRoot = assets.assetsRoot(udOwn, {});
  fs.mkdirSync(ownRoot, { recursive: true });
  fs.writeFileSync(path.join(ownRoot, 'library.json'), JSON.stringify({ items: [
    { name: 'Mine', file: 'x.wav', group: 'Sound FX', sub: '', kind: 'audio' },
  ] }));
  const fromOwn = assets.readLibraryFor(udOwn, { CLIPCRAFT_BUNDLED_PACK_DIR: bundleDir }, null);
  assert.deepEqual([fromOwn.hasLibrary, fromOwn.bundled, fromOwn.total, fromOwn.items[0].name], [true, false, 1, 'Mine']);
  // (c) no user library and no bundle → today's empty state, unflagged
  const fromNone = assets.readLibraryFor(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ud-')), {}, null);
  assert.deepEqual([fromNone.hasLibrary, fromNone.bundled, fromNone.total], [false, false, 0]);

  // ---- the merged 570-item pack (~/workspace/clipcraft-pack-merged) reads clean ----
  const mergedRoot = path.join(__dirname, '..', '..', 'clipcraft-pack-merged');
  if (fs.existsSync(path.join(mergedRoot, 'library.json'))) {
    const mlib = assets.readLibrary(mergedRoot);
    assert.equal(mlib.total, 570);
    assert.deepEqual(mlib.counts, { Music: 111, 'Sound FX': 151, Transitions: 44, Overlays: 95, Characters: 109, Icons: 55, '3D': 5 });
    assert.equal(mlib.items.filter((i) => i.missing).length, 0); // zero dangling entries
    const kinds = {};
    for (const i of mlib.items) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
    assert.deepEqual(kinds, { audio: 262, video: 183, image: 125 });
    // Every image item must resolve a poster thumbnail: the stills run to 11777×8328 and
    // a panel decoding them at full size OOM-crashes the renderer (proven in E2E).
    assert.equal(mlib.items.filter((i) => i.kind === 'image' && !i.poster).length, 0);
    for (const i of mlib.items) {
      assert.equal(assets.laneFor(i), i.kind === 'audio' ? 'audio' : 'overlay', `${i.name} (${i.kind})`);
    }
  } else {
    console.log('merged pack folder not present — merged-library assertions skipped');
  }

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
