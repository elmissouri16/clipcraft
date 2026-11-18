// Native-image adapter with an injected Codex transport. Live image generation
// is exercised separately by FVE_SMOKE_MODE=codex-images and FVE_CODEX_IMAGES_LIVE=1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalAgents } = require("../../../electron/agents/localAgents.cjs");
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hV8AAAAASUVORK5CYII=', 'base64');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-codex-images-'));
  const home = path.join(root, 'codex'), outputDir = path.join(root, 'saved');
  const skill = path.join(home, 'skills', '.system', 'imagegen', 'SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '# imagegen\nTEST INSTALLED IMAGEGEN SKILL\nUse the native image_gen tool.');
  const reference = path.join(root, 'character.png'); fs.writeFileSync(reference, PNG);
  const captured = [];
  let mode = 'success', serial = 0, abort;
  const sdk = { Codex: class {
    constructor(options) { captured.push({ kind: 'client', options }); }
    startThread(options) {
      const thread = { id: `image-thread-${++serial}`, run: async (input, runOptions) => {
        captured.push({ kind: 'run', options, runOptions, input });
        if (mode === 'pending') return new Promise((resolve, reject) => runOptions.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        if (mode === 'failure') throw new Error('provider failed secret-test-key');
        const artifactRoot = path.join(home, 'generated_images', thread.id);
        if (mode === 'missing') return { finalResponse: `{"image_path":"${reference}"}` };
        if (mode === 'symlink-root') { fs.symlinkSync(path.dirname(reference), artifactRoot); return {}; }
        fs.mkdirSync(artifactRoot, { recursive: true });
        if (mode === 'symlink-file') fs.symlinkSync(reference, path.join(artifactRoot, 'image.png'));
        else fs.writeFileSync(path.join(artifactRoot, 'image.png'), mode === 'bad-bytes' ? Buffer.from('fake png') : PNG);
        if (mode === 'multiple') fs.writeFileSync(path.join(artifactRoot, 'second.png'), PNG);
        if (mode === 'cancel') abort.abort();
        return { finalResponse: 'Created.' };
      } };
      return thread;
    }
  } };
  const agents = createLocalAgents({ home: root, env: { CODEX_HOME: home, PATH: '/usr/bin', OPENAI_API_KEY: 'secret-test-key', ELECTRON_RUN_AS_NODE: '1' },
    resolveExecutable: () => '/installed/codex', loadSdk: async () => sdk });
  const cfg = { provider: 'codex-sdk', model: 'chosen-model', reasoningEffort: 'high' };
  const req = { prompt: 'The same character waves in a new scene.', referencePaths: [reference], ratio: '9:16', width: 1080, height: 1920, transparentBackground: true, outputDir };
  try {
    const image = await agents.generateImage(cfg, req);
    assert.deepEqual(fs.readFileSync(image.path), PNG);
    const client = captured.findLast(c => c.kind === 'client').options;
    assert.equal(client.config.features.image_generation, true);
    assert.equal(client.config.features.code_mode_host, true);
    assert.equal(client.config.features.shell_tool, false);
    assert.equal(client.config.features.unified_exec, false);
    assert.equal(client.config.features.plugins, false);
    // Every built-in tool the other Codex sessions turn off stays off here too (view_image, browser, hooks…).
    const { CODEX_FEATURES_OFF } = require('../../../electron/agents/codexNative.cjs');
    assert.deepEqual(Object.keys(CODEX_FEATURES_OFF).filter(k => client.config.features[k] !== false), ['image_generation', 'code_mode_host']);
    assert.equal(client.config.features.view_image, false);
    assert.equal(client.env.ELECTRON_RUN_AS_NODE, undefined);
    const run = captured.findLast(c => c.kind === 'run');
    assert.equal(run.options.model, 'chosen-model');
    assert.equal(run.options.modelReasoningEffort, 'high');
    assert.equal(run.options.sandboxMode, 'workspace-write');
    assert.equal(run.options.networkAccessEnabled, false);
    assert.ok(run.input[0].text.includes('TEST INSTALLED IMAGEGEN SKILL'));
    assert.ok(run.input[0].text.includes('9:16'));
    assert.ok(run.input[0].text.includes('1080x1920 pixels'));
    assert.ok(run.input[0].text.includes('Transparent background requested: true'));
    assert.equal(run.input[1].type, 'local_image');
    assert.equal(fs.existsSync(run.options.workingDirectory), false, 'scratch references are removed after completion');
    assert.equal(fs.existsSync(image.path), true, 'importable image outlives the scratch workspace');
    assert.ok(image.path.startsWith(outputDir));
    const count = fs.readdirSync(outputDir).length;
    for (const [next, re] of [['missing', /no native image/], ['symlink-file', /invalid image artifact/], ['symlink-root', /unsafe image artifact/],
      ['bad-bytes', /invalid PNG/], ['multiple', /multiple images/], ['failure', /provider failed \*\*\*/]]) {
      mode = next;
      await assert.rejects(agents.generateImage(cfg, req), re);
      assert.equal(fs.readdirSync(outputDir).length, count, `${mode} never publishes an image`);
    }
    mode = 'cancel'; abort = new AbortController();
    await assert.rejects(agents.generateImage(cfg, { ...req, signal: abort.signal }), { name: 'AbortError' });
    assert.equal(fs.readdirSync(outputDir).length, count);
    mode = 'pending'; abort = new AbortController();
    const pending = agents.generateImage(cfg, { ...req, signal: abort.signal });
    await new Promise(r => setTimeout(r, 10)); abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await assert.rejects(agents.generateImage(cfg, { ...req, timeoutMs: 10 }), /timed out/);
    mode = 'success';
    await assert.rejects(agents.generateImage({ provider: 'claude-agent-sdk' }, req), /requires Codex/);
    await assert.rejects(agents.generateImage(cfg, { ...req, prompt: '' }), /prompt/);
    await assert.rejects(agents.generateImage(cfg, { ...req, referencePaths: [reference, reference, reference, reference] }), /three reference/);
    fs.unlinkSync(skill);
    await assert.rejects(agents.generateImage(cfg, req), /skill was not found/);
    console.log('Codex images OK (installed skill, native tool, reference attachments, persistent import, artifact boundaries, cancellation, errors)');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
module.exports = { PNG };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
