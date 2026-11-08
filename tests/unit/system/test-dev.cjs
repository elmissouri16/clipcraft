// Real POSIX process-tree cleanup plus Windows taskkill routing without a shell.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const { stopChild, watchTree } = require("../../../scripts/dev.cjs");

(async () => {
  await stopChild(null);
  await stopChild({ pid: 123, exitCode: 0 });
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
  let invoked;
  await stopChild(child, { platform: 'win32', spawnImpl: (file, args, opts) => {
    invoked = { file, args, opts };
    const killer = new EventEmitter();
    setImmediate(() => killer.emit('close', 0));
    return killer;
  } });
  assert.deepEqual(invoked, { file: 'taskkill', args: ['/pid', '12345', '/T', '/F'], opts: { windowsHide: true } });
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-dev-watch-'));
  fs.mkdirSync(path.join(root, 'agents'));
  let changes = 0;
  const watcher = watchTree(root, () => { changes++; });
  watcher.on('error', error => { throw error; });
  const changed = async before => {
    for (let i=0;i<100&&changes===before;i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(changes>before,'nested Electron changes must trigger the dev restart');
  };
  try {
    let before=changes; fs.writeFileSync(path.join(root,'agents','tools.cjs'),'first'); await changed(before);
    before=changes; fs.mkdirSync(path.join(root,'audio')); await changed(before);
    before=changes; fs.writeFileSync(path.join(root,'audio','tts.cjs'),'new nested service'); await changed(before);
  } finally { watcher.close();fs.rmSync(root,{recursive:true,force:true}); }
  if (process.platform !== 'win32') {
    const parent = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
      console.log(c.pid);
      setInterval(() => {}, 1000);
    `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const [data] = await once(parent.stdout, 'data');
    const grandchild = Number(String(data).trim());
    try {
      assert.ok(grandchild > 0);
      await stopChild(parent);
      let gone = false;
      for (let n = 0; n < 100; n++) {
        try { process.kill(grandchild, 0); }
        catch (err) { if (err.code === 'ESRCH') { gone = true; break; } throw err; }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(gone, 'shutdown must also terminate the grandchild');
    } finally { try { process.kill(-parent.pid, 'SIGKILL'); } catch {} }
  }
  console.log('dev launcher ok (nested service watching, new directories, Windows routing, POSIX process tree)');
})().catch((err) => { console.error(err); process.exitCode = 1; });
