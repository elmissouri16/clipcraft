import assert from 'node:assert/strict';
import { emptyProject, historyReducer, videoLayout, exportDuration, retimeTransition } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { validateAgentProject } from '../../../src/features/agent/validation.js';
import { changedVisualRegions, updateVisualRequirements, markVisualCoverage } from '../../../src/features/agent/visualVerification.js';
import { audioGain } from '../../../src/features/audio/fades.js';
import { runNativeAgent } from '../../../src/features/agent/runNativeAgent.js';

const base = () => ({ ...emptyProject(), media: [
  { id:'m', name:'video.mp4', type:'video', path:'/fixture/video.mp4', duration:20, width:320, height:180, hasAudio:true },
  { id:'s', name:'still.png', type:'image', path:'/fixture/still.png', width:320, height:180 },
], videoClips:[{ id:'v', mediaId:'m', in:0, out:5, speed:1 }] });
function fixture(p=base()) {
  let state={past:[],future:[],present:p};
  const ctx={provider:'codex-sdk',getProject:()=>state.present,dispatch:a=>{state=historyReducer(state,a);},settle:async()=>{},api:{}};
  return {ctx,runner:createToolRunner(ctx),get p(){return state.present;},get state(){return state;}};
}
const pair = () => {
  const p=base(); p.videoClips[0]={...p.videoClips[0],muted:true,linkId:'pair'};
  p.audioClips=[{id:'a',mediaId:'m',start:0,in:0,out:5,speed:1,linkId:'pair',linkOff:0,linkInOff:0,fadeIn:1,fadeOut:1}]; return p;
};
for (const id of ['v','a']) {
  const f=fixture(pair()),result=await f.runner.run('clip_tools',{clip_id:id,action:'duplicate'});
  assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(validateAgentProject(f.p).ok,true);
  assert.equal(f.p.videoClips.length,2); assert.equal(f.p.audioClips.length,2);
  assert.equal(f.p.audioClips.find(c=>c.id==='a').start,0);
  assert.deepEqual(f.p.audioClips.map(c=>c.start),[0,5]);
  assert.notEqual(f.p.videoClips[0].linkId,f.p.videoClips[1].linkId);
  f.ctx.dispatch({type:'undo'}); assert.equal(f.p.videoClips.length,1);assert.equal(f.p.audioClips.length,1);
}
{
  const p=pair();p.layerState={'audio:0':{locked:true}};
  const f=fixture(p);assert.ok((await f.runner.run('clip_tools',{clip_id:'v',action:'duplicate'})).error);assert.equal(f.p,p);
}
{
  // Bad source edits are rejected by the same preflight used by tools.
  const g=fixture();const bad=await g.runner.run('trim_clip',{clip_id:'v',end_sec:30});
  assert.ok(bad.error);assert.equal(g.state.past.length,0);assert.equal(g.p.videoClips[0].out,5);
}
for (const empty of [false,true]) {
  const p=base();if(empty)p.videoClips=[];
  const f=fixture(p),r=await f.runner.run('add_text',{text:'Visible at the end',start_sec:6,duration_sec:2});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(exportDuration(f.p),8);assert.equal(validateAgentProject(f.p).ok,true);
  assert.ok(f.p.videoClips.at(-1).gap);
}
{
  const f=fixture();const r=await f.runner.run('add_media',{media_id:'s',as:'overlay',start_sec:4});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(exportDuration(f.p),8);
  const p=base();p.textClips=[{id:'bad',text:'Lost',start:6,duration:2}];assert.equal(validateAgentProject(p).ok,false);
}
{
  const p=base();p.layerState={'video:0':{locked:true}};const f=fixture(p);
  const r=await f.runner.run('add_text',{text:'Outside',start_sec:6,duration_sec:2});
  assert.ok(r.error);assert.equal(f.p.textClips.length,0);assert.equal(exportDuration(f.p),5);
}
{
  const p=base();p.videoClips[0].out=10;
  p.textClips=[{id:'cap',caption:true,text:'hello world',start:2,duration:4,words:[
    {text:'hello',start:0,end:2,timing:'measured'},{text:'world',start:2,end:4,timing:'measured'},
  ]}];
  const f=fixture(p);assert.equal((await f.runner.run('trim_clip',{clip_id:'cap',start_sec:4,end_sec:6})).ok,true);
  assert.deepEqual(f.p.textClips[0].words,[{text:'world',start:0,end:2,timing:'measured'}]);assert.equal(f.p.textClips[0].text,'world');
  assert.equal((await f.runner.run('edit_text',{clip_id:'cap',duration_sec:1})).ok,true);
  assert.equal(f.p.textClips[0].words[0].end,1);assert.equal(f.p.textClips[0].words[0].timing,'estimated');
  assert.equal((await f.runner.run('edit_text',{clip_id:'cap',text:'Changed wording'})).ok,true);
  assert.equal(f.p.textClips[0].words,undefined);assert.equal(validateAgentProject(f.p).ok,true);
  const invalid=structuredClone(p);invalid.textClips[0].words[1].end=8;assert.equal(validateAgentProject(invalid).ok,false);
}
for (const time of [.5,2.5,4.5]) {
  const p=pair(),f=fixture(p);assert.equal((await f.runner.run('split_at',{time_sec:time})).ok,true);
  for(let t=.05;t<5;t+=.05){const c=f.p.audioClips.find(a=>t>=a.start&&t<a.start+(a.out-a.in));assert.ok(c);assert.ok(Math.abs(audioGain(c,t-c.start,c.out-c.in)-audioGain(p.audioClips[0],t,5))<1e-6);}
  assert.equal(validateAgentProject(f.p).ok,true);
}
{
  const p=base();p.videoClips.push({id:'second',mediaId:'m',in:5,out:10,speed:1});
  p.audioClips=[{id:'voice',mediaId:'m',start:0,in:0,out:10,speed:1}];
  p.textClips=[{id:'cap',text:'Second scene',start:7,duration:1}];p.markers=[{id:'mark',time:7}];
  const f=fixture(p),r=await f.runner.run('add_transition',{clip_id:'second',type:'fade',duration_sec:1});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(exportDuration(f.p),9);assert.equal(f.p.textClips[0].start,6);
  assert.equal(f.p.markers[0].time,6);assert.deepEqual(f.p.audioClips.map(c=>[c.start,c.in,c.out,c.speed]),[[0,0,5,1.25],[4,5,10,1]]);
  assert.equal(validateAgentProject(f.p).ok,true);assert.ok(Math.abs(r.time_map.delta_sec+1)<1e-6);
  const locked=structuredClone(p);locked.layerState={'audio:0':{locked:true}};
  assert.ok(retimeTransition(locked,'second',{type:'fade',duration:1}).error);
  const restore=await f.runner.run('add_transition',{clip_id:'second',type:'none'});assert.equal(restore.ok,true,JSON.stringify(restore));
  assert.equal(exportDuration(f.p),10);assert.equal(f.p.textClips[0].start,7);
}
{
  const p=base(),next=structuredClone(p);next.media.push({id:'unused',type:'image',path:'/unused.png'});
  assert.deepEqual(changedVisualRegions(p,next),[]);
  next.textClips=[{id:'title',text:'Title',start:1,duration:1}];let regions=changedVisualRegions(p,next);
  markVisualCoverage(regions,[{source:'timeline',time_sec:1.5}]);assert.ok(regions.every(r=>r.checked));
  const audio=structuredClone(next);audio.videoClips[0].volume=.4;
  regions=updateVisualRequirements(p,next,audio,regions);assert.ok(regions.every(r=>r.checked));
  const changed=structuredClone(audio);changed.textClips[0].text='Different';
  assert.ok(updateVisualRequirements(p,audio,changed,regions).some(r=>!r.checked));
  const source=structuredClone(p);source.media[0].path='/replaced.mp4';assert.ok(changedVisualRegions(p,source).length);
}
{
  const p=base();p.overlayClips=[{id:'o',mediaId:'m',start:0,in:0,out:5,speed:1}];const f=fixture(p);
  for(const [name,args] of [['set_filter',{filter_id:'none'}],['set_effects',{effect_ids:[]}],['set_volume',{volume:.3,fade_in_sec:1,fade_out_sec:1}]]) assert.equal((await f.runner.run(name,{clip_id:'o',...args})).ok,true,name);
  assert.equal(f.p.overlayClips[0].volume,.3);assert.equal(f.p.overlayClips[0].fadeIn,1);
}
// The native host must preserve visual coverage after an audio-only operation,
// and cannot finalize a title outside the actual output timeline.
{
  const f=fixture(),captures=[];let listener;const pending=new Map();let serial=0;
  const invoke=(name,args={})=>new Promise(resolve=>{const callId=String(serial++);pending.set(callId,resolve);listener({requestId:'audit',callId,name,args});});
  Object.assign(f.ctx.api,{mcpTools:async()=>({tools:[]}),onAgentNativeTool:cb=>{listener=cb;return()=>{};},
    agentNativeToolResult:async({callId,result})=>{pending.get(callId)(result);pending.delete(callId);},
    agentInspectFrames:async req=>{captures.push(req.times_sec);return{revision:req.revision,frames:req.times_sec.map(time_sec=>({id:'frame-'+time_sec,source:'timeline',time_sec}))};},
    agentRunNative:async()=>{await invoke('add_text',{text:'Export this title',start_sec:6,duration_sec:2});let done;while(!(done=await invoke('complete_edit')).ready){}assert.equal(exportDuration(f.p),8);
      await invoke('set_volume',{clip_id:'v',volume:.4});assert.equal((await invoke('complete_edit')).ready,true);return{ok:true,text:'Done'};},
  });
  const result=await runNativeAgent({contents:[{role:'user',parts:[{text:'Regression edit'}]}],ctx:f.ctx,onEvent:()=>{},isCanceled:()=>false,requestId:'audit',sessionKey:'audit'});
  assert.ok(!result.error,JSON.stringify(result));assert.equal(captures.length,1);
}
console.log('editing engine regressions passed: pairs, split envelopes, export bounds, caption timing, transition clocks, coverage, overlay tools and native completion');
