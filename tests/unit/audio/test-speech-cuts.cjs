// Audio-accurate cut edges: transcript times that drift by 0.2 s still cut the
// real filler between its pauses; fillers glued to a word are skipped; real
// FFmpeg decode path through refineCuts.
// Usage: node tests/unit/audio/test-speech-cuts.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { refineSpans, refineCuts, isHesitation, SR } = require('../../../electron/audio/speechCuts.cjs');
const { ffmpegPath } = require('../../../electron/media/ffmpeg.cjs');

// Voiced bursts [start, end] (seconds) with a faint noise floor between them.
function speech(bursts, seconds) {
  const out = new Float32Array(Math.round(seconds * SR));
  let seed = 3;const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.0005;
  for (const [a, b, f = 180] of bursts) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) out[i] += 0.3 * Math.sin(2 * Math.PI * f * i / SR);
  return out;
}
const near = (a, b, eps = 0.03) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
(async () => {
  // "Because [pause] um [pause] they": fillers are 140 Hz bursts, words 180 Hz. The stub
  // recognizer "hears" a clip by its pitch (zero crossings), like Whisper on an isolated clip.
  const audio = speech([[0.2, 0.9], [1.05, 1.3, 140], [1.45, 2.1], [2.6, 3.0], [3.0, 3.25, 140], [3.4, 3.9]], 4.5);
  const heard = [];
  const verify = async files => files.map(file => {
    const b = fs.readFileSync(file), n = (b.length - 44) / 2;let crossings = 0, prev = 0, first = -1, last = -1;
    for (let i = 0; i < n; i++) { const v = b.readInt16LE(44 + i * 2); if (Math.abs(v) > 3000) { if (first < 0) first = i; last = i; if (prev && Math.sign(v) !== Math.sign(prev)) crossings++; prev = v; } }
    const text = first >= 0 && Math.abs(crossings / 2 / ((last - first) / SR) - 140) < 15 ? 'Um.' : 'They hope.';heard.push(text);return text;
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-cuts-unit-'));
  // The transcript places um 0.3 s early, overlapping "Because"; the glued 3.0 s filler has no pause before it.
  const [um, joined, wide] = await refineSpans(audio, [
    { start: 0.75, end: 1.0, kind: 'word' },
    { start: 2.95, end: 3.3, kind: 'word' },
    { start: 0.2, end: 1.45 },
  ], { verify, tmpDir });
  near(um.start, 0.975); near(um.end, 1.375); assert.equal(um.heard, 'Um.');
  assert.ok(heard.includes('They hope.'), 'neighbouring word sounds were checked and rejected');
  assert.match(joined.skip, /no short sound|not confirmed/);
  // Edge mode (multi-word spans): edges land in the pauses, never inside speech.
  assert.ok(wide.start < 0.2 && wide.end > 1.3 && wide.end < 1.45, JSON.stringify(wide));
  // Without a recognizer a filler is never cut on timing alone.
  assert.equal((await refineSpans(audio, [{ start: 1.05, end: 1.3, kind: 'word' }]))[0].skip, 'audio check unavailable');
  // A sound that is not heard as a hesitation is not cut.
  assert.match((await refineSpans(audio, [{ start: 1.45, end: 2.1, kind: 'word' }], { verify: async f => f.map(() => 'hello'), tmpDir }))[0].skip, /not confirmed/);
  assert.ok(isHesitation('Uh, uh, uh.') && isHesitation('Um.') && isHesitation('امم') && !isHesitation('[BLANK_AUDIO]') && !isHesitation('um, hello'));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-cuts-'));
  try {
    const raw = path.join(dir, 'a.f32'), wav = path.join(dir, 'a.wav');
    fs.writeFileSync(raw, Buffer.from(audio.buffer));
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, wav]);
    let selection;
    const res = await refineCuts({ id: 'p' }, { spans: [{ start: 0.85, end: 1.1, kind: 'word' }], source: 'video', clip_ids: ['v'], ffmpegPath, verify,
      renderAudio: async (_p, out, opts) => { selection = opts; fs.copyFileSync(wav, out); return out; } });
    assert.equal(res.ok, true); near(res.ranges[0].start, 0.975); near(res.ranges[0].end, 1.375);
    assert.deepEqual([selection.source, selection.clip_ids], ['video', ['v']]);
    await assert.rejects(refineCuts({}, { spans: [{ start: 2, end: 1 }], ffmpegPath, renderAudio: async () => wav }), /valid spans/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('speech cuts: drifted transcript times cut the verified filler; unconfirmed or glued fillers skipped; real decode');
})().catch(error => { console.error(error); process.exitCode = 1; });
