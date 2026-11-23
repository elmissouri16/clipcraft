// Audio library: host allowlist and download guard, then (unless --offline) searches Openverse /
// MyInstants and downloads one sound. Usage: node tests/unit/library/test-library.cjs [--offline]
// (The old first block rendered every built-in synthesized effect; the built-ins were removed
// from the app on Hamza's call — poor quality, sounded AI-generated — so there is nothing to render.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probe } = require("../../../electron/media/ffmpeg.cjs");
const ov = require("../../../electron/bundled-media/openverse/dist/client.cjs");
const lib = require("../../../electron/bundled-media/myinstants/dist/client.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-lib-'));
  let searchEvidence;

  if (!ov.hostOk('https://prod-1.storage.jamendo.com/?trackid=1') || lib.hostOk('https://evil.example/jamendo.com') || lib.hostOk('http://cdn.freesound.org/x')) {
    throw new Error('host allowlist');
  }
  await lib.download(fetch, dir, { id: '../../etc', url: 'https://cdn.freesound.org/x.mp3' }).then(() => { throw new Error('bad id accepted'); }, () => {});
  // SFXMint was withdrawn (keyless downloads ended upstream on 2026-11-17): its host is refused and its
  // kinds no longer search it, but a sound kept earlier is still served from disk without a request.
  const noFetch = () => { throw new Error('unexpected request'); };
  if (lib.hostOk('https://sfxmint.com/dl/ui-click-30.mp3')) throw new Error('withdrawn host allowed');
  await lib.download(noFetch, dir, { id: 'sfxmint-ui-click-30', url: 'https://sfxmint.com/dl/ui-click-30.mp3' }).then(() => { throw new Error('withdrawn source downloaded'); }, (e) => { if (!/cannot be downloaded/.test(e.message)) throw e; });
  fs.mkdirSync(path.join(dir, 'online'), { recursive: true });
  const kept = path.join(dir, 'online', 'sfxmint-kept-sound-01.mp3');
  fs.writeFileSync(kept, 'kept');
  if (await lib.download(noFetch, dir, { id: 'sfxmint-kept-sound-01', url: 'https://sfxmint.com/dl/kept-sound-01.mp3' }) !== kept) throw new Error('kept sound not reused');

  if (!process.argv.includes('--offline')) {
    const sfx = await ov.search(fetch, { kind: 'sfx', q: 'whoosh' });
    const defaultMusic = await ov.search(fetch, { kind: 'music', q: 'happy' });
    // A valid CC0 query can have no matches. Exercise the explicit credit-required
    // option for positive music acceptance, without silently widening the default.
    const music = await ov.search(fetch, { kind: 'music', q: 'happy', licenses: 'attribution' });
    searchEvidence = { query: 'happy', defaultMusic: { licenses: 'cc0', total: defaultMusic.total, items: defaultMusic.results.map(({ id, license }) => ({ id, license })) },
      explicitMusic: { licenses: 'attribution', total: music.total, items: music.results.map(({ id, license, licenseUrl }) => ({ id, license, licenseUrl })) } };
    fs.writeFileSync(path.join(dir, 'search-result.json'), JSON.stringify(searchEvidence, null, 2));
    console.log(`search: ${sfx.results.length} effects, ${defaultMusic.results.length} CC0 music, ${music.results.length} music with explicit attribution`);
    console.log('Library search evidence: ' + dir);
    if (!sfx.results.length || !music.results.length) throw new Error('empty search');
    if ([...sfx.results, ...defaultMusic.results].some((r) => r.license !== 'cc0') || music.results.some((r) => !['cc0', 'by'].includes(r.license))) throw new Error('license filter');
    // Trolls (MyInstants): trending, best and words, every sound marked license unknown; pages go on.
    const trend = await lib.search(fetch, { kind: 'trolls', category: 'trending' });
    const best = await lib.search(fetch, { kind: 'trolls', category: 'best' });
    const bruh = await lib.search(fetch, { kind: 'trolls', q: 'bruh' });
    const bruh2 = await lib.search(fetch, { kind: 'trolls', q: 'bruh', page: 2 });
    console.log(`trolls: ${trend.results.length} trending, ${best.results.length} best, ${bruh.results.length} + ${bruh2.results.length} for bruh`);
    const trolls = [...trend.results, ...best.results, ...bruh.results];
    if (!trend.results.length || !best.results.length || !bruh.results.length || bruh.pages < 2) throw new Error('trolls search');
    if (trolls.some((r) => r.license !== 'unknown' || !lib.hostOk(r.url))) throw new Error('trolls must be marked license unknown');
    if (bruh2.results[0]?.id === bruh.results[0].id) throw new Error('trolls page 2 repeats page 1');
    if ((await probe(await lib.download(fetch, dir, bruh.results[0]))).type !== 'audio') throw new Error('trolls download is not audio');
    if (/Freesound|Jamendo/.test(lib.creditLine(sfx.results[0]))) throw new Error('credit line names the source');
    const pick = sfx.results.find((r) => r.duration < 5) || sfx.results[0];
    const {path:file} = await ov.download(fetch, dir, pick);
    const info = await probe(file);
    console.log(`downloaded "${pick.title}" ${info.duration.toFixed(2)}s · ${lib.creditLine(pick)}`);
    if (info.type !== 'audio') throw new Error('download is not audio');
  }
  fs.rmSync(path.join(dir, 'online'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, offline: process.argv.includes('--offline'), searchEvidence }, null, 2));
  console.log('Library evidence: ' + dir);
  console.log('LIBRARY OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
