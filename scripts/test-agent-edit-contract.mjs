import assert from 'node:assert/strict';
import { emptyProject, historyReducer, exportDuration } from '../src/store.js';
import { createToolRunner } from '../src/agent/tools.js';
import { runAgent } from '../src/agent/runAgent.js';
import { validateAgentProject } from '../src/agent/validation.js';
const base=()=>({...emptyProject(),media:[{id:'m',name:'talk',type:'video',duration:20,width:100,height:100}],videoClips:[{id:'v',mediaId:'m',in:0,out:10,speed:1}]});
function fixture(p=base(),api={}) {let s={past:[],future:[],present:p};const ctx={getProject:()=>s.present,dispatch:a=>{s=historyReducer(s,a);},settle:async()=>{},api};return {ctx,runner:createToolRunner(ctx),state:()=>s};}
{
 const p=base();p.layerState={'video:0':{locked:true}};const f=fixture(p);const r=await f.runner.run('cut_range',{start_sec:2,end_sec:4});assert.ok(r.error);assert.equal(r.changed,false);assert.equal(exportDuration(f.state().present),10);
}
{
 const f=fixture();for(const ranges of [[{start_sec:8,end_sec:2}],[{start_sec:11,end_sec:12}],[{start_sec:-1,end_sec:2}],[{start_sec:5,end_sec:5.0001}],[]]){const r=await f.runner.run('keep_ranges',{ranges});assert.ok(r.error);assert.equal(exportDuration(f.state().present),10);}
 const r=await f.runner.run('set_speed',{clip_id:'v',speed:1});assert.equal(r.changed,false);assert.equal(r.status,'unchanged');
}
{
 const p=base();p.audioClips=[{id:'a',mediaId:'m',in:0,out:10,start:0,speed:2}];const f=fixture(p);const r=await f.runner.run('trim_clip',{clip_id:'a',end_sec:4});assert.ok(!r.error);assert.equal(f.state().present.audioClips[0].out,8);
}
{
 let f;const api={agentSilences:async()=>{f.ctx.dispatch({type:'update',track:'video',id:'v',patch:{speed:2}});return {ok:true,silences:[{start:2,end:4}]};}};f=fixture(base(),api);const r=await f.runner.run('remove_silences',{keep_padding_sec:0});assert.match(r.error,/changed/);assert.equal(r.changed,false);assert.equal(f.state().present.videoClips.length,1);
}
{
 const f=fixture();let editor={playhead_sec:2,selection:{track:'video',id:'v'}};f.ctx.getEditorState=()=>editor;const runner=createToolRunner(f.ctx);const first=await runner.run('get_project',{});assert.equal(first.editor.playhead_sec,2);editor={playhead_sec:4,selection:null};const next=await runner.run('get_project',{if_revision:first.revision});assert.equal(next.unchanged,true);assert.equal(next.editor.playhead_sec,4);
}
{
 const f=fixture();f.ctx.api.agentStep=async()=>{f.ctx.dispatch({type:'setProject',patch:{name:'manual'}});return {ok:true,provider:'codex-sdk',calls:[{name:'set_project',args:{name:'stale'}}],content:{role:'model',parts:[]}};};const r=await runAgent({ctx:f.ctx,contents:[],onEvent:()=>{},isCanceled:()=>false});assert.match(r.error.error,/changed/);assert.equal(f.state().present.name,'manual');assert.equal(r.changed,false);
}
{
 const p=base();p.videoClips.push({...p.videoClips[0]});assert.equal(validateAgentProject(p).ok,false);
}
{
 const f=fixture();const runner=createToolRunner({...f.ctx,dispatch:()=>{}});const r=await runner.run('cut_range',{start_sec:2,end_sec:4});assert.ok(r.error,'ignored reducer action is not success');assert.equal(r.changed,false);
}
{
 const p=base();p.videoClips[0]={...p.videoClips[0],muted:true,linkId:'pair'};p.audioClips=[{id:'a',mediaId:'m',in:0,out:10,start:0,speed:1,linkId:'pair',linkOff:0,linkInOff:0}];p.layerState={'audio:0':{locked:true}};
 const f=fixture(p);const r=await f.runner.run('set_speed',{clip_id:'v',speed:2});assert.ok(r.error);assert.equal(f.state().present.videoClips[0].speed,1);assert.equal(f.state().present.audioClips[0].speed,1);
}
{
 const f=fixture({...base(),videoClips:[{...base().videoClips[0],speed:1.3}]});const read=await f.runner.run('get_project',{});const kept=await f.runner.run('keep_ranges',{ranges:[{start_sec:3,end_sec:read.duration_sec}]});assert.ok(!kept.error,JSON.stringify(kept));
}
{
 const p=base();p.videoClips[0]={...p.videoClips[0],speed:2,linkId:'legacy'};p.audioClips=[{id:'a',mediaId:'m',in:0,out:10,start:0,speed:1,linkId:'legacy'}];const f=fixture();f.ctx.dispatch({type:'load',project:p});assert.equal(f.state().present.videoClips[0].speed,2);const renamed=await f.runner.run('set_project',{name:'Legacy opened'});assert.ok(!renamed.error);assert.equal(f.state().present.name,'Legacy opened');
}
console.log('agent edit contract ok (blocked/no-op results, range safety, audio speed, stale results, live editor context, structural validation)');
