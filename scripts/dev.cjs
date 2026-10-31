// npm run dev: Vite dev server (hot reload for src/) + Electron window.
// Changes under electron/ restart the app automatically; closing the window stops everything.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
const URL = 'http://localhost:5173';

const vite = spawn(bin('vite'), [], { cwd: root, stdio: 'inherit', shell: true });
let app = null;
let quitting = false;

function startApp() {
  app = spawn(bin('electron'), ['.'], { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, VITE_DEV_SERVER_URL: URL } });
  app.on('exit', () => {
    if (!quitting && !restarting) shutdown();
  });
}

let restarting = false;
let timer = null;
fs.watch(path.join(root, 'electron'), () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('[dev] electron/ changed, restarting the app');
    restarting = true;
    spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { shell: true }).on('exit', () => {
      restarting = false;
      startApp();
    });
  }, 400);
});

function shutdown() {
  quitting = true;
  for (const p of [app, vite]) if (p) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true });
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);

// Wait for Vite before opening the window.
(async function waitForVite() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return startApp();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error('[dev] Vite did not start');
  shutdown();
})();
