const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { FrameReader } = require('../../../electron/export/fxjobs.cjs');

(async () => {
  const proc = new EventEmitter();proc.stdout = new EventEmitter();proc.stderr = new EventEmitter();
  let pauses=0,resumes=0;proc.stdout.pause=()=>pauses++;proc.stdout.resume=()=>resumes++;
  const reader = new FrameReader(proc, 20), data = Buffer.from(Array.from({length: 2013}, (_, i) => i % 251));
  const waiting = reader.next();proc.stdout.emit('data', data.subarray(0, 7));
  for(let i=7;i<data.length;i+=13)proc.stdout.emit('data', data.subarray(i, i+13));
  proc.stdout.emit('end');
  assert.deepEqual(await waiting, data.subarray(0,20));
  const frames=[];for(let frame; (frame=await reader.next());) frames.push(frame);
  assert.deepEqual(Buffer.concat(frames), data.subarray(20,2000), 'arbitrary chunk boundaries retain every complete frame in order');
  assert.ok(pauses>0&&resumes>0, 'backpressure pauses and resumes the decoder');
  assert.equal(await reader.next(),null,'partial final frames are never exposed');
  frames[0].fill(255);assert.deepEqual(frames[1],data.subarray(40,60),'returned frames do not share mutable storage');
  const failed=new EventEmitter();failed.stdout=new EventEmitter();failed.stderr=new EventEmitter();failed.stdout.pause=failed.stdout.resume=()=>{};
  const broken=new FrameReader(failed,20),pending=broken.next();failed.emit('error',new Error('decode failed'));
  assert.equal(await pending,null);assert.equal(broken.err,'decode failed');
  console.log('Frame reader preserves boundaries, order, backpressure, isolated storage and error completion.');
})().catch(error=>{console.error(error);process.exitCode=1;});
