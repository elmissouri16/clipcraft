import assert from 'node:assert/strict';
import {ExportProgress,exportStages,formatRemaining,formatElapsed,readExportProfile} from '../../../src/features/export/exportProgress.js';
const project={width:1920,height:1080,fps:30,videoClips:[{in:0,out:10,speed:1}],overlayClips:[],textClips:[],effectClips:[]};
assert.deepEqual(exportStages(project).map(s=>s.id),['prepare','encode','finish']);
assert.deepEqual(exportStages({...project,effectClips:[{fx:'fx_invert',start:0,duration:1}]},30).map(s=>s.id),['prepare','effects','encode','finish']);
assert.deepEqual(exportStages({...project,textClips:[{text:'Caption'}]},30).map(s=>s.id),['prepare','text','effects','encode','finish']);
let time=0,updates=[],value=null;const storage={getItem:()=>value,setItem:(_key,v)=>{value=v;}};
const p=new ExportProgress([{id:'prepare',units:1},{id:'effects',units:200},{id:'encode',units:300},{id:'finish',units:1}],{now:()=>time,publish:v=>updates.push(v),storage});
p.start('prepare');time=100;p.update(1);p.start('effects');
for(let i=1;i<=50;i++){time+=100;p.update(i/50);}
assert.ok(updates.filter(x=>x.phase==='effects').length<35,'progress is throttled rather than rendering at every frame');
assert.ok(updates.some(x=>Number.isFinite(x.remainingSeconds)&&x.remainingSeconds>0),'measured work produces a finite estimate');
p.start('encode');time+=2000;p.update(.1);time+=2000;p.update(.2);const before=updates.at(-1).progress;
time+=1000;p.update(0,{restart:true,encoder:'libx264'});assert.ok(updates.at(-1).progress>=before,'software retry does not move the overall bar backward');
for(let i=1;i<=10;i++){time+=1000;p.update(i/10);}
p.start('finish');time+=500;p.update(1);const elapsed=p.finish();
assert.equal(elapsed,time/1000);assert.ok(readExportProfile(storage).effects>0);
assert.ok(updates.every((x,i)=>x.progress<=.99&&(!i||x.progress>=updates[i-1].progress)),'completion is not promised until the saved file is ready');
const count=updates.length;time+=10000;p.update(.5);assert.equal(updates.length,count,'completed exports ignore late progress');
const cold=new ExportProgress([{id:'encode',units:100}],{now:()=>time,publish:v=>updates.push(v)});cold.start('encode');assert.equal(updates.at(-1).remainingSeconds,null,'warm-up has no false precision');time+=9000;cold.emit(true);assert.equal(updates.at(-1).remainingSeconds,null,'stalled work does not show a false countdown');
assert.equal(formatElapsed(65),'1:05');assert.equal(formatElapsed(3665),'1:01:05');assert.equal(formatRemaining(NaN),null);assert.equal(formatRemaining(5),'Less than 10 seconds remaining');
let cachedProfile={effects:10};const cachedRun=new ExportProgress([{id:'effects',units:100}],{now:()=>time,profile:cachedProfile});cachedRun.start('effects');time+=5000;cachedRun.update(1,{cached:true});cachedRun.finish();assert.equal(cachedProfile.effects,10,'a large cached render does not teach an unrealistically fast cold-render speed');
console.log('Export ETA: warm-up, phase changes, retries, throttling, monotonic progress, persistence and stalls passed');
