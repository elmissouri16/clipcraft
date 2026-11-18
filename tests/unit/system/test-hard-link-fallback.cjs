// Publishing by hard link falls back to an exclusive copy on volumes without hard links. Windows reports EISDIR or
// EINVAL for a hard link on FAT/exFAT, so those codes must take the copy path too. The link failure is simulated
// and the real extension-file publisher and video export publish run. Usage: node tests/unit/system/test-hard-link-fallback.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '../../..');
const { hardLinkUnsupported } = require(path.join(root, 'electron/system/hardLinks.cjs'));
const { ExtensionFiles } = require(path.join(root, 'electron/plugins/extensionFiles.cjs'));
const ff = require(path.join(root, 'electron/media/ffmpeg.cjs'));

const realLink = fs.linkSync, realPromiseLink = fs.promises.link;
const failLinks = (code) => {
  const fail = () => { throw Object.assign(new Error(`${code}: simulated link failure`), { code }); };
  fs.linkSync = fail; fs.promises.link = async () => fail();
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-link-fallback-'));
(async () => {
  try {
    for (const code of ['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'EMLINK', 'EISDIR', 'EINVAL']) assert.ok(hardLinkUnsupported({ code }), code);
    for (const code of ['EEXIST', 'ENOENT', 'EACCES', undefined]) assert.ok(!hardLinkUnsupported({ code }), String(code));

    const source = path.join(dir, 'video.mp4');
    require('node:child_process').execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    const project = { width: 160, height: 90, fps: 10, background: '#000000', media: [{ ...(await ff.probe(source)), id: 'm', path: source }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 0.5, speed: 1 }], overlayClips: [], audioClips: [], textClips: [] };
    for (const code of ['EISDIR', 'EINVAL']) {
      failLinks(code);
      try {
        const payload = path.join(dir, `payload-${code}.bin`), destination = path.join(dir, `published-${code}.bin`);
        fs.writeFileSync(payload, 'payload');
        const result = await new ExtensionFiles({ isActive: () => true }).publish({}, { token: '1', path: payload, destination });
        assert.equal(result.atomic, false, `${code}: extension file published by copy`);
        assert.equal(fs.readFileSync(destination, 'utf8'), 'payload');

        const out = path.join(dir, `export-${code}.mp4`);
        assert.equal(await ff.runExport(project, out, () => {}, { noOverwrite: true }).promise, out, `${code}: export published by copy`);
        assert.ok((await ff.probe(out)).duration > 0.3);
        fs.writeFileSync(path.join(dir, 'taken.mp4'), 'older');
        await assert.rejects(ff.runExport(project, path.join(dir, 'taken.mp4'), () => {}, { noOverwrite: true }).promise, /EEXIST/, 'the copy still refuses an existing file');
        assert.equal(fs.readFileSync(path.join(dir, 'taken.mp4'), 'utf8'), 'older');
      } finally { fs.linkSync = realLink; fs.promises.link = realPromiseLink; }
    }
    for (const file of ['electron/plugins/extensionFiles.cjs', 'electron/plugins/packageWriter.cjs', 'electron/media/ffmpeg.cjs', 'electron/agents/editorFiles.cjs', 'electron/export/renderCache.cjs', 'electron/export/fxjobs.cjs']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(text.includes('hardLinkUnsupported') && !/EOPNOTSUPP/.test(text), `${file} uses the shared hard-link fallback`);
    }
    console.log('hard-link fallbacks: EISDIR/EINVAL (Windows FAT/exFAT) publish by exclusive copy');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
