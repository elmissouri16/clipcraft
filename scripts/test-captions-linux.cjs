// Auto captions, LOCAL engine, on Linux — the honest counterpart of test-captions.cjs
// (which is Windows-shaped: APPDATA + PowerShell speech synthesis). This one installs
// whisper.cpp through the app's own whisper.install() into a kept temp dir, then
// transcribes REAL speech: two excerpts from Hamza's Nettworki live recordings
// (Darija/Arabic and English), extracted to 16 kHz mono WAV beforehand.
// Fixtures in CAPFIX_DIR (default /tmp/capfix): jfk.wav — the whisper.cpp sample
// (clear English; downloaded from the whisper.cpp repo when missing) — and
// speech-ar.wav, a Darija excerpt from a Nettworki live recording. The JFK control
// proves the engine; the Darija excerpt documents what the small base model makes of
// dialect (the app offers large-v3-turbo and a dedicated Darija model for that).
// Usage: node scripts/test-captions-linux.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const whisper = require('../electron/whisper.cjs');

const assert = (ok, what) => { if (!ok) throw new Error(what); };

(async () => {
  if (process.platform === 'win32') throw new Error('This is the Linux test; on Windows use test-captions.cjs.');
  // Kept on the home disk: the models are 150-575 MB, too big for a small /tmp tmpfs.
  const dir = process.env.WHISPER_DIR || path.join(os.homedir(), '.fve-whisper-linux');
  const fixDir = process.env.CAPFIX_DIR || '/tmp/capfix';
  const stages = [];
  const t0 = Date.now();
  await whisper.install(dir, (stage, f) => { if (f === 1 || stages.at(-1) !== stage) stages.push(stage); });
  const st = whisper.status(dir);
  assert(st.installed, `status after install: ${JSON.stringify(st)}`);
  console.log(`install ok in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${dir} (stages: ${stages.join(', ')})`);

  const jfk = path.join(fixDir, 'jfk.wav');
  if (!fs.existsSync(jfk)) {
    const res = await fetch('https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav');
    if (!res.ok) throw new Error(`JFK fixture download failed (HTTP ${res.status})`);
    fs.writeFileSync(jfk, Buffer.from(await res.arrayBuffer()));
  }
  for (const [name, wav] of [['english (JFK control)', jfk], ['arabic/darija (Nettworki live excerpt)', path.join(fixDir, 'speech-ar.wav')]]) {
    if (!fs.existsSync(wav)) { console.log(`SKIP ${name}: fixture ${wav} missing`); continue; }
    const t = Date.now();
    const segs = await whisper.transcribe(dir, wav, { language: 'auto', model: 'base' }, () => {});
    assert(segs.length >= 2, `${name}: only ${segs.length} segments`);
    for (let i = 0; i < segs.length; i++) {
      assert(segs[i].end > segs[i].start, `${name}: segment ${i} has no length`);
      if (i) assert(segs[i].start >= segs[i - 1].start - 0.01, `${name}: segments out of order at ${i}`);
    }
    const text = segs.map((s) => s.text).join(' ');
    if (name.includes('JFK')) assert(/fellow americans/i.test(text), `JFK control misheard: ${text.slice(0, 120)}`);
    console.log(`\n${name}: ${segs.length} segments in ${((Date.now() - t) / 1000).toFixed(1)} s, span ${segs[0].start.toFixed(2)}-${segs.at(-1).end.toFixed(2)} s`);
    console.log(`text (first 300 chars): ${text.slice(0, 300)}`);
  }
  console.log('\nCAPTIONS LINUX OK');
})().catch((e) => { console.error(e.message.slice(0, 3000)); process.exit(1); });
