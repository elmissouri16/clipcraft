// Beat tracking and loudness: synthetic click tracks with known tempo, then the
// real FFmpeg decode/ebur128 path through the rhythm service.
// Usage: node tests/unit/audio/test-rhythm.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { analyzeSamples, parseLoudness, createRhythmService, SR } = require('../../../electron/audio/rhythm.cjs');
const { ffmpegPath } = require('../../../electron/media/ffmpeg.cjs');

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
// Decaying noise bursts on each beat; the first beat of each bar is louder.
function clicks(bpm, seconds, { offset = 0.25, accent = 2 } = {}) {
  const out = new Float32Array(Math.round(seconds * SR)), period = 60 / bpm;
  let seed = 7;const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let k = 0, t = offset; t < seconds; k++, t = offset + k * period) {
    const start = Math.round(t * SR), gain = k % 4 === 0 ? 0.9 : 0.9 / accent;
    for (let i = 0; i < SR * 0.06 && start + i < out.length; i++) out[start + i] += gain * rand() * Math.exp(-i / (SR * 0.012));
  }
  return out;
}

(async () => {
  for (const bpm of [90, 120, 140]) await check(`tempo and beat grid at ${bpm} BPM`, () => {
    const res = analyzeSamples(clicks(bpm, 20));
    assert.ok(Math.abs(res.bpm - bpm) <= bpm * 0.03, `bpm ${res.bpm}`);
    const period = 60 / bpm, aligned = res.beats.filter(t => { const k = Math.round((t - 0.25) / period); return Math.abs(t - (0.25 + k * period)) < 0.02; });
    assert.ok(aligned.length >= res.beats.length * 0.9, `${aligned.length}/${res.beats.length} beats aligned`);
    // Downbeats follow the accented first beat of each bar.
    const bar = period * 4, onBar = res.downbeats.filter(t => Math.abs(((t - 0.25) / bar) - Math.round((t - 0.25) / bar)) * bar < 0.05);
    assert.ok(onBar.length >= res.downbeats.length * 0.8, `${onBar.length}/${res.downbeats.length} downbeats on bar starts`);
  });
  await check('silence and very short audio are refused', () => {
    assert.throws(() => analyzeSamples(new Float32Array(SR * 10)), /silent/);
    assert.throws(() => analyzeSamples(clicks(120, 2)), /at least 3 seconds/);
  });
  await check('offset shifts beats into timeline seconds', () => {
    const res = analyzeSamples(clicks(120, 12), { offset_sec: 30 });
    assert.ok(res.beats[0] >= 30 && res.beats[0] < 31);
  });
  await check('ebur128 summary parsing', () => {
    const log = 'frame...\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.3 LUFS\n    Threshold: -24.5 LUFS\n\n  Loudness range:\n    LRA:         6.1 LU\n\n  True peak:\n    Peak:       -1.2 dBFS\n';
    assert.deepEqual(parseLoudness(log), { integrated_lufs: -14.3, loudness_range_lu: 6.1, true_peak_db: -1.2 });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-rhythm-'));
  try {
    const raw = path.join(dir, 'clicks.f32'), wav = path.join(dir, 'clicks.wav');
    fs.writeFileSync(raw, Buffer.from(clicks(128, 16).buffer));
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-ar', '16000', wav]);
    let rendered = null;
    const service = createRhythmService({ ffmpegPath, renderAudio: async (project, out, opts) => { rendered = opts; fs.copyFileSync(wav, out); return out; } });
    await check('real decode path finds the tempo of a rendered mix', async () => {
      const res = await service.beats({ id: 'p' }, { clip_ids: ['music'], source: 'all', start_sec: 2, end_sec: 14 });
      assert.equal(res.ok, true); assert.ok(Math.abs(res.bpm - 128) <= 4, `bpm ${res.bpm}`);
      assert.ok(res.beats[0] >= 2 && res.beats.at(-1) <= 14.1); assert.equal(res.analyzed_sec, 12);
      assert.deepEqual(rendered.clip_ids, ['music']);
    });
    await check('real ebur128 loudness measurement', async () => {
      const res = await service.loudness({ id: 'p' }, {});
      assert.equal(res.ok, true); assert.ok(Number.isFinite(res.integrated_lufs) && res.integrated_lufs < 0, String(res.integrated_lufs));
      assert.ok(Number.isFinite(res.true_peak_db));
    });
    await check('abort stops analysis', async () => {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(service.beats({ id: 'p' }, { signal: controller.signal }), /stopped/);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`${checks.length} rhythm checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
