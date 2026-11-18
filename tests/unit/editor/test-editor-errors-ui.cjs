// Real-app check (tests/smoke/smoke-editor-errors.cjs), run without WebGL 2: a too-slow saved
// clip and a shader transition do not crash the preview, an error inside the editor shows the
// error boundary instead of a blank window, and an interface crash does not leave an assistant
// export holding the export slot. Its Vite server and Electron profile are temporary.
// Needs a current build (node node_modules/vite/bin/vite.js build). Usage: node tests/unit/editor/test-editor-errors-ui.cjs
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), net = require('node:net');
(async () => {
  const root = path.resolve(__dirname, '../../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-editor-errors-ui-'));
  fs.mkdirSync(path.join(dir, 'settings-test')); fs.writeFileSync(path.join(dir, 'settings-test/settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true } }));
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const fd = fs.openSync(path.join(dir, 'runtime.log'), 'w'), url = 'http://127.0.0.1:' + port;
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', fd, fd] }); let electron;
  try {
    let ready = false; for (let i = 0; i < 100; i++) { try { ready = (await fetch(url)).ok; } catch {} if (ready) break; await new Promise((r) => setTimeout(r, 50)); } assert.ok(ready, 'Vite starts');
    const bin = process.env.ELECTRON_BIN || require('electron');
    // No GPU and no software rasterizer: WebGL 2 is unavailable, as on a machine whose driver is blocked.
    electron = spawn(bin, ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', root], { cwd: root, stdio: ['ignore', fd, fd], env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'editor-errors', VITE_DEV_SERVER_URL: url } });
    const code = await new Promise((resolve) => { const timer = setTimeout(() => { electron.kill('SIGKILL'); resolve(-1); }, 90000); electron.once('exit', (c) => { clearTimeout(timer); resolve(c); }); });
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'))); assert.ok(!result.error, result.error); assert.equal(code, 0);
    console.log(`Editor error checks passed (${result.checks.length}); evidence: ${dir}`);
  } finally { electron?.kill(); vite.kill(); fs.closeSync(fd); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
