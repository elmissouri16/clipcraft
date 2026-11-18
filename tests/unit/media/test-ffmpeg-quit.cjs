// FFmpeg jobs the main process starts (preview copies, thumbnails, clip renders) stop when the app quits: an
// orphan would keep encoding into the media cache, and the next launch could publish its half-written file.
// A child process stands in for the app: it starts a real preview-copy build and quits the way electron/main.cjs
// does. The test then checks no FFmpeg is left, that the startup sweep removes the dead job's partial file (and
// keeps a running process's), and that main.cjs wires both. Usage: node tests/unit/media/test-ffmpeg-quit.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, fork, spawnSync } = require('node:child_process');
const root = path.join(__dirname, '../../..');
const ff = require(path.join(root, 'electron/media/ffmpeg.cjs'));
const children = require(path.join(root, 'electron/system/childProcesses.cjs'));

if (process.argv[2] === 'app') {
  const [src, cache] = process.argv.slice(3);
  process.once('exit', () => children.killAll()); // as electron/main.cjs
  (async () => {
    ff.makeQualityProxy({ path: src, ...(await ff.probe(src)) }, cache, 'high', { force: true }).catch(() => {});
    const wait = () => (fs.readdirSync(cache).some((f) => f.includes('.part.')) && children.running() > 0 ? process.send('started', () => process.exit(0)) : setTimeout(wait, 50));
    wait();
  })();
  return;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-ffmpeg-quit-')), cache = path.join(dir, 'cache'), src = path.join(dir, 'long.mp4');
fs.mkdirSync(cache);
const running = () => spawnSync('pgrep', ['-f', cache], { encoding: 'utf8' }).stdout.trim();
(async () => {
  try {
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv422p', src]);
    const app = fork(__filename, ['app', src, cache]);
    await new Promise((resolve, reject) => { app.on('message', resolve); app.on('exit', (code) => reject(new Error(`app quit before its job started (${code})`))); });
    await new Promise((resolve) => (app.exitCode !== null ? resolve() : app.on('exit', resolve)));
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (process.platform !== 'win32') assert.equal(running(), '', 'no FFmpeg outlives the app');
    const parts = fs.readdirSync(cache).filter((f) => f.includes('.part.'));
    assert.equal(parts.length, 1, 'the killed job left its partial file');
    const size = fs.statSync(path.join(cache, parts[0])).size;
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(fs.statSync(path.join(cache, parts[0])).size, size, 'nothing writes to it any more');

    // Startup sweep: the dead job's file and an older version's untagged file go; a live process's file stays.
    fs.writeFileSync(path.join(cache, 'abc-qmedium.part.mp4'), 'old');
    const live = `def-qlow.${process.pid}-0a1b2c3d.part.mp4`;
    fs.writeFileSync(path.join(cache, live), 'live');
    fs.writeFileSync(path.join(cache, 'abc-qhigh.mp4'), 'published');
    assert.deepEqual(children.sweepPartFiles(cache).sort(), [parts[0], 'abc-qmedium.part.mp4'].sort());
    assert.deepEqual(fs.readdirSync(cache).sort(), ['abc-qhigh.mp4', live].sort());
    assert.deepEqual(children.sweepPartFiles(path.join(dir, 'missing')), [], 'a missing cache folder is fine');

    // A proxy build that fails removes its partial file at once.
    const broken = path.join(dir, 'broken.mp4');
    fs.writeFileSync(broken, fs.readFileSync(src).subarray(0, 60000));
    await assert.rejects(ff.makeQualityProxy({ path: broken, type: 'video', width: 1920, height: 1080, duration: 20, acodec: '' }, cache, 'medium', { force: true }));
    assert.deepEqual(fs.readdirSync(cache).filter((f) => f.includes('.part.') && f !== live), [], 'a failed build leaves no partial file');

    const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
    assert.match(main, /app\.on\('will-quit',\(\)=>\{[^}]*childProcesses\.killAll\(\);\}\);/, 'quitting stops every FFmpeg');
    assert.match(main, /childProcesses\.sweepPartFiles\(dir\);/, 'the media cache is swept at startup');
    assert.match(main, /graphicsService\?\.abortAll\(\);childProcesses\.killAll\(\);/, 'motion-graphic renders are aborted at quit');
    assert.match(main, /app\.whenReady\(\)\.then\(\(\)=>\{[^}]*graphics\(\);\}\)/, 'the graphics service sweeps its partial folders at startup');
    for (const file of ['media/reverse', 'media/stabilize', 'media/detach', 'media/enhance', 'media/track', 'media/ffmpeg', 'export/fxjobs', 'export/textstream', 'export/framePipes']) {
      assert.match(fs.readFileSync(path.join(root, `electron/${file}.cjs`), 'utf8'), /\{ spawn \} = require\('\.\.\/system\/childProcesses\.cjs'\)/, `${file} starts FFmpeg through the tracked spawn`);
    }
    console.log('FFmpeg jobs stop with the app; stale partial files are swept at startup');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
