// Caption engine resolution: managed Windows/Linux installs and native macOS
// installations, including Finder's restricted PATH. No downloads or inference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, "../../../electron/audio/whisper.cjs");
const localRequire = createRequire(filename);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-whisper-engine-'));
let downloads = 0;

function load({ platform = 'darwin', arch = 'arm64', files = {}, fetchImpl } = {}) {
  const module = { exports: {} };
  const mockFs = { ...fs,
    statSync(file, ...args) {
      if (Object.hasOwn(files, file)) return { isFile: () => files[file] !== 'directory' };
      if (file === '/opt/homebrew/bin/whisper-cli' || file === '/usr/local/bin/whisper-cli') throw new Error('Not installed');
      return fs.statSync(file, ...args);
    },
    accessSync(file, ...args) {
      if (Object.hasOwn(files, file)) {
        if (files[file] !== 'executable') throw new Error('Not executable');
        return;
      }
      return fs.accessSync(file, ...args);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: (id) => id === 'fs' ? mockFs : localRequire(id),
    process: { platform, arch, env: { PATH: '/usr/bin:/bin' } },
    fetch: fetchImpl || (async () => { downloads++; throw new Error('Unexpected download'); }),
    Buffer, console,
  }, { filename });
  return module.exports;
}

(async () => {
  const dir = path.join(root, 'captions');
  const arm = '/opt/homebrew/bin/whisper-cli', intel = '/usr/local/bin/whisper-cli';
  assert.equal(load({ files: { [arm]: 'executable' } }).resolveCli(dir), arm);
  assert.equal(load({ arch: 'x64', files: { [intel]: 'executable' } }).resolveCli(dir), intel);
  assert.equal(load({ files: { [arm]: 'directory', [intel]: 'executable' } }).resolveCli(dir), intel);
  assert.equal(load({ files: { [arm]: 'not-executable' } }).resolveCli(dir), null);

  const customBin = path.join(root, 'custom install', 'bin');
  fs.mkdirSync(customBin, { recursive: true });
  const custom = path.join(customBin, 'whisper-cli');
  fs.writeFileSync(custom, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const engine = load();
  assert.equal(engine.resolveCli(dir, { env: { PATH: customBin } }), custom);
  assert.equal(engine.resolveCli(dir, { env: { PATH: '', CLIPCRAFT_WHISPER_CLI: custom } }), custom);
  assert.equal(engine.resolveCli(dir, { env: { PATH: ".", CLIPCRAFT_WHISPER_CLI: '/missing/whisper-cli' } }), null);

  const managedBin = path.join(dir, 'bin', 'nested');
  fs.mkdirSync(managedBin, { recursive: true });
  const managed = path.join(managedBin, 'whisper-cli');
  fs.writeFileSync(managed, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(engine.resolveCli(dir, { env: { PATH: customBin } }), managed);
  assert.equal(load({ platform: 'linux', arch: 'x64' }).resolveCli(dir), managed);
  assert.equal(load({ platform: 'linux', arch: 'arm64' }).resolveCli(dir), managed);
  const windows = path.join(managedBin, 'whisper-cli.exe');
  fs.writeFileSync(windows, 'Windows engine');
  assert.equal(load({ platform: 'win32', arch: 'x64' }).resolveCli(dir), windows);
  fs.chmodSync(managed, 0o644);
  assert.equal(engine.resolveCli(dir), null);

  const ready = path.join(root, 'ready');
  fs.mkdirSync(ready);
  // Sparse placeholder: install checks the existing size and must not download.
  const model = path.join(ready, engine.MODELS.base.file);
  fs.writeFileSync(model, ''); fs.truncateSync(model, engine.MODELS.base.size);
  const native = load({ files: { [arm]: 'executable' } });
  await native.install(ready);
  assert.equal(native.status(ready).installed, true);
  await assert.rejects(engine.install(path.join(root, 'missing')), /brew install whisper-cpp/);
  assert.equal(downloads, 0, 'engine resolution must not download a Windows or Linux archive on macOS');

  const bytes = Buffer.from('caption model fixture');
  const verified = load({ files: { [arm]: 'executable' }, fetchImpl: async () => new Response(bytes) });
  verified.MODELS.base.size = bytes.length;
  verified.MODELS.base.sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const concurrent = path.join(root, 'concurrent');
  await Promise.all([verified.install(concurrent), verified.install(concurrent)]);
  assert.deepEqual(fs.readFileSync(path.join(concurrent, verified.MODELS.base.file)), bytes);
  assert.ok(fs.readdirSync(concurrent).every((f) => !f.endsWith('.part')), 'concurrent downloads clean their private temporary files');
  verified.MODELS.base.sha256 = 'incorrect';
  const corrupt = path.join(root, 'corrupt');
  await assert.rejects(verified.install(corrupt), /checksum/);
  assert.ok(!fs.existsSync(path.join(corrupt, verified.MODELS.base.file)), 'invalid downloads never become the cached model');
  assert.ok(fs.readdirSync(corrupt).every((f) => !f.endsWith('.part')));
  verified.MODELS.base.size++;
  await assert.rejects(verified.install(corrupt), /incomplete/);
  assert.ok(!fs.existsSync(path.join(corrupt, verified.MODELS.base.file)));
  console.log('Whisper engine OK: native macOS lookup, managed engines, missing-engine guidance, concurrent downloads and verified model publication');
})().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch((error) => {
  console.error(error); process.exitCode = 1;
});
