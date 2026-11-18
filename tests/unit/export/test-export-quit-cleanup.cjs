// Quitting during an export leaves no working folder behind: the app's process is gone before an async cleanup
// runs, so the export removes its folders synchronously (abandon). A child process stands in for the app and
// quits mid-encode with its own temp folder. Folders a crashed run left are swept at the next start only when
// they carry this app's owner file and their process has ended. Usage: node tests/unit/export/test-export-quit-cleanup.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const root = path.join(__dirname, '../../..');

if (process.argv[2] === 'app') {
  const ff = require(path.join(root, 'electron/media/ffmpeg.cjs'));
  const project = { width: 1280, height: 720, fps: 30, media: [], videoClips: [{ id: 'gap', gap: true, in: 0, out: 120, speed: 1 }], overlayClips: [], textClips: [], audioClips: [],
    export: { codecFamily: 'h264', outW: 1280, outH: 720, outFps: 30, encoderPreset: 'veryslow', crf: 18 } };
  const job = ff.runExport(project, process.argv[3], (fraction) => {
    if (fraction > 0 && fraction < 0.9) { job.abandon(); process.send('quit', () => process.exit(0)); } // will-quit, then the process ends
  });
  job.promise.catch(() => {});
  return;
}
const { sweepWorkDirs, makeWorkDir, OWNER } = require(path.join(root, 'electron/system/workDirs.cjs'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-quit-cleanup-')), temp = path.join(dir, 'temp'), out = path.join(dir, 'exports');
fs.mkdirSync(temp); fs.mkdirSync(out);
(async () => {
  try {
    const app = fork(__filename, ['app', path.join(out, 'My video.mp4')], { env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp, FVE_ENCODER: 'libx264' } });
    const said = await new Promise((resolve) => { app.on('message', resolve); app.on('exit', () => resolve(null)); });
    assert.equal(said, 'quit', 'the export was running when the app quit');
    await new Promise((resolve) => (app.exitCode !== null ? resolve() : app.on('exit', resolve)));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(fs.readdirSync(out), [], 'nothing is left next to the chosen file');
    assert.deepEqual(fs.readdirSync(temp), [], 'nothing is left in the temp folder');

    // Startup sweep: only this app's folders whose owner process has ended.
    const ended = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
    const owned = (name, pid) => { const d = path.join(temp, name); fs.mkdirSync(d); fs.writeFileSync(path.join(d, OWNER), JSON.stringify({ kind: 'clipcraft-work', pid })); fs.writeFileSync(path.join(d, 'frame.raw'), 'x'); };
    owned('fve-AbC123', Number(ended)); owned('clipcraft-text-x1Y2z3', Number(ended)); owned('clipcraft-fx-Qq7Ww8', Number(ended));
    owned('fve-Live01', process.pid);
    fs.mkdirSync(path.join(temp, 'fve-NoOwnr')); // an older version's or another tool's folder
    owned('fve-p8a-evidence', Number(ended)); // not one of the app's names
    const mine = makeWorkDir('clipcraft-text-', temp);
    assert.deepEqual(sweepWorkDirs(temp).sort(), ['clipcraft-fx-Qq7Ww8', 'clipcraft-text-x1Y2z3', 'fve-AbC123']);
    assert.deepEqual(fs.readdirSync(temp).sort(), [path.basename(mine), 'fve-Live01', 'fve-NoOwnr', 'fve-p8a-evidence'].sort());

    const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
    assert.match(main, /app\.on\('will-quit',\(\)=>\{[^}]*currentExport\?\.abandon\?\.\(\);[^}]*for\(const dir of \[\.\.\.frameDirs\]\)dropFrames\(dir\);/, 'quitting abandons the export and drops its frame folders');
    assert.match(main, /sweepWorkDirs\(\)/, 'the temp folder is swept at startup');
    assert.match(main, /makeWorkDir\('clipcraft-text-'\)/, 'export frame folders carry the owner file');
    console.log('quitting mid-export leaves no working folder; crashed runs are swept by owner');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
