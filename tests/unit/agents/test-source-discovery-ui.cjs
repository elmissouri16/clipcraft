// A fresh renderer server/profile: the smoke exercises current source, not an old dist.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), net = require('node:net');
(async () => {
  const mode = process.env.FVE_SMOKE_MODE || 'source-discovery';
  const root = path.resolve(__dirname, '../../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), `clipcraft-${mode}-ui-`));
  const port = await new Promise((resolve, reject) => { const server = net.createServer();server.on('error', reject);server.listen(0, '127.0.0.1', () => { const p = server.address().port;server.close(() => resolve(p)); }); });
  const fd = fs.openSync(path.join(dir, 'runtime.log'), 'w'), url = `http://127.0.0.1:${port}`;
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', fd, fd] });let electron;
  try {
    let ready = false;for (let n = 0; n < 100; n++) { try { ready = (await fetch(url)).ok; } catch {}if (ready) break;await new Promise(r => setTimeout(r, 50)); }assert.ok(ready, 'renderer server starts');
    electron = spawn(process.env.ELECTRON_BIN || require('electron'), ['--no-sandbox', root], { cwd: root, stdio: ['ignore', fd, fd], env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: mode, VITE_DEV_SERVER_URL: url } });
    const code = await new Promise(resolve => { const timer = setTimeout(() => { electron.kill('SIGKILL');resolve(-1); }, 120000);electron.once('exit', value => { clearTimeout(timer);resolve(value); }); });
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));assert.equal(code, 0, result.error);assert.ok(result.ok, result.error);
    console.log(`Real-app ${mode} passed; evidence: ` + dir);
  } finally { electron?.kill();vite.kill();fs.closeSync(fd); }
})().catch(error => { console.error(error);process.exitCode = 1; });
