// npm run dev: Vite + Electron, with main-process restarts and process-tree cleanup.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// POSIX children lead their own process groups; Windows uses taskkill /T.
function stopChild(child, { platform = process.platform, spawnImpl = spawn, killImpl = process.kill } = {}) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('close', resolve);
    if (platform === 'win32') {
      const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.once('error', () => { child.kill(); resolve(); });
      killer.once('close', resolve);
    } else {
      try { killImpl(-child.pid, 'SIGKILL'); }
      catch (err) { if (err.code !== 'ESRCH') child.kill('SIGKILL'); resolve(); }
    }
  });
}

async function startDev() {
  const root = path.join(__dirname, '..');
  const url = 'http://localhost:5173';
  const options = { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' };
  // Running the JS entry points with Node avoids shell quoting and .cmd differences.
  const viteEntry = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const vite = spawn(process.execPath, [viteEntry], { ...options, stdio: ['inherit', 'pipe', 'inherit'] });
  let viteOutput = '';
  let viteReady = false;
  vite.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    viteOutput = (viteOutput + chunk).slice(-2000);
    viteReady ||= viteOutput.includes(url);
  });
  let app;
  let quitting = false;
  let restarting = false;
  let timer;
  let watcher;
  const shutdown = async (code = 0) => {
    if (quitting) return;
    quitting = true;
    clearTimeout(timer);
    watcher?.close();
    await Promise.all([stopChild(app), stopChild(vite)]);
    process.exitCode = code;
  };
  const launchApp = () => {
    app = spawn(process.execPath, [require.resolve('electron/cli.js'), '.'], {
      ...options, env: { ...process.env, VITE_DEV_SERVER_URL: url },
    });
    app.once('error', (err) => { console.error('[dev]', err.message); shutdown(1); });
    app.once('exit', (code) => { if (!quitting && !restarting) shutdown(code ?? 1); });
  };
  vite.once('error', (err) => { console.error('[dev]', err.message); shutdown(1); });
  vite.once('exit', (code) => { if (!quitting) shutdown(code || 1); });
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
  watcher = fs.watch(path.join(root, 'electron'), () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (quitting || restarting || !app) return;
      restarting = true;
      console.log('[dev] electron/ changed, restarting the app');
      await stopChild(app);
      if (!quitting) launchApp();
      restarting = false;
    }, 400);
  });
  watcher.on('error', (err) => { console.error('[dev]', err.message); shutdown(1); });
  for (let i = 0; i < 100 && !quitting; i++) {
    try {
      // Wait for OUR Vite process to announce its URL, so an occupied port never
      // opens an Electron window pointed at an unrelated local server.
      if (viteReady) {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok && !quitting) { launchApp(); return; }
      }
    } catch { /* Vite is not listening yet. */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!quitting) {
    console.error('[dev] Vite did not start');
    await shutdown(1);
  }
}

if (require.main === module) startDev().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { stopChild };
