// Generated scene images leave only the file the project uses (agents/imageJobs.cjs sceneImage,
// localAgents.generateImage), with injected fakes for Codex, framing and probing:
// - the unframed original is deleted once the framed copy exists; an image already at the canvas size stays;
// - every early return (stopped, unreadable, wrong size, framing failed) deletes what the scene made;
// - Codex's own output folder for the image thread is removed after the copy and after a refused image,
//   never through a symlink.
// Usage: node tests/unit/agents/test-scene-image-files.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sceneImage } = require('../../../electron/agents/imageJobs.cjs');
const { createLocalAgents } = require('../../../electron/agents/localAgents.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hV8AAAAASUVORK5CYII=', 'base64');
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-scene-files-'));
  try {
    const outputDir = path.join(root, 'codex-images'); fs.mkdirSync(outputDir);
    const req = { prompt: 'A red kite over a beach', ratio: '16:9', width: 64, height: 36 };
    let serial = 0, abortAfterGenerate = false, fitFails = false, probeAs = null, nativeSize = false;
    const deps = (controller) => ({
      outputDir,
      generateImage: async () => { const file = path.join(outputDir, `codex-${++serial}.png`); fs.writeFileSync(file, PNG); if (abortAfterGenerate) controller.abort(); return { path: file, prompt: req.prompt }; },
      fitImageFrame: async (file) => {
        if (fitFails) throw new Error('Could not fit the generated image to the canvas.');
        if (nativeSize) return { path: file, nativeWidth: 64, nativeHeight: 36 };
        const framed = path.join(outputDir, `frame-${serial}.png`); fs.writeFileSync(framed, PNG); return { path: framed, nativeWidth: 128, nativeHeight: 128 };
      },
      probeAll: async ([file]) => [{ path: file, type: 'image', width: 64, height: 36, ...(probeAs || {}) }],
    });
    const run = async () => { const controller = new AbortController(); return sceneImage({ provider: 'codex-sdk' }, req, controller.signal, deps(controller)).catch((error) => ({ thrown: error.message })); };
    const files = () => fs.readdirSync(outputDir).sort();

    const ok = await run();
    check('a framed scene keeps only the framed copy', ok.path === path.join(outputDir, 'frame-1.png') && files().join() === 'frame-1.png');
    nativeSize = true;
    const same = await run();
    check('an image already at the canvas size is kept as is', same.path === path.join(outputDir, 'codex-2.png') && files().includes('codex-2.png'));
    nativeSize = false;
    const before = files().join();
    abortAfterGenerate = true;
    check('a stop after generation leaves nothing', (await run()).canceled && files().join() === before);
    abortAfterGenerate = false; fitFails = true;
    check('a failed framing leaves nothing', /fit/.test((await run()).thrown) && files().join() === before);
    fitFails = false; probeAs = { width: 10 };
    check('a wrong-size result leaves nothing', /dimensions/.test((await run()).error) && files().join() === before);
    probeAs = { type: 'video' };
    check('an unreadable result leaves nothing', /could not read/.test((await run()).error) && files().join() === before);

    // generateImage: the thread's folder under the Codex home is removed after the copy and after a refusal.
    const home = path.join(root, 'codex'), skill = path.join(home, 'skills', '.system', 'imagegen', 'SKILL.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true }); fs.writeFileSync(skill, '# imagegen');
    const keep = path.join(root, 'keep'); fs.mkdirSync(keep); fs.writeFileSync(path.join(keep, 'mine.png'), PNG);
    let mode = 'one', n = 0;
    const sdk = { Codex: class { startThread() { const thread = { id: `thread-${++n}`, run: async () => {
      const folder = path.join(home, 'generated_images', thread.id);
      if (mode === 'symlink') { fs.mkdirSync(path.dirname(folder), { recursive: true }); fs.symlinkSync(keep, folder); return {}; }
      fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'image.png'), PNG);
      if (mode === 'two') fs.writeFileSync(path.join(folder, 'second.png'), PNG);
      return { finalResponse: 'Created.' };
    } }; return thread; } } };
    const agents = createLocalAgents({ home: root, env: { CODEX_HOME: home, PATH: '/usr/bin' }, resolveExecutable: () => '/installed/codex', loadSdk: async () => sdk });
    const saved = path.join(root, 'saved');
    const image = await agents.generateImage({ provider: 'codex-sdk' }, { prompt: 'x', ratio: '16:9', outputDir: saved });
    check('the copy is in project storage and the thread folder is gone', fs.existsSync(image.path) && !fs.existsSync(path.join(home, 'generated_images', 'thread-1')));
    mode = 'two';
    await assert.rejects(agents.generateImage({ provider: 'codex-sdk' }, { prompt: 'x', ratio: '16:9', outputDir: saved }), /multiple images/);
    check('a refused image leaves no thread folder behind', !fs.existsSync(path.join(home, 'generated_images', 'thread-2')));
    mode = 'symlink';
    await assert.rejects(agents.generateImage({ provider: 'codex-sdk' }, { prompt: 'x', ratio: '16:9', outputDir: saved }), /unsafe image artifact/);
    check('a symlinked thread folder is never followed', fs.existsSync(path.join(keep, 'mine.png')));
    console.log(`scene image files OK: ${checks.length} checks`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
