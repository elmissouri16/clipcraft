// Run `node scripts/generate-app-icons.cjs` after editing assets/icon.svg.
// Chromium renders the vector; all platform and UI exports share that source.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-icon-export-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (process.platform === 'darwin') app.setActivationPolicy('accessory');

function writeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, png }, index) => {
    const at = 6 + index * 16;
    directory[at] = directory[at + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([directory, ...images.map(image => image.png)]));
}

app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      offscreen: true, backgroundThrottling: false } });
  async function render(svg) {
    const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 }, { stayHidden: true });
  }
  const native = await render(source);
  assert.deepEqual(native.getSize(), { width: 1024, height: 1024 });
  const pixels = native.toBitmap();
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
    assert.equal(pixels[(y * 1024 + x) * 4 + 3], 0, 'Native icon corners must be transparent');
  }
  assert.equal(pixels[(512 * 1024 + 512) * 4 + 3], 255, 'Icon tile must render opaque');
  fs.writeFileSync(path.join(root, 'assets/icon.png'), native.toPNG());
  const uiSource = source.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"');
  fs.writeFileSync(path.join(root, 'public/logo.svg'), uiSource);
  const ui = await render(uiSource);
  fs.writeFileSync(path.join(root, 'public/logo.png'), ui.resize({ width: 512, height: 512 }).toPNG());
  fs.writeFileSync(path.join(root, 'public/favicon.png'), ui.resize({ width: 64, height: 64 }).toPNG());
  writeIco([16, 24, 32, 48, 64, 128, 256].map(size => ({ size,
    png: ui.resize({ width: size, height: size, quality: 'best' }).toPNG() })));
  win.destroy();
  console.log('Updated native PNG, Windows ICO, UI SVG/PNG and favicon from assets/icon.svg');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
