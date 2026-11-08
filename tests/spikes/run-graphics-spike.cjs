// Launch the motion graphics spike inside the real app (no renderer server needed: the spike only
// uses the main process). Evidence: docs/design/motion-graphics-spike.json.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-graphics-spike-'));
fs.mkdirSync(path.join(dir, 'settings-test'));
fs.writeFileSync(path.join(dir, 'settings-test/settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true } }));
const bin = process.env.ELECTRON_BIN || require('electron');
const child = spawn(bin, ['--no-sandbox', root], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'graphics-spike' } });
const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
child.on('exit', (code) => { clearTimeout(timer); console.log(`graphics spike finished (${code}); work files: ${dir}`); process.exitCode = code || 0; });
