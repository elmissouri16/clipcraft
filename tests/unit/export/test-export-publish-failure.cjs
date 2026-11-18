// A finished export whose target cannot be replaced (Windows: the old video is open in a player, so the rename
// fails) is never deleted: it is kept next to the target and the error names where. The rename failure is
// simulated; the rest of the export is real. Usage: node tests/unit/export/test-export-publish-failure.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ff = require('../../../electron/media/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-publish-failure-'));
const realRename = fs.renameSync;
(async () => {
  const saved = process.env.FVE_ENCODER; process.env.FVE_ENCODER = 'libx264';
  try {
    const target = path.join(dir, 'final.mp4'), older = Buffer.from('the earlier export, open in a player');
    fs.writeFileSync(target, older);
    const project = { width: 160, height: 90, fps: 10, background: '#203040', media: [], videoClips: [{ id: 'gap', gap: true, in: 0, out: 0.5, speed: 1 }], overlayClips: [], textClips: [], audioClips: [] };
    let locked = 0;
    fs.renameSync = (from, to) => { if (to === target) { locked++; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } return realRename(from, to); };
    const error = await ff.runExport(project, target, () => {}).promise.then(() => null, (e) => e);
    assert.ok(error && locked === 1, 'publishing over the locked target failed');
    const kept = path.join(dir, 'final (rendered).mp4');
    assert.equal(error.keptFile, kept);
    assert.ok(error.message.includes(kept) && error.message.includes('final.mp4'), `the message says where the video is: ${error.message}`);
    assert.ok((await ff.probe(kept)).duration > 0.3, 'the kept file is the finished video');
    assert.deepEqual(fs.readFileSync(target), older, 'the locked target is untouched');
    assert.ok(!fs.readdirSync(dir).some((name) => name.startsWith('.clipcraft-export-')), 'the empty working folder is removed');

    // A second failure picks the next free name; if the render cannot move at all it stays in its working folder.
    const second = await ff.runExport(project, target, () => {}).promise.then(() => null, (e) => e);
    assert.equal(second.keptFile, path.join(dir, 'final (rendered 2).mp4'));
    fs.renameSync = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    const third = await ff.runExport(project, target, () => {}).promise.then(() => null, (e) => e);
    fs.renameSync = realRename;
    assert.match(path.basename(path.dirname(third.keptFile)), /^\.clipcraft-export-/);
    assert.ok(fs.existsSync(third.keptFile) && (await ff.probe(third.keptFile)).duration > 0.3, 'an unmovable render stays in its working folder');
    console.log('export publish failure: the finished render is kept and its location reported');
  } finally {
    fs.renameSync = realRename;
    if (saved === undefined) delete process.env.FVE_ENCODER; else process.env.FVE_ENCODER = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
