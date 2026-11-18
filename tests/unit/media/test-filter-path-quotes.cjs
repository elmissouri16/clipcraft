// A file path with an apostrophe (a Windows profile such as C:\Users\O'Brien) inside a quoted filter value must
// reach FFmpeg intact. Reference analysis writes its scene-change list to the temp folder through such a value:
// run it with the temp folder under "O'Brien" and require the analysis to finish with its cut found. The
// contact-sheet labels use the same shared helper. Usage: node tests/unit/media/test-filter-path-quotes.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const root = path.join(__dirname, '../../..');

if (process.argv[2] === 'child') {
  const { ffmpegPath, probe } = require(path.join(root, 'electron/media/ffmpeg.cjs'));
  const { analyzeSamples } = require(path.join(root, 'electron/audio/rhythm.cjs'));
  const { createEditStyle } = require(path.join(root, 'electron/media/editStyle.cjs'));
  createEditStyle({ ffmpegPath, probe, analyzeSamples }).analyze(process.argv[3], { speech: false })
    .then((v) => process.send({ cuts: (v.cuts || v.shots || []).length, os: os.tmpdir() }), (error) => process.send({ error: String(error.message).slice(-400) }));
  return;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-quote-path-')), quoted = path.join(dir, "O'Brien"), src = path.join(dir, 'cut.mp4');
fs.mkdirSync(quoted);
(async () => {
  try {
    const { ffmpegPath } = require(path.join(root, 'electron/media/ffmpeg.cjs'));
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=1.5', '-f', 'lavfi', '-i', 'mandelbrot=s=320x180:r=25',
      '-filter_complex', '[1:v]trim=duration=1.5,setpts=PTS-STARTPTS[b];[0:v][b]concat=n=2:v=1[o]', '-map', '[o]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
    const result = await new Promise((resolve) => { const child = fork(__filename, ['child', src], { env: { ...process.env, TMPDIR: quoted, TMP: quoted, TEMP: quoted } }); child.on('message', (m) => { resolve(m); child.kill(); }); });
    assert.equal(result.error, undefined, `analysis with a quote in the temp path: ${result.error}`);
    assert.equal(result.os, quoted, 'the child used the quoted temp folder');
    assert.deepEqual(fs.readdirSync(quoted), [], 'the scene list was cleaned up');
    for (const file of ['electron/media/editStyle.cjs', 'electron/agents/agentFrames.cjs']) {
      assert.ok(!/replace\(\/'\/g, "\\\\'"\)/.test(fs.readFileSync(path.join(root, file), 'utf8')), `${file} uses the shared escaping helper`);
    }
    console.log('filter paths with a quote: reference analysis finishes; no private escaping copies remain');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
