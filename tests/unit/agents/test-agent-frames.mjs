import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import frames from "../../../electron/agents/agentFrames.cjs";
import ff from "../../../electron/media/ffmpeg.cjs";
import {emptyProject} from "../../../src/state/store.js";
import {runAgent} from "../../../src/features/agent/runAgent.js";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-frame-test-'));
const source=path.join(dir,'source.mp4');
execFileSync(ff.ffmpegPath,['-y','-v','error','-f','lavfi','-i','color=blue:s=320x180:r=10:d=4','-pix_fmt','yuv420p',source]);
const p={...emptyProject(),width:180,height:320,media:[{id:'m',path:source,type:'video',width:320,height:180,duration:4}],
  videoClips:[{id:'c',mediaId:'m',in:1,out:4,speed:2}]};
const store=new frames.AgentFrames(async()=>{throw new Error('Not used');});
try{
  let plan=await frames.planFrames(p,'clip','c',[0.25,1]);
  assert.deepEqual(plan.map(f=>f.source_time_sec),[1.5,3]);
  assert.deepEqual([plan[0].width,plan[0].height],[320,180]);
  const inspected=await store.inspect(1,{project:p,source:'clip',clip_id:'c',times_sec:[0.25,1],revision:'r1'});
  assert.equal(inspected.frames.length,2);assert.equal(inspected.frames[1].source_time_sec,3);
  assert.equal(inspected.frames[0].path,undefined,'tool output contains handles rather than host paths or image bytes');
  const images=store.images(1,inspected.frames.map(f=>f.id));
  assert.ok(images.every(f=>fs.existsSync(f.path)&&fs.readFileSync(f.path)[0]===255));
  assert.throws(()=>store.images(2,[inspected.frames[0].id]),/expired/,'another renderer cannot retrieve frame files');
  for(const times of [[],Array(7).fill(0),[-1],[NaN],[1.5]])await assert.rejects(frames.planFrames(p,'timeline',null,times));
  await assert.rejects(frames.planFrames(p,'clip','invented',[0]),/clip_id/);
  await assert.rejects(store.inspect(1,{project:p,source:'clip',clip_id:'c',times_sec:[0]},AbortSignal.abort()),{name:'AbortError'});
  store.clearOwner(1);assert.ok(images.every(f=>!fs.existsSync(f.path)));
  assert.throws(()=>store.images(1,[inspected.frames[0].id]),/expired/);

  let step=0;const requests=[];
  const turns=[[{name:'load_tools',args:{groups:['media']}}],[{name:'inspect_frames',args:{times_sec:[0.25]}}],[]];
  const ctx={provider:'ollama',getProject:()=>p,dispatch:()=>assert.fail('inspection must not edit the project'),settle:async()=>{},api:{
    agentInspectFrames:async req=>{assert.equal(req.requestId,'vision');assert.equal(req.project.craftAI,undefined);return {frames:[{id:'frame-handle',time_sec:0.25}],revision:'r'};},
    agentStep:async req=>{requests.push(req);const calls=turns[step++];return {ok:true,provider:'ollama',calls,text:'Looked.',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};},
  }};
  const result=await runAgent({ctx,contents:[{role:'user',parts:[{text:'Look at this scene'}]}],onEvent:()=>{},isCanceled:()=>false,requestId:'vision'});
  assert.equal(result.changed,false);assert.deepEqual(requests[2].frameIds,['frame-handle']);
  assert.equal(requests[0].frameIds,undefined);
  const apiContext={...ctx,provider:'ollama',api:{agentStep:async req=>{assert.ok(req.tools.some(t=>t.name==='load_tools'));return {ok:true,calls:[],text:'Done',content:{role:'model',parts:[]}};}}};
  await runAgent({ctx:apiContext,contents:[],onEvent:()=>{},isCanceled:()=>false});
  console.log('agent frames ok (real decoding, source time mapping, limits, owner boundaries, cleanup, read-only tools, image handoff, provider gating)');
}finally{store.dispose();fs.rmSync(dir,{recursive:true,force:true});}
