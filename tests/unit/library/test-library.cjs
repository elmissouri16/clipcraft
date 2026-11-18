// Audio library: host allowlist and download guard, then (unless --offline) searches Openverse /
// SFXMint / MyInstants and downloads one sound. Usage: node tests/unit/library/test-library.cjs [--offline]
// (The old first block rendered every built-in synthesized effect; the built-ins were removed
// from the app on Hamza's call — poor quality, sounded AI-generated — so there is nothing to render.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probe } = require("../../../electron/media/ffmpeg.cjs");
const lib = require("../../../electron/library/library.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-lib-'));
  let searchEvidence;

  if (!lib.hostOk('https://prod-1.storage.jamendo.com/?trackid=1') || lib.hostOk('https://evil.example/jamendo.com') || lib.hostOk('http://cdn.freesound.org/x')) {
    throw new Error('host allowlist');
  }
  await lib.download(fetch, dir, { id: '../../etc', url: 'https://cdn.freesound.org/x.mp3' }).then(() => { throw new Error('bad id accepted'); }, () => {});

  if (!process.argv.includes('--offline')) {
    const sfx = await lib.search(fetch, { kind: 'sfx', q: 'whoosh' });
    const defaultMusic = await lib.search(fetch, { kind: 'music', q: 'happy' });
    // A valid CC0 query can have no matches. Exercise the explicit credit-required
    // option for positive music acceptance, without silently widening the default.
    const music = await lib.search(fetch, { kind: 'music', q: 'happy', licenses: 'attribution' });
    searchEvidence = { query: 'happy', defaultMusic: { licenses: 'cc0', total: defaultMusic.total, items: defaultMusic.results.map(({ id, license }) => ({ id, license })) },
      explicitMusic: { licenses: 'attribution', total: music.total, items: music.results.map(({ id, license, licenseUrl }) => ({ id, license, licenseUrl })) } };
    fs.writeFileSync(path.join(dir, 'search-result.json'), JSON.stringify(searchEvidence, null, 2));
    console.log(`search: ${sfx.results.length} effects, ${defaultMusic.results.length} CC0 music, ${music.results.length} music with explicit attribution`);
    console.log('Library search evidence: ' + dir);
    if (!sfx.results.length || !music.results.length) throw new Error('empty search');
    if ([...sfx.results, ...defaultMusic.results].some((r) => r.license !== 'cc0') || music.results.some((r) => !['cc0', 'by'].includes(r.license))) throw new Error('license filter');
    // SFXMint: words and categories, CC0 only, downloads keep the file.
    const mintQ = await lib.search(fetch, { kind: 'sfxmint', q: 'whoosh' });
    const mintC = await lib.search(fetch, { kind: 'sfxmint', category: 'ui' });
    console.log(`sfxmint: ${mintQ.results.length} for whoosh, ${mintC.results.length} in ui`);
    if (!mintQ.results.length || !mintC.results.length || [...mintQ.results, ...mintC.results].some((r) => r.license !== 'cc0')) throw new Error('sfxmint search');
    const mintFile = await lib.download(fetch, dir, mintC.results[0]);
    if ((await probe(mintFile)).type !== 'audio') throw new Error('sfxmint download is not audio');
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
    // Both sources in one list (category for one, words for the other).
    const all = await lib.search(fetch, { kind: 'sfxall', q: 'transition', category: 'transition' });
    const srcs = new Set(all.results.map((r) => r.provider));
    console.log(`sfxall: ${all.results.length} results from ${[...srcs].join(', ')}, ${all.pages} pages`);
    if (!srcs.has('sfxmint') || !srcs.has('freesound')) throw new Error('sfxall should mix both sources');
    const more = await lib.search(fetch, { kind: 'sfxall', q: 'transition', category: 'transition', page: 2 });
    if (more.results.some((r) => r.provider === 'sfxmint')) throw new Error('sfxall page 2 repeats the first source');
    if (/SFXMint|Freesound|Jamendo/.test(lib.creditLine(all.results.find((r) => r.provider === 'freesound')))) throw new Error('credit line names the source');
    const pick = sfx.results.find((r) => r.duration < 5) || sfx.results[0];
    const file = await lib.download(fetch, dir, pick);
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
