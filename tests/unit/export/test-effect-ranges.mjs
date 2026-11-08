import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pixelEffectRanges } from '../../../src/features/effects/apply.js';
const require=createRequire(import.meta.url),ff=require('../../../electron/media/ffmpeg.cjs');
const {FxJobs}=require('../../../electron/export/fxjobs.cjs');
const clip={id:'v',mediaId:'m',in:2,out:5,speed:1};
assert.deepEqual(pixelEffectRanges({effectClips:[{fx:'fx_invert',start:1,duration:1}]},clip,0,3,10),[[1,2]]);
assert.deepEqual(pixelEffectRanges({effectClips:[{fx:'fx_invert',start:1.01,duration:.15},{fx:'fx_invert',start:1.15,duration:.3}]},clip,0,3,10),[[1,1.5]]);
assert.deepEqual(pixelEffectRanges({effectClips:[{fx:'fx_invert',start:8,duration:1}]},clip,0,3,10),[]);
assert.deepEqual(pixelEffectRanges({effectClips:[]},{...clip,effects:['fx_invert']},0,3,10),[[0,3]]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-range-export-')),source=path.join(dir,'source.mp4');
execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=6','-f','lavfi','-i','sine=frequency=440:duration=6','-shortest','-c:v','libx264','-crf','12','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',source]);
const p={width:320,height:180,fps:30,background:'#000000',media:[{...await ff.probe(source),id:'m',path:source}],videoClips:[clip],overlayClips:[],audioClips:[],textClips:[],export:{outW:160,outH:90,outFps:10,codecFamily:'h264',crf:18}};
const jobs=new FxJobs();
const saved=process.env.FVE_ENCODER;process.env.FVE_ENCODER='libx264';
try{
 const job=jobs.begin(p,{kind:'clip',track:'video',clipId:'v',from:1,to:2,cacheKey:'pin-cache-regression'});assert.deepEqual([job.width,job.height,job.frames,job.fps],[160,90,10,10]);
 let count=0,reads=0;
 while(count<job.frames){const batch=await jobs.read(job.id,4);reads++;const frames=batch.frames;assert.ok(frames.length);
  for(const frame of frames)for(let i=0;i<frame.length;i+=4){frame[i]=255-frame[i];frame[i+1]=255-frame[i+1];frame[i+2]=255-frame[i+2];}
  await jobs.write(job.id,frames);count+=frames.length;
 }
 await jobs.end(job.id);assert.equal(reads,3);
 const hit=jobs.begin(p,{kind:'clip',track:'video',clipId:'v',from:1,to:2,cacheKey:'pin-cache-regression'});assert.equal(hit.cached,true);
 const pinned=jobs.jobs.get(hit.id).file,cached=[...jobs.cache.entries.values()][0].file;
 assert.notEqual(pinned,cached);assert.equal(fs.statSync(pinned).ino,fs.statSync(cached).ino);
 jobs.cache.clear();assert.ok(fs.existsSync(pinned),'cache eviction cannot remove an input pinned by this export');
 assert.deepEqual(jobs.jobs.get(job.id).readers,[],'completed renders release decoder buffers');
 const rendered=jobs.resolve({...p,videoClips:[{...clip,videoOverride:{start:0,end:3,sourceIn:2,sourceSpeed:1,segments:[{from:1,to:2,job:job.id}]}}]});
 const frame=(file,time)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
 const evidence=[];
 for(const [name,project,offset,duration] of [['whole',rendered,0,3],['narrow',{...rendered,videoClips:[ff.narrowClip(rendered.videoClips[0],p.media[0],1.2,2.5)]},1.2,1.3]]){
  const file=path.join(dir,name+'.mp4');await ff.runExport(project,file,()=>{}).promise;const info=await ff.probe(file);assert.ok(Math.abs(info.duration-duration)<.11);assert.equal(info.hasAudio,true);
  for(const t of name==='whole'?[.5,1.5,2.5]:[.3,1]){
   const time=t+offset,a=frame(source,2+time),b=frame(file,t);let error=0;
   for(let i=0;i<a.length;i++)error+=Math.abs(b[i]-(time>=1&&time<2?255-a[i]:a[i]));
   const mean=error/a.length;assert.ok(mean<8,`${name} at ${t}: RGB difference ${mean}`);evidence.push({name,time:t,mean_absolute_rgb_error:mean});
  }
 }
 const fullFile=path.join(dir,'full-override.mp4');
 const full=jobs.resolve({...p,videoClips:[{...clip,in:3,out:4,videoOverride:{job:job.id,start:0,end:1}}]});
 await ff.runExport(full,fullFile,()=>{}).promise;
 const original=frame(source,3.5),processed=frame(fullFile,.5);let fullError=0;
 for(let i=0;i<original.length;i++)fullError+=Math.abs(processed[i]-(255-original[i]));
 fullError/=original.length;assert.ok(fullError<5,'full-clip effect retains BT.709 RGB values: '+fullError);evidence.push({name:'full override',time:.5,mean_absolute_rgb_error:fullError});
 const fractional={...p,videoClips:[{...clip,in:2,out:2.21}]};
 const fractionJob=jobs.begin(fractional,{kind:'clip',track:'video',clipId:'v'});assert.equal(fractionJob.frames,2,'fractional durations retain the existing nearest-frame output clock');
 const fractionFrames=(await jobs.read(fractionJob.id,4)).frames;assert.equal(fractionFrames.length,2);
 for(const frame of fractionFrames)for(let i=0;i<frame.length;i+=4){frame[i]=255-frame[i];frame[i+1]=255-frame[i+1];frame[i+2]=255-frame[i+2];}
 await jobs.write(fractionJob.id,fractionFrames);await jobs.end(fractionJob.id);
 const fractionFile=path.join(dir,'fractional.mp4');await ff.runExport(jobs.resolve({...fractional,videoClips:[{...fractional.videoClips[0],videoOverride:{job:fractionJob.id,start:0,end:.21}}]}),fractionFile,()=>{}).promise;
 const expectedTail=frame(source,2.1),actualTail=frame(fractionFile,.1);let tailError=0;
 for(let i=0;i<expectedTail.length;i++)tailError+=Math.abs(actualTail[i]-(255-expectedTail[i]));tailError/=expectedTail.length;assert.ok(tailError<5,'fractional final frame is processed: '+tailError);
 const transitionProject={...p,videoClips:[{...clip,in:2,out:3},{...clip,id:'next',in:3,out:4,transition:{type:'fx_wipeup',duration:.21}}]};
 const transition=jobs.begin(transitionProject,{kind:'transition',clipId:'next'});assert.equal(transition.frames,2);
 const pairs=(await jobs.read(transition.id,4)).frames;assert.equal(pairs.length,2,'both fractional transition decoders return every requested frame');
 await jobs.write(transition.id,pairs.map(pair=>pair.a));await jobs.end(transition.id);
 evidence.push({name:'fractional clip and transition',frames:fractionJob.frames,mean_absolute_rgb_error:tailError});
 fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log('ranged/batched effect export preserves unaffected frames, inversion, seeking, audio and narrowed transition windows; evidence: '+dir);
}finally{jobs.clear();if(saved===undefined)delete process.env.FVE_ENCODER;else process.env.FVE_ENCODER=saved;}
