const assert = require('node:assert/strict');
const { runImageJobs, IMAGE_CONCURRENCY } = require('../electron/imageJobs.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const started = [], releases = new Map();
  let active = 0, peak = 0;
  const batch = runImageJobs([0,1,2,3,4], async index => {
    started.push(index); peak = Math.max(peak, ++active);
    await new Promise(resolve => releases.set(index, resolve)); active--;
    if (index === 1) throw new Error('One scene failed');
    return { scene: index };
  });
  assert.deepEqual(started, [0,1,2]);
  releases.get(2)(); await tick(); assert.deepEqual(started, [0,1,2,3]);
  releases.get(1)(); await tick(); assert.deepEqual(started, [0,1,2,3,4]);
  releases.get(4)(); releases.get(3)(); releases.get(0)();
  assert.deepEqual(await batch, [{scene:0},{error:'One scene failed'},{scene:2},{scene:3},{scene:4}]);
  assert.equal(peak, IMAGE_CONCURRENCY);
  const controller = new AbortController(), canceled = [];
  const pending = runImageJobs([0,1,2,3,4], index => {
    canceled.push(index);
    return new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true}));
  }, controller.signal);
  controller.abort();
  assert.ok((await pending).every(result => result.canceled));
  assert.deepEqual(canceled, [0,1,2], 'Stop cancels running jobs and never starts queued scenes');
  await assert.rejects(runImageJobs([], () => {}), /1–12/);
  await assert.rejects(runImageJobs(Array(13).fill({}), () => {}), /1–12/);
  assert.ok((await runImageJobs([1], () => { throw new Error('Must not run'); }, controller.signal))[0].canceled);
  console.log('image jobs ok (bounded overlap, order, partial failure, queued and running cancellation)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
