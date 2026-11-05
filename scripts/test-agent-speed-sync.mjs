import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { emptyProject, historyReducer, retimeVideoClip, videoLayout, exportDuration, freeLen } from '../src/store.js';
import { createToolRunner } from '../src/agent/tools.js';
import { validateAgentProject } from '../src/agent/validation.js';
import ff from '../electron/ffmpeg.cjs';
const clip = (id, inPoint, outPoint, extra = {}) => ({ id, mediaId:'m',in:inPoint,out:outPoint,speed:1,...extra });
const base = () => ({...emptyProject(),id:'speed-sync',media:[{id:'m',name:'source.mp4',type:'video',duration:40,width:160,height:90,hasAudio:true}],
  videoClips:[clip('lead',0,5),clip('target',5,15),clip('tail',15,20)]});
const near = (a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const check = (p,speed=2)=>{const result=retimeVideoClip(p,'target',speed);assert.equal(result.error,undefined,result.error);assert.equal(validateAgentProject(result.project).ok,true);return result.project;};
{
 const p=base();p.textClips=[{id:'caption',caption:true,text:'Human corrected!',start:6,duration:4,words:[{text:'raw',start:0,end:.5,timing:'measured'},{text:'two',start:2,end:3,timing:'measured'}]},
   {id:'crossing',text:'Across the whole edit',start:3,duration:14}];p.effectClips=[{id:'fx',fx:'blur',start:7,duration:10}];p.markers=[{id:'a',time:3},{id:'b',time:10},{id:'c',time:18}];
 const q=check(p);assert.deepEqual(videoLayout(q.videoClips).map(l=>[l.start,l.end]),[[0,5],[5,10],[10,15]]);
 const caption=q.textClips.find(c=>c.id==='caption'), crossing=q.textClips.find(c=>c.id==='crossing');
 assert.equal(caption.text,'Human corrected!');near(caption.start,5.5);near(caption.duration,2);assert.deepEqual(caption.words.map(w=>[w.start,w.end]),[[0,.25],[1,1.5]]);
 assert.equal(crossing.start,3);assert.equal(crossing.duration,9);assert.equal(q.effectClips[0].start,6);assert.equal(q.effectClips[0].duration,6);
 assert.deepEqual(q.markers.map(m=>m.time),[3,7.5,13]);
 const manual=historyReducer({past:[],future:[],present:p},{type:'update',track:'video',id:'target',patch:{speed:2}}).present;
 assert.equal(manual.textClips.find(c=>c.id==='caption').start,6,'manual speed update semantics stay unchanged');
}
{
 const p=base();const keys={scale:[{t:0,v:1},{t:20,v:2}]};
 p.overlayClips=[clip('overlay',0,20,{start:0,keyframes:keys})];p.audioClips=[clip('sound',0,20,{start:0,fadeIn:1,fadeOut:1})];
 const q=check(p);assert.deepEqual(q.overlayClips.map(c=>[c.start,c.in,c.out,c.speed]),[[0,0,5,1],[5,5,15,2],[10,15,20,1]]);
 q.overlayClips.forEach(c=>assert.deepEqual(c.keyframes,keys));assert.deepEqual(q.audioClips.map(c=>[c.start,c.in,c.out,c.speed,c.fadeIn,c.fadeOut]),[[0,0,5,1,1,0],[5,5,15,2,0,0],[10,15,20,1,0,1]]);
 for(const list of [q.overlayClips,q.audioClips]) for(let i=1;i<list.length;i++){near(list[i-1].out,list[i].in);near(list[i-1].start+freeLen('audio',list[i-1]),list[i].start);}
 assert.equal(new Set([...q.videoClips,...q.overlayClips,...q.audioClips].map(c=>c.id)).size,9);
 const restore=retimeVideoClip(q,'target',1);assert.equal(restore.error,undefined);near(exportDuration(restore.project),20);
}
{
 const p=base();p.videoClips[1]={...p.videoClips[1],muted:true,linkId:'main-link'};
 p.overlayClips=[clip('overlay',0,20,{start:0,linkId:'overlay-link',muted:true})];
 p.audioClips=[clip('main-audio',0,10,{start:5,linkId:'main-link',linkOff:0,linkInOff:-5}),clip('overlay-audio',0,20,{start:0,linkId:'overlay-link',linkOff:0,linkInOff:0,layer:1})];
 const q=check(p);assert.equal(q.audioClips.filter(c=>c.linkId==='main-link')[0].speed,2);
 for(const pic of q.overlayClips){const sound=q.audioClips.find(c=>c.linkId===pic.linkId);assert.ok(sound);near(sound.start,pic.start);near(sound.in,pic.in);near(sound.out,pic.out);near(sound.speed,pic.speed);}
 assert.equal(new Set(q.overlayClips.map(c=>c.linkId)).size,3);
 const applied=historyReducer({past:[],future:[],present:p},{type:'retimeVideo',id:'target',speed:2}).present;assert.equal(validateAgentProject(applied).ok,true);assert.equal(applied.audioClips.length,4);
}
{
 const p=base();p.textClips=[{id:'caption',caption:true,text:'Locked',start:6,duration:1}];p.layerState={'text:0':{locked:true}};
 assert.match(retimeVideoClip(p,'target',2).error,/locked text/);assert.equal(historyReducer({past:[],present:p,future:[]},{type:'retimeVideo',id:'target',speed:2}).present,p);
 p.textClips[0].start=1;assert.equal(retimeVideoClip(p,'target',2).error,undefined,'unaffected locked captions do not block speed edits');
}
{
 const p=base();p.audioClips=[clip('fade',0,20,{start:0,fadeIn:8})];assert.match(retimeVideoClip(p,'target',2).error,/fade/);
 p.audioClips=[clip('processed',0,20,{start:0,enhance:{on:true,path:'/processed.wav',from:0,to:20}})];assert.match(retimeVideoClip(p,'target',2).error,/enhanced/);
 p.audioClips=[clip('too-fast',0,40,{start:0,speed:4})];assert.match(retimeVideoClip(p,'target',4).error,/outside the supported/);
}
{
 const p=base();p.videoClips=[clip('lead',0,10),clip('target',10,20,{transition:{type:'fade',duration:2}}),clip('tail',20,30,{transition:{type:'fade',duration:2}})];
 const q=check(p);near(exportDuration(q),21);assert.deepEqual(videoLayout(q.videoClips).map(l=>[l.start,l.end]),[[0,8],[8,9],[8,13],[12,13],[13,21]]);
 const qslow=check(p,.5);near(exportDuration(qslow),36);
}
{
 let state={past:[],future:[],present:base()};state.present.textClips=[{id:'caption',caption:true,text:'Stay with speech',start:6,duration:1}];
 const runner=createToolRunner({getProject:()=>state.present,dispatch:a=>{state=historyReducer(state,a);},settle:async()=>{},api:{}});
 let r=await runner.run('set_speed',{clip_id:'target',speed:2});assert.equal(r.ok,true,r.error);near(state.present.textClips[0].start,5.5);near(r.duration_sec,15);
 const before=state.present;r=await runner.run('set_speed',{clip_id:'target',speed:2});assert.equal(r.changed,false);assert.equal(state.present,before);
 const ignored=createToolRunner({getProject:()=>base(),dispatch:()=>{},settle:async()=>{},api:{}});assert.match((await ignored.run('set_speed',{clip_id:'target',speed:2})).error,/planned timeline mapping/);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-speed-sync-'));
try{
 const source=path.join(dir,'source.mp4');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=4','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=4','-shortest','-pix_fmt','yuv420p',source]);
 const p={...emptyProject(),width:160,height:90,fps:10,media:[{...(await ff.probe(source)),id:'m',name:'source',path:source}],videoClips:[clip('lead',0,2),clip('target',2,4,{transition:{type:'fade',duration:.4}})],overlayClips:[],audioClips:[clip('bed',0,4,{start:0,volume:.1})]};
 const result=retimeVideoClip(p,'target',2);assert.equal(result.error,undefined,result.error);const q=result.project;
 const output=path.join(dir,'retimed.mp4');await ff.runExport(q,output,()=>{}).promise;const info=await ff.probe(output);assert.ok(Math.abs(info.duration-exportDuration(q))<.12);
 const pixels=(file,time)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
 const actualFrame=pixels(output,2.2),sourceFrame=pixels(source,3.2);let difference=0;for(let i=0;i<actualFrame.length;i++)difference+=Math.abs(actualFrame[i]-sourceFrame[i]);
 const frameDifference=difference/actualFrame.length;
 const neighbors=[3,3.1,3.3,3.4].map(time=>{const bytes=pixels(source,time);let d=0;for(let i=0;i<actualFrame.length;i++)d+=Math.abs(actualFrame[i]-bytes[i]);return d/actualFrame.length;});
 assert.ok(neighbors.every(d=>frameDifference<d),'exported image matches the mapped source moment more closely than its neighboring source frames');
 const wav=path.join(dir,'retimed.wav');await ff.renderTimelineAudio(q,wav);const audio=await ff.probe(wav);assert.ok(Math.abs(audio.duration-(4-1))<.12,'split audio remains source-continuous across the warped interval');
 const evidence={ok:true,export_duration:info.duration,planned_duration:exportDuration(q),audio_duration:audio.duration,source_frame_difference:frameDifference,nearest_other_frame_difference:Math.min(...neighbors)};if(process.env.AGENT_SPEED_EVIDENCE)fs.writeFileSync(process.env.AGENT_SPEED_EVIDENCE,JSON.stringify(evidence,null,2));
 console.log('agent speed sync ok (piecewise clock, captions, words, source continuity, links, locks, transitions, manual compatibility and real FFmpeg export)');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
