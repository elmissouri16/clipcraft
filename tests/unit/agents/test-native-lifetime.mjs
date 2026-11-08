import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { activityTimeout } = createRequire(import.meta.url)('../../../electron/system/cancel.cjs');
let now=0, next=0, expired=0;
const jobs=new Map(),clock={setTimeout(fn,ms){const id=++next;jobs.set(id,{at:now+ms,fn});return id;},clearTimeout(id){jobs.delete(id);}};
const advance=ms=>{now+=ms;for(const [id,job] of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}};
const lifetime=activityTimeout(()=>expired++,100,clock);
for(let i=0;i<20;i++){advance(75);lifetime.touch();assert.equal(expired,0,'progress outlives the original absolute deadline');}
advance(101);assert.equal(expired,1,'a stalled request expires');lifetime.touch();advance(200);assert.equal(expired,1);
const disposed=activityTimeout(()=>assert.fail('disposed request expired'),100,clock);disposed.dispose();advance(101);
console.log('native lifetime: active requests survive, idle requests expire, disposal releases timers');
