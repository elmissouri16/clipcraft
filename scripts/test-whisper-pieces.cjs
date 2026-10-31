// Auto captions with a model without reliable timestamps (Darija): the audio is cut in the middle of pauses into
// pieces of at most 8 s, and each piece's words are spread over its speech, in order and inside it.
// Usage: node scripts/test-whisper-pieces.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const whisper = require('../electron/whisper.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a.toFixed(2)}, expected ${b} ± ${tol}`);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-pieces-'));
  const wav = path.join(dir, 'audio.wav');
  // "Speech" (a tone) with pauses at 3-3.6 s and 9-9.5 s, then 10.5 s without a pause.
  execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    "aevalsrc='if(between(t,3,3.6)+between(t,9,9.5),0,0.5*sin(2*PI*440*t))':s=16000:d=20", '-c:a', 'pcm_s16le', wav]);

  const pieces = await whisper.cutAtPauses(wav);
  const starts = pieces.map((p) => p.at);
  // 0 → 3.3 (the 9.25 s pause is more than 8 s away) → 9.25 → 17.25 (8 s without a pause) → 20.
  assert(pieces.length === 4, `pieces: ${JSON.stringify(starts)}`);
  near(starts[1], 3.3, 0.05, 'cut in the middle of the 3-3.6 s pause');
  near(starts[2], 9.25, 0.05, 'cut in the middle of the 9-9.5 s pause');
  near(starts[3], 17.25, 0.05, 'a run without pauses is cut after 8 s');
  near(pieces[0].to, 3, 0.05, 'speech ends where the pause starts');
  near(pieces[1].from, 3.6, 0.05, 'speech starts after the pause');
  near(pieces[2].from, 9.5, 0.05, 'speech starts after the pause');
  near(pieces[3].to, 20, 0.05, 'the last piece ends with the audio');
  pieces.forEach((p) => assert(fs.existsSync(p.file), `missing ${p.file}`));
  const lens = pieces.map((p, i) => (pieces[i + 1]?.at ?? 20) - p.at);
  assert(lens.every((l) => l <= 8.0001), `piece lengths ${lens}`);

  // Words spread over the piece's speech by length, lines keep their words.
  const segs = whisper.readPiece({ transcription: [{ text: ' سلام عليكم' }, { text: ' كيداير؟' }, { text: '[موسيقى]' }] }, { from: 9.5, to: 13.5 });
  const words = segs.flatMap((s) => s.words);
  assert(segs.length === 2 && words.length === 3, `segments ${JSON.stringify(segs)}`);
  near(words[0].start, 9.5, 1e-6, 'first word at the start of speech');
  near(words[2].end, 13.5, 1e-6, 'last word at the end of speech');
  assert(words.every((w, i) => w.end > w.start && (i === 0 || Math.abs(w.start - words[i - 1].end) < 1e-9)), 'words in order, back to back');
  assert(words[1].end - words[1].start > words[0].end - words[0].start, 'longer words get more time');
  assert(segs[1].start === words[2].start && segs[0].end === words[1].end, 'lines span their words');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('WHISPER PIECES OK');
})().catch((e) => { console.error(e); process.exit(1); });
