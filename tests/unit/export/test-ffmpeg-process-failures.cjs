// FFmpeg processes that fail outside FFmpeg itself: a spawn failure in toM4a must reject (an
// unhandled 'error' event crashed the main process), and a hardware encoder whose probe never
// finishes must not hold the encoder pick, and with it every export: past its time limit the
// software encoder is used. spawn is replaced before electron/media/ffmpeg.cjs loads.
// Usage: node tests/unit/export/test-ffmpeg-process-failures.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const realSpawn = childProcess.spawn;
const probes = [];
let mode = 'real';
childProcess.spawn = (file, args, options) => {
  if (mode === 'missing') {
    const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.kill = () => {};
    setImmediate(() => p.emit('error', Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' })));
    return p;
  }
  if (mode === 'disk-full') {
    const p = new EventEmitter(); p.stderr = new PassThrough(); p.kill = () => {};
    fs.writeFileSync(args.at(-1), 'partial encoded output');
    setImmediate(() => { p.stderr.write('No space left on device'); p.emit('close', 1); });
    return p;
  }
  // The hardware probe encodes a test pattern: this one hangs like a wedged driver until killed.
  if (mode === 'wedged' && args.some((a) => String(a).startsWith('testsrc2=size=640x360'))) {
    const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
    probes.push(args[args.indexOf('-c:v') + 1]);
    p.kill = () => { setImmediate(() => p.emit('close', null, 'SIGKILL')); return true; };
    return p;
  }
  return realSpawn(file, args, options);
};
process.env.FVE_ENCODER_PROBE_MS = '300';
delete process.env.FVE_ENCODER;
const ff = require('../../../electron/media/ffmpeg.cjs');

(async () => {
  mode = 'missing';
  await assert.rejects(ff.toM4a('/nowhere/voice.webm', '/nowhere/voice.m4a'), /ENOENT/, 'a spawn failure rejects instead of throwing an unhandled error');

  mode = 'disk-full';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-atomic-'));
  try {
    const out = path.join(dir, 'output.wav'), source = path.join(dir, 'input.wav');
    fs.writeFileSync(out, 'previous export'); fs.writeFileSync(source, 'source bytes');
    const project = { media:[{id:'a',path:source,type:'audio'}], videoClips:[], audioClips:[{id:'c',mediaId:'a',start:0,in:0,out:1}] };
    await assert.rejects(ff.exportAudio(project,out,'wav'), /No space left/);
    assert.equal(fs.readFileSync(out,'utf8'), 'previous export');
    const alias = path.join(dir,'alias.wav'); fs.linkSync(source, alias);
    await assert.rejects(ff.exportAudio(project,alias,'wav'), /source file/);
    assert.equal(fs.readFileSync(source,'utf8'), 'source bytes');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['alias.wav','input.wav','output.wav']);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }

  mode = 'wedged';
  const started = Date.now();
  const pick = await Promise.race([ff.pickEncoder('h264'), new Promise((r) => setTimeout(() => r('still waiting'), 10000))]);
  assert.equal(pick, 'libx264', `a hanging hardware probe falls back to the software encoder (${pick})`);
  assert.ok(Date.now() - started < 5000, 'the fallback comes after the probe limit, not never');
  console.log(`FFMPEG PROCESS FAILURES OK (hardware probes timed out: ${probes.join(', ') || 'none on this machine'})`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
