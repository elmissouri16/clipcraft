// Acceptance for a packaged or installed ClipCraft build. It inspects the shipped payload, starts
// the real application with a fresh profile, and drives its renderer over the DevTools protocol:
// version, packaged ffprobe (media probe), packaged ffmpeg (frame grab and a real MP4 export), the
// extension installation/trust/settings/native controls/views and a cold restart. Builds only an
// SDK fixture; it never builds an app/installer or publishes. Its isolated profile is disposable.
//
// Usage:
//   node scripts/verify-packaged-app.cjs --app <ClipCraft.app | install dir | executable> --output <dir>
// Options:
//   --installer <file>  record the installer this build came from (name, size, SHA-256)
//   --no-sandbox        start Chromium without its sandbox (recorded in the receipt)
//   --unpackaged <dir>  development only: treat --app as an Electron binary and run this checkout;
//                       payload checks are skipped and the receipt says packaged: false
// Limits: no native picker/trust UI, installer UI, save/reopen dialogs, keychain, assistive
// technology or performance budget is exercised. The receipt lists exactly what ran.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Operation timed out after ' + ms + ' ms')), ms);})]); }
  finally { clearTimeout(timer); }
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const receipt = { ok: false, packaged: true, platform: process.platform, arch: process.arch, expectedVersion: pkg.version, checks: [], limits: [
  'Native picker/trust replies are fixtures supplied through the main-process debugger; their UI was not exercised.',
  'Installer UI, save/reopen dialogs and the system keychain were not exercised.',
  'The screenshot is retained as evidence; its pixels are not asserted.',
  'The application is stopped by signal after the checks; a clean user quit is not asserted.',
] };
const check = (ok, what, detail) => {
  if (!ok) throw new Error(`${what}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  receipt.checks.push(what);
  console.log(`ok   ${what}`);
};

// Resolve the executable and its resources directory from an .app, an install directory or a binary.
function locate(target) {
  const stat = fs.statSync(target);
  if (process.platform === 'darwin') {
    const bundle = stat.isDirectory() ? target : path.resolve(target, '../../..');
    const names = fs.readdirSync(path.join(bundle, 'Contents', 'MacOS'));
    return { executable: path.join(bundle, 'Contents', 'MacOS', names.includes(pkg.productName) ? pkg.productName : names[0]), resources: path.join(bundle, 'Contents', 'Resources') };
  }
  const dir = stat.isDirectory() ? target : path.dirname(target);
  const wanted = process.platform === 'win32' ? [`${pkg.productName}.exe`] : [pkg.name, pkg.productName, pkg.productName.toLowerCase()];
  const executable = stat.isDirectory() ? wanted.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file)) : target;
  if (!executable) throw new Error(`No ClipCraft executable in ${dir}`);
  return { executable, resources: path.join(dir, 'resources') };
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const runs = (file, ...argv) => { try { return execFileSync(file, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true }); } catch { return null; } };

// The shipped payload: archive contents, version, excluded development files and native media tools.
function inspectPayload(resources) {
  const archive = path.join(resources, 'app.asar');
  check(fs.existsSync(archive), 'the application archive is present');
  const asar = require('@electron/asar');
  const files = new Set(asar.listPackage(archive, { isPack: false }).map((name) => name.split(path.sep).join('/')));
  for (const required of ['/package.json', '/electron/main.cjs', '/electron/preload.cjs', '/electron/plugins/extensionWorker.cjs', '/electron/plugins/extensionViewPreload.cjs', '/dist/index.html', '/LICENSE', '/THIRD-PARTY-NOTICES.md']) check(files.has(required), `the archive ships ${required}`);
  check([...files].some((name) => name.startsWith('/shared/')), 'the archive ships shared data');
  const development = [...files].filter((name) => /^\/(?:tests|src|scripts|docs|examples|packages|\.github)\//.test(name));
  check(development.length === 0, 'the archive contains no development sources or tests', development.slice(0, 5));
  const shipped = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  check(shipped.version === pkg.version, `the archive is version ${pkg.version}`, shipped.version);
  check(!fs.existsSync(path.join(resources, 'clipcraft-pack')), 'the release payload excludes the bundled content pack');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const native = fs.existsSync(unpacked) ? walk(unpacked) : [];
  const tool = (name) => native.filter((file) => path.basename(file).toLowerCase() === (process.platform === 'win32' ? `${name}.exe` : name)).find((file) => /version/i.test(runs(file, '-version') || ''));
  const ffmpeg = tool('ffmpeg'), ffprobe = tool('ffprobe');
  check(!!ffmpeg, 'an unpacked ffmpeg runs on this machine', native.filter((file) => /ffmpeg/i.test(path.basename(file))));
  check(!!ffprobe, 'an unpacked ffprobe runs on this machine', native.filter((file) => /ffprobe/i.test(path.basename(file))));
  Object.assign(receipt, { archive: { bytes: fs.statSync(archive).size, sha256: sha256(archive), files: files.size }, ffmpeg: path.relative(resources, ffmpeg), ffprobe: path.relative(resources, ffprobe) });
  // A universal macOS build may still carry single-architecture media tools; record what shipped.
  if (process.platform === 'darwin') receipt.architectures = Object.fromEntries(Object.entries({ ffmpeg, ffprobe }).map(([name, file]) => [name, (runs('lipo', '-archs', file) || 'unknown').trim()]));
  return { ffmpeg, ffprobe };
}

const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

// Minimal DevTools protocol client for one page target (Node's built-in WebSocket).
async function connect(port, deadline, main = false, alive = () => true) {
  let target;
  while (!target) {
    if (!alive()) throw Error('The application exited during debugger startup.');
    if (Date.now() > deadline) throw new Error(main ? 'The main-process debugger did not appear.' : 'The application window did not appear.');
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => main ? entry.type === 'node' : entry.type === 'page' && /index\.html|^http/.test(entry.url)); } catch { /* not listening yet */ }
    if (!target) await wait(500);
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(new Error('DevTools connection failed.')), { once: true }); });
  let next = 0;
  const pending = new Map(), exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const item of pending.values()) item.reject(Error('DevTools connection closed')); pending.clear(); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('DevTools command timed out: ' + method)); }, 60000);
    pending.set(id, {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, ms) => { for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await evaluate(expression)) return true; return false; };
  await send('Runtime.enable');
  return { url: target.url, send, evaluate, until, exceptions, close: () => socket.close() };
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

async function stopped(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  stop(child);
  await closed;
}

(async () => {
  const target = option('--app'), unpackaged = option('--unpackaged');
  if (!target) throw new Error('Usage: node scripts/verify-packaged-app.cjs --app <path> --output <dir>');
  const requestedOutput = option('--output');
  const output = path.resolve(requestedOutput || fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-packaged-')));
  if (requestedOutput) fs.mkdirSync(output);
  receipt.output = output;
  const installer = option('--installer');
  if (installer) receipt.installer = { name: path.basename(installer), bytes: fs.statSync(installer).size, sha256: sha256(installer) };
  let child, page, main;
  try {
    let executable, tools;
    if (unpackaged) {
      receipt.packaged = false;
      executable = path.resolve(target);
      const media = require(path.join(path.resolve(unpackaged), 'electron/media/ffmpeg.cjs'));
      tools = { ffmpeg: media.ffmpegPath, ffprobe: media.ffprobePath || media.ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1') };
    } else {
      const located = locate(path.resolve(target));
      executable = located.executable;
      tools = inspectPayload(located.resources);
      if (process.platform === 'darwin') receipt.architectures.application = (runs('lipo', '-archs', executable) || 'unknown').trim();
    }
    receipt.executable = executable;
    const extensionAcceptance = require('./packaged-extension-acceptance.cjs');
    const fixture = await extensionAcceptance.prepare(root, output);
    fixture.packaged = !unpackaged;
    receipt.extension = {fixture, runs: []};

    const source = path.join(output, 'source.mp4');
    execFileSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], { windowsHide: true });
    check(fs.statSync(source).size > 1000, 'the shipped ffmpeg encodes a source clip');

    const profile = path.join(output, 'profile');
    const sandbox = args.includes('--no-sandbox') ? ['--no-sandbox'] : [];
    receipt.noSandbox = sandbox.length > 0;
    const env = { ...process.env };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RESTART', 'NODE_PATH', 'NODE_OPTIONS', 'FVE_SMOKE', 'FVE_SMOKE_MODE', 'VITE_DEV_SERVER_URL']) delete env[name];
    env.CLIPCRAFT_DEV_EXAMPLES = '0';
    let exited = null;
    async function launch(reopen = false) {
      const port = await freePort(), inspectorPort = await freePort(), log = fs.openSync(path.join(output, reopen ? 'restart.log' : 'application.log'), 'w');
      child = spawn(executable, [...(unpackaged ? [path.resolve(unpackaged)] : []), `--inspect=127.0.0.1:${inspectorPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-mock-keychain', '--password-store=basic', ...sandbox],
        {env, stdio: ['ignore', log, log], detached: process.platform !== 'win32'});
      fs.closeSync(log);
      exited = null;
      child.on('exit', (code, signal) => { exited = {code, signal}; });
      child.on('error', error => { exited = {error: error.message}; });
      [page, main] = await Promise.all([connect(port, Date.now() + 120000, false, () => !exited), connect(inspectorPort, Date.now() + 120000, true, () => !exited)]);
    }
    await launch();
    check(true, 'the application starts and opens its window');
    check(await page.until(`!!window.api && document.readyState === 'complete'`, 60000), 'the renderer loads with the application bridge');
    if (!unpackaged) check(/^file:.*app\.asar/.test(page.url), 'the renderer is served from the application archive', page.url);
    const version = await page.evaluate('window.api.appVersion()');
    check(version === pkg.version, `the running application reports version ${pkg.version}`, version);
    check(await page.until(`!!document.querySelector('.home-frame-card')`, 60000), 'the home screen renders');

    const probed = await page.evaluate(`window.api.probePaths([${JSON.stringify(source)}])`);
    const media = probed?.[0];
    check(probed?.length === 1 && media.type === 'video' && media.width === 640 && media.height === 360 && Math.abs(media.duration - 3) < 0.2, 'the packaged ffprobe reads the clip through the application', probed);
    const frame = await page.evaluate(`window.api.frameGrab(${JSON.stringify(source)}, 1)`);
    check(frame?.ok === true && fs.existsSync(frame.path) && fs.statSync(frame.path).size > 1000, 'the packaged ffmpeg extracts a frame through the application', frame);
    const plugins = await page.evaluate('window.api.pluginsList()');
    check(plugins && !plugins.error, 'the plugin inventory answers', plugins?.error);

    await page.evaluate(`document.querySelector('.home-frame-card').click()`);
    check(await page.until(`!!document.querySelector('.topbar') && !!window.__fve`, 60000), 'the editor opens');
    await page.evaluate(`document.querySelector('.welcome-go')?.click()`);
    const project = { id: 'packaged-acceptance', name: 'Packaged acceptance', width: 640, height: 360, fps: 30, ratio: '16:9', background: '#000000', media: [{ ...media, id: 'm', name: 'source.mp4' }],
      videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }], overlayClips: [], audioClips: [], textClips: [], stickerClips: [], effectClips: [] };
    await page.evaluate(`window.__fve.load(${JSON.stringify(project)})`);
    check(await page.until(`window.__fve.exportData().project.videoClips.length === 1 && !!document.querySelector('.stage')`, 30000), 'the editor loads a project with the clip on the timeline');
    receipt.extension.runs.push(await extensionAcceptance.exercise({page, main, fixture, check}));
    await wait(2000);
    fs.writeFileSync(path.join(output, 'editor.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    const exported = path.join(output, 'export.mp4'), frames = path.join(output, 'export-frames');
    fs.mkdirSync(frames);
    const result = await within(page.evaluate(`window.api.exportRun(${JSON.stringify(project)}, ${JSON.stringify({ file: exported, frameDir: frames })}, 0)`), 240000);
    check(result?.ok === true && result.size > 1000, 'the application exports the project to MP4', result);
    const info = JSON.parse(execFileSync(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', exported], { encoding: 'utf8', windowsHide: true }));
    const video = info.streams.find((stream) => stream.codec_type === 'video'), audio = info.streams.find((stream) => stream.codec_type === 'audio');
    receipt.export = { bytes: result.size, duration: Number(info.format.duration), video: video && { codec: video.codec_name, width: video.width, height: video.height }, audio: audio && { codec: audio.codec_name } };
    check(video?.width === 640 && video.height === 360 && !!audio && Math.abs(receipt.export.duration - 3) < 0.3, 'the exported file has the expected picture, sound and length', receipt.export);

    check(!exited, 'the application is still running after the workflow', exited);
    check(page.exceptions.length === 0, 'the renderer raised no uncaught exception', page.exceptions.slice(0, 3));
    check(fs.existsSync(profile) && fs.readdirSync(profile).length > 0, 'the run used its own fresh profile');
    page.close(); main.close(); await stopped(child);
    await launch(true);
    check(await page.until(`!!window.__fve && document.readyState === 'complete'`, 60000), 'the application restarts with its existing isolated profile');
    await page.evaluate(`document.querySelector('.home-frame-card')?.click()`);
    check(await page.until(`!!document.querySelector('.topbar')`, 30000), 'the restarted editor opens');
    await page.evaluate(`(() => {document.querySelector('.welcome-go')?.click(); window.__fve.load(${JSON.stringify(project)});})()`);
    receipt.extension.runs.push(await extensionAcceptance.exercise({page, main, fixture, check, reopen: true}));
    check(page.exceptions.length === 0, 'the restarted renderer raised no uncaught exception', page.exceptions);
    page.close(); main.close();
    receipt.ok = true;
  } catch (error) {
    receipt.error = error.message;
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  } finally {
    page?.close(); main?.close();
    stop(child);
    fs.writeFileSync(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`${receipt.ok ? 'PACKAGED APP OK' : 'PACKAGED APP FAILED'} (${receipt.checks.length} checks); evidence: ${output}`);
  }
})();
