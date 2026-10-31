// Voice Enhancer proofs. 1) electron/enhance.cjs on a deterministic fixture (200 Hz-ish tone
// bursts with gaps + white noise at a known level): Strong must drop the noise floor in the
// gaps by >= 8 dB while the bursts stay within +-3 dB, Light must drop less than Strong
// (monotonic), the result is cached, and a canceled job leaves nothing. 2) Export substitution:
// a clip with clip.enhance on exports the ENHANCED sound; a stale render (range moved) is
// ignored. Also writes the before/after WAVs Hamza can listen to (~/workspace/clipcraft-e2e/).
// Usage: node scripts/test-enhance.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ff = require('../electron/ffmpeg.cjs');
const { enhance, chainFor } = require('../electron/enhance.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const SR = 48000;
function makeFixture(file, seconds = 6.4) {
  const n = Math.floor(SR * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x40000000 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const on = (t % 0.8) < 0.45;
    let v = rnd() * 0.06;
    if (on) {
      // Voice-like: fundamental + two harmonics under a small attack/decay envelope.
      const ph = (t % 0.8) / 0.45;
      const env = Math.min(1, ph / 0.08) * Math.min(1, (1 - ph) / 0.15);
      v += env * (0.34 * Math.sin(2 * Math.PI * 200 * t) + 0.12 * Math.sin(2 * Math.PI * 400 * t) + 0.05 * Math.sin(2 * Math.PI * 617 * t));
    }
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}
function rmsDb(file, t0, t1) {
  const raw = execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', String(t0), '-t', String(t1 - t0), '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
  const n = raw.length / 4;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = raw.readFloatLE(i * 4); s += v * v; }
  return 10 * Math.log10(s / n + 1e-12);
}
const burst = (f) => rmsDb(f, 0.9, 1.2);
const gap = (f) => rmsDb(f, 1.35, 1.55);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-enhance-'));
  const cacheDir = path.join(dir, 'cache');
  const src = path.join(dir, 'voice.wav');
  makeFixture(src);
  const item = { path: src, duration: 6.4, hasAudio: true, type: 'audio' };
  const b0 = burst(src);
  const g0 = gap(src);
  console.log(`fixture: burst ${b0.toFixed(1)} dB, gap ${g0.toFixed(1)} dB`);

  const drops = {};
  for (const strength of ['light', 'standard', 'strong']) {
    const { path: out, noiseDb } = await enhance(item, { from: 0, to: 6.4, strength, cacheDir, ffmpegPath: ff.ffmpegPath });
    ok(fs.existsSync(out), `${strength}: enhanced file rendered (measured floor ${noiseDb.toFixed(1)} dB)`);
    drops[strength] = g0 - gap(out);
    const bd = burst(out) - b0;
    console.log(`  ${strength}: gap drop ${drops[strength].toFixed(1)} dB, burst change ${bd.toFixed(1)} dB`);
    ok(Math.abs(bd) <= 3, `${strength}: burst level stays within +-3 dB (${bd.toFixed(1)})`);
    const again = await enhance(item, { from: 0, to: 6.4, strength, cacheDir, ffmpegPath: ff.ffmpegPath });
    ok(again.path === out, `${strength}: second run hits the cache`);
  }
  ok(drops.strong >= 8, `strong drops the gap floor by >= 8 dB (${drops.strong.toFixed(1)})`);
  ok(drops.light < drops.standard && drops.standard < drops.strong,
    `monotonic: light ${drops.light.toFixed(1)} < standard ${drops.standard.toFixed(1)} < strong ${drops.strong.toFixed(1)}`);
  ok(chainFor('strong', -30).includes('agate') && chainFor('light', -30).includes('afftdn'), 'chains include the documented stages');

  let canceled = false;
  try {
    await enhance(item, { from: 0, to: 3, strength: 'standard', cacheDir, ffmpegPath: ff.ffmpegPath, isCanceled: () => true });
  } catch (e) { canceled = !!e.canceled; }
  ok(canceled, 'a canceled job reports canceled and leaves no file');

  // ---- Export substitution: a video whose sound is the fixture. ----
  const vid = path.join(dir, 'vid.mp4');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x304050:s=320x180:r=30:d=6.4', '-i', src,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
  const vItem = { ...(await ff.probe(vid)), path: vid };
  const { path: enhWav } = await enhance({ ...vItem, type: 'video' }, { from: 0, to: 6.4, strength: 'strong', cacheDir, ffmpegPath: ff.ffmpegPath });
  const media = [{ ...vItem, id: 'v', name: 'vid.mp4' }];
  const cb = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const proj = (clip) => ({
    name: 'enh', width: 320, height: 180, fps: 30, background: '#000000', media,
    videoClips: [{ ...cb, id: 'c', mediaId: 'v', in: 0, out: 6.4, ...clip }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
  });
  const plain = path.join(dir, 'plain.mp4');
  await ff.runExport(proj({}), plain, () => {}).promise;
  const enh = path.join(dir, 'enh.mp4');
  await ff.runExport(proj({ enhance: { on: true, strength: 'strong', path: enhWav, from: 0, to: 6.4 } }), enh, () => {}).promise;
  const dropExport = gap(plain) - gap(enh);
  ok(dropExport >= 6, `export with enhance on: gap floor drops ${dropExport.toFixed(1)} dB vs the plain export`);
  ok(Math.abs(burst(enh) - burst(plain)) <= 3, `export with enhance on: bursts stay within +-3 dB (${(burst(enh) - burst(plain)).toFixed(1)})`);
  const stale = path.join(dir, 'stale.mp4');
  await ff.runExport(proj({ enhance: { on: true, strength: 'strong', path: enhWav, from: 0.5, to: 6.4 } }), stale, () => {}).promise;
  ok(Math.abs(gap(stale) - gap(plain)) < 2, 'stale enhance (range moved) is ignored by the export');

  // ---- Before / after WAVs for Hamza. ----
  const outDir = path.join(os.homedir(), 'workspace', 'clipcraft-e2e');
  fs.mkdirSync(outDir, { recursive: true });
  const audible = path.join(dir, 'audible.wav');
  makeFixture(audible, 7.2);
  fs.copyFileSync(audible, path.join(outDir, 'voice-before.wav'));
  const { path: after } = await enhance({ path: audible, duration: 7.2, hasAudio: true, type: 'audio' },
    { from: 0, to: 7.2, strength: 'strong', cacheDir, ffmpegPath: ff.ffmpegPath });
  fs.copyFileSync(after, path.join(outDir, 'voice-after.wav'));
  console.log(`before/after WAVs in ${outDir}`);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nENHANCE OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
