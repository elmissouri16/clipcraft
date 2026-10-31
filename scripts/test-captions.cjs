// Installs whisper.cpp (if needed) into the app's user-data folder, then auto-captions a clip with synthetic speech.
// Usage: node scripts/test-captions.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, renderMainAudio } = require('../electron/ffmpeg.cjs');
const whisper = require('../electron/whisper.cjs');

const WHISPER_DIR = path.join(process.env.APPDATA, 'CapRocket', 'whisper');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cap-'));
  const speech = path.join(dir, 'speech.wav');
  const text = 'Hello and welcome. This video editor is completely free. Automatic captions run locally on your computer.';
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.SetOutputToWaveFile('${speech}'); $s.Speak('${text}'); $s.Dispose()`]);
  const video = path.join(dir, 'talk.mp4');
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:size=640x360:rate=30', '-i', speech, '-shortest', video]);
  const info = await probe(video);
  const project = {
    media: [{ id: 'm1', path: video, name: 'talk.mp4', ...info }],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: info.duration, speed: 1, volume: 1 }],
  };

  if (!whisper.status(WHISPER_DIR).installed) {
    console.log('Installing whisper.cpp into', WHISPER_DIR);
    let last = '';
    await whisper.install(WHISPER_DIR, (stage, f) => {
      const s = `${stage} ${Math.floor(f * 10) * 10}%`;
      if (s !== last) process.stdout.write(`\r${(last = s)}   `);
    });
    console.log();
  }
  const wav = path.join(dir, 'main.wav');
  await renderMainAudio(project, wav);
  const t0 = Date.now();
  const segs = await whisper.transcribe(WHISPER_DIR, wav, { language: 'en' });
  console.log(`transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  segs.forEach((s) => console.log(`${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.text}  | ${s.words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(' ')}`));
  const joined = segs.map((s) => s.text).join(' ').toLowerCase();
  if (!joined.includes('free') || !joined.includes('caption')) throw new Error('Transcript does not match');
  console.log('CAPTIONS OK');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
