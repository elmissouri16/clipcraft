import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import ff from "../../../electron/media/ffmpeg.cjs";import scene from "../../../electron/media/mediaAnalysis.cjs";import frames from "../../../electron/agents/agentFrames.cjs";
import {emptyProject,historyReducer} from "../../../src/state/store.js";import {projectScenes,filterScenes,storyboardSamples} from "../../../src/features/agent/sceneMap.js";import {createToolRunner} from "../../../src/features/agent/tools.js";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-scene-test-'));const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
const source=path.join(dir,'shots.mp4'),cache=new scene.MediaAnalysis(path.join(dir,'cache'));
try {
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=blue:s=160x90:r=10:d=2','-f','lavfi','-i','color=red:s=160x90:r=10:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-pix_fmt','yuv420p',source]);
 const media={...(await ff.probe(source)),id:'m',name:'source.mp4',path:source};const index=await cache.analyze(media);
 check('real FFmpeg finds complete source shot ranges',()=>{assert.equal(index.shots.length,2);assert.deepEqual(index.shots.map(s=>[s.start_sec,s.end_sec]),[[0,2],[2,4]]);});
 const hit=await cache.analyze(media);assert.equal(hit.cached,true);assert.deepEqual(hit.shots,index.shots);checks.push('cache hit retains stable shot IDs');
 const p={...emptyProject(),media:[media],videoClips:[{id:'v',mediaId:'m',in:1,out:4,speed:2},{id:'again',mediaId:'m',in:0,out:2,speed:1}],overlayClips:[{id:'ov',mediaId:'m',in:2,out:4,start:.5,speed:1,layer:2}],layerState:{'overlay:2':{hidden:true}}};
 const mapped=projectScenes(p,new Map([['m',index]]));
 check('source shots map through trim speed repeated uses and layers',()=>{assert.deepEqual(mapped.filter(s=>s.clip_id==='v').map(s=>[s.start_sec,s.end_sec]),[[0,.5],[.5,1.5]]);assert.equal(mapped.find(s=>s.clip_id==='ov').hidden,true);assert.equal(new Set(mapped.map(s=>s.scene_id)).size,mapped.length);});
 check('storyboard time bounds constrain capture times',()=>{
   const long=[{scene_id:'long',shot_id:'long',media_id:'m',clip_id:'c',track:'video',start_sec:0,end_sec:100,source_start_sec:10,source_end_sec:210}];
   assert.equal(storyboardSamples(long,{source:'timeline',start_sec:50,end_sec:51})[0].time_sec,50.5);
   assert.equal(storyboardSamples(long,{source:'media',start_sec:50,end_sec:51})[0].time_sec,111);
   assert.equal(filterScenes([{scene_id:'image',track:'media',static:true,start_sec:0,end_sec:0}],{start_sec:0,end_sec:1}).length,1);
 });
 const library=projectScenes(p,new Map([['m',index]]),{scope:'media'});check('library scenes exist before insertion',()=>assert.equal(library.length,2));
 const store=new frames.AgentFrames(async()=>{throw new Error('Not needed');});
 try{
  const inspected=await store.inspect(1,{project:p,source:'media',media_id:'m',source_times_sec:[1],revision:'r'},undefined);const id=inspected.frames[0].id;
  check('library frames decode at explicit source time without timeline edits',()=>{assert.equal(inspected.frames[0].source_time_sec,1);assert.equal(inspected.frames[0].media_id,'m');assert.ok(inspected.frames[0].fingerprint);assert.equal(inspected.frames[0].path,undefined);});
  assert.throws(()=>store.evidence(1,[id],'run'),/present/);store.images(1,[id]);assert.throws(()=>store.evidence(1,[id],'run'),/present/);store.markPresented(1,[id],'run','test','vision');const evidence=store.evidence(1,[id],'run');assert.throws(()=>store.evidence(2,[id],'run'),/present/);
  check('scene evidence requires owner and actual presentation',()=>assert.equal(evidence[0].presentedProvider,'test'));
  cache.annotate(index.analysis_id,index.shots[0].id,{description:'A blue frame',tags:['blue'],evidence:evidence.map(f=>({source_time_sec:f.source_time_sec,image_hash:f.image_hash})),provider:'test',model:'vision'});
  const annotated=await cache.analyze(media);const notes=projectScenes(p,new Map([['m',annotated]]));check('observed source descriptions are searchable across occurrences',()=>assert.equal(filterScenes(notes,{query:'blue'}).length,2));
  const samples=storyboardSamples(notes,{source:'media',interval_sec:.5});assert.ok(samples.length>6);check('long shot samples support paged bounded captures',()=>assert.ok(samples.every(s=>s.time_sec>=0&&s.time_sec<4)));
  let state={past:[],future:[],present:p};
  const runner=createToolRunner({getProject:()=>state.present,dispatch:a=>{state=historyReducer(state,a);},settle:async()=>{},requestId:'run',api:{
    agentAnalyzeScenes:async req=>({analyses:await Promise.all(req.media_ids.map(async media_id=>({media_id,...await cache.analyze(media)})))}),
    agentInspectFrames:req=>store.inspect(1,req),
  }});
  const page=await runner.run('analyze_scenes',{limit:1});check('agent scene metadata pages live occurrences',()=>{assert.equal(page.scenes.length,1);assert.equal(page.next_offset,1);});
  const board=await runner.run('get_storyboard',{scope:'media',source:'media',limit:2,interval_sec:.5});check('agent storyboard returns only bounded handles',()=>{assert.equal(board.frames.length,2);assert.equal(board.next_offset,2);assert.ok(!JSON.stringify(board).includes('base64'));assert.ok(!JSON.stringify(board).includes(source));});
 } finally {store.dispose();}
 await assert.rejects(cache.analyze(media,{},AbortSignal.abort()),{name:'AbortError'});checks.push('canceled analyses do not return cached success');
 const stat=fs.statSync(source);fs.utimesSync(source,stat.atime,new Date(stat.mtimeMs+5000));const changed=await cache.analyze(media);check('source replacement invalidates shots and observations',()=>{assert.notEqual(changed.fingerprint,index.fingerprint);assert.ok(changed.shots.every(s=>!s.observation));});
 fs.writeFileSync(cache.file(changed.analysis_id),'{}');assert.equal((await cache.analyze(media)).cached,false);checks.push('corrupt cache recomputes instead of inventing results');
 if(process.env.AGENT_SCENE_EVIDENCE)fs.writeFileSync(process.env.AGENT_SCENE_EVIDENCE,JSON.stringify({ok:true,checks},null,2));console.log(`agent scenes ok (${checks.length} checks; real detection, live mapping, source evidence, cache and paging)`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
