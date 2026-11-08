// Narration from one speech request (electron/audio/narration.cjs): real WAVs through ffmpeg. A
// passage of three "lines" (tone bursts like words, short pauses inside a line, long pauses between
// lines) is cut back into three files of the right lengths; a passage whose pauses do not match the
// lines falls back to one request per line; cached lines need no request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { speakLines, planLines } = require('../../../electron/audio/narration.cjs');
const { ffmpegPath, probe } = require('../../../electron/media/ffmpeg.cjs');

// 24 kHz mono WAV from [['tone'|'gap', seconds]].
function wav(file, parts) {
  const rate = 24000, samples = parts.reduce((n, [, s]) => n + Math.round(s * rate), 0), buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF'); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  let o = 44, n = 0;
  for (const [kind, s] of parts) for (let i = 0; i < Math.round(s * rate); i++, n++, o += 2) buf.writeInt16LE(kind === 'tone' ? Math.round(9000 * Math.sin(n * 2 * Math.PI * 220 / rate)) : 0, o);
  fs.writeFileSync(file, buf);
  return file;
}
// A line of speech: words (tones) with short pauses between them.
const line = (seconds) => { const out = []; const words = Math.max(1, Math.round(seconds / 0.45)); for (let i = 0; i < words; i++) out.push(['tone', seconds / words - 0.12], ['gap', 0.12]); out.pop(); return out; };

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-narration-'));
  try {
    const texts = ['Welcome to the old medina of Fez.', 'Every alley hides a workshop.', 'And every workshop keeps a story going for a thousand years.'];
    // Durations roughly follow the text, as speech does; one sentence pause inside line 3.
    const passage = wav(path.join(dir, 'passage.wav'), [['gap', 0.3], ...line(2.2), ['gap', 0.9], ...line(1.9), ['gap', 1.0], ...line(1.8), ['gap', 0.35], ...line(1.6), ['gap', 0.4]]);
    const asked = [];
    const speak = async (text, style) => { asked.push({ text, style }); return text.includes('\n\n') ? passage : wav(path.join(dir, `line-${asked.length}.wav`), [...line(1.5), ['gap', 0.1]]); };
    const out = await speakLines({ ffmpegPath, outDir: path.join(dir, 'out'), lines: texts, style: 'Warm guide.', cacheKey: ['gemini', 'm', 'Kore'], speak });
    assert.equal(out.mode, 'one_request'); assert.equal(out.requests, 1); assert.equal(asked.length, 1, 'one speech request for every line');
    assert.equal(asked[0].text, texts.join('\n\n'), 'lines are read as paragraphs, verbatim');
    assert.match(asked[0].style, /^Warm guide\. /); assert.match(asked[0].style, /pause/);
    const lengths = [];
    for (const f of out.files) { const m = await probe(f); assert.equal(m.type, 'audio'); lengths.push(m.duration); }
    assert.ok(Math.abs(lengths[0] - 2.2) < 0.35, `line 1 is ${lengths[0]} s`);
    assert.ok(Math.abs(lengths[1] - 1.9) < 0.35, `line 2 is ${lengths[1]} s`);
    assert.ok(Math.abs(lengths[2] - 3.75) < 0.4, `line 3 keeps its inner sentence pause: ${lengths[2]} s`);
    // Asked again: the lines come from the cache, no request.
    const again = await speakLines({ ffmpegPath, outDir: path.join(dir, 'out'), lines: texts, style: 'Warm guide.', cacheKey: ['gemini', 'm', 'Kore'], speak });
    assert.equal(again.requests, 0); assert.equal(asked.length, 1); assert.deepEqual(again.files, out.files);

    // The voice ran the lines together (no long pauses): one request per line instead.
    asked.length = 0;
    const runOn = wav(path.join(dir, 'runon.wav'), [...line(2), ...line(2), ...line(2)]);
    const fallback = await speakLines({ ffmpegPath, outDir: path.join(dir, 'out'), lines: ['One.', 'Two.', 'Three.'], cacheKey: ['x'],
      speak: async (text) => { asked.push(text); return text.includes('\n\n') ? runOn : wav(path.join(dir, `each-${asked.length}.wav`), line(1)); } });
    assert.equal(fallback.mode, 'per_line'); assert.equal(fallback.requests, 4); assert.deepEqual(asked.slice(1), ['One.', 'Two.', 'Three.']);

    // Pure planning: pauses far from where the text says the lines end are not taken.
    assert.equal(planLines({ duration: 10, pauses: [{ start: 0.5, end: 1.3 }] }, ['A long first line of narration.', 'A long second line of narration.']), null, 'a pause at 10% cannot split two equal lines');
    assert.ok(planLines({ duration: 10, pauses: [{ start: 4.6, end: 5.4 }] }, ['A long first line of narration.', 'A long second line of narration.']));
    await assert.rejects(speakLines({ ffmpegPath, outDir: dir, lines: ['Only one'], speak }), /two lines/);
    await assert.rejects(speakLines({ ffmpegPath, outDir: dir, lines: ['A', ''], speak }), /needs text/);
    await assert.rejects(speakLines({ ffmpegPath, outDir: dir, lines: new Array(41).fill('x'), speak }), /at most 40/);
    assert.ok(!fs.readdirSync(path.join(dir, 'out')).some((f) => f.includes('.part')));
    console.log('NARRATION OK (one request cut at pauses, inner pauses kept, cache, run-on fallback, planning, limits)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e); process.exit(1); });
