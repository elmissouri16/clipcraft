// Audio library: renders every built-in sound effect, then (unless --offline) searches Openverse and downloads one
// sound. Usage: node scripts/test-library.cjs [--offline]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probe } = require('../electron/ffmpeg.cjs');
const lib = require('../electron/library.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-lib-'));
  for (const item of lib.builtinList()) {
    const file = await lib.builtinFile(dir, item.id);
    const info = await probe(file);
    if (info.type !== 'audio' || info.duration < 0.03) throw new Error(`${item.id}: bad file ${JSON.stringify(info)}`);
    process.stdout.write(`${item.title} ${info.duration.toFixed(2)}s · `);
  }
  console.log(`\n${lib.builtinList().length} built-in sounds OK`);

  if (!lib.hostOk('https://prod-1.storage.jamendo.com/?trackid=1') || lib.hostOk('https://evil.example/jamendo.com') || lib.hostOk('http://cdn.freesound.org/x')) {
    throw new Error('host allowlist');
  }
  await lib.download(fetch, dir, { id: '../../etc', url: 'https://cdn.freesound.org/x.mp3' }).then(() => { throw new Error('bad id accepted'); }, () => {});

  if (!process.argv.includes('--offline')) {
    const sfx = await lib.search(fetch, { kind: 'sfx', q: 'whoosh' });
    const music = await lib.search(fetch, { kind: 'music', q: 'happy' });
    console.log(`search: ${sfx.results.length} effects, ${music.results.length} music`);
    if (!sfx.results.length || !music.results.length) throw new Error('empty search');
    if ([...sfx.results, ...music.results].some((r) => !['cc0', 'pdm', 'by'].includes(r.license))) throw new Error('license filter');
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
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('LIBRARY OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
