import assert from 'node:assert/strict';
import { emptyProject, historyReducer, exportDuration } from "../../../src/state/store.js";
import { createToolRunner } from "../../../src/features/agent/tools.js";
import { runAgent } from "../../../src/features/agent/runAgent.js";
import { validateAgentProject } from "../../../src/features/agent/validation.js";
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
{
 const f=fixture();f.ctx.dispatch({type:'beginAgentEdit',token:'same'});const original=f.state();f.ctx.dispatch({type:'update',track:'video',id:'v',patch:{speed:1},agentToken:'same'});assert.equal(f.state(),original);f.ctx.dispatch({type:'endAgentEdit',token:'same'});assert.equal(f.state().past.length,0,'unchanged values create no Undo entry');
}
{
 const p=base();p.videoClips[0].keyframes={scale:[{t:1,v:1.3}]};p.videoClips[0].chroma={on:true,color:'#00ff00'};const f=fixture(p);
 const read=await f.runner.run('get_project',{clip_ids:['v']});assert.deepEqual(read.clip_details[0].fields.keyframes,p.videoClips[0].keyframes);assert.deepEqual(read.clip_details[0].fields.chroma,p.videoClips[0].chroma);
 p.media.push({...p.media[0],id:'duplicate'});const runner=createToolRunner(f.ctx);assert.match((await runner.run('add_media',{media_name:'talk'})).error,/ambiguous/);
}
console.log('agent edit contract ok (blocked/no-op results, range safety, audio speed, stale results, live editor context, structural validation)');

// A background/late UI callback that changes no document data must not revoke
// an active request. Real manual edits still create a separate checkpoint.
{
 const f=fixture();f.ctx.dispatch({type:'beginAgentEdit',token:'no-op-owner'});
 f.ctx.dispatch({type:'setProject',patch:{name:'Agent title'},agentToken:'no-op-owner'});
 for(const action of [
  {type:'setProject',patch:{name:'Agent title'},transient:true},
  {type:'update',track:'video',id:'v',patch:{speed:1}},
  {type:'delete',track:'video',id:'missing'},
  {type:'endGesture'},
  {type:'late-ui-callback'},
  {type:'addMedia',items:[]},
 ]) {
  const before=f.state();f.ctx.dispatch(action);
  assert.equal(f.state().agentEdit?.token,'no-op-owner',`${action.type} cannot interrupt a request when it changes nothing`);
  assert.equal(f.state().present,before.present);
  assert.equal(f.state().past.length,0);
 }
 f.ctx.dispatch({type:'setLayerState',track:'video',layer:0,patch:{locked:true}});
 f.ctx.dispatch({type:'update',track:'video',id:'v',patch:{speed:2}});
 assert.equal(f.state().agentEdit.token,'no-op-owner','a locked/rejected edit cannot interrupt the request');
 f.ctx.dispatch({type:'setLayerState',track:'video',layer:0,patch:{locked:false}});
 f.ctx.dispatch({type:'setProject',patch:{name:'Actual manual edit'}});
 assert.equal(f.state().agentEdit,undefined);
 assert.equal(f.state().agentInterruption.action,'setProject');assert.deepEqual(f.state().agentInterruption.fields,['name']);
 f.ctx.dispatch({type:'setProject',patch:{name:'Late agent write'},agentToken:'no-op-owner'});
 assert.equal(f.state().present.name,'Actual manual edit');
 f.ctx.dispatch({type:'undo'});assert.equal(f.state().present.name,'Agent title');
 f.ctx.dispatch({type:'undo'});assert.equal(f.state().present.name,'Untitled');
}
{
 const f=fixture();f.ctx.dispatch({type:'beginAgentEdit',token:'undo-owner'});
 f.ctx.dispatch({type:'setProject',patch:{name:'Agent edit'},agentToken:'undo-owner'});
 f.ctx.dispatch({type:'undo'});assert.equal(f.state().agentEdit,undefined);
 assert.equal(f.state().agentInterruption.action,'undo');assert.equal(f.state().present.name,'Untitled');
}
// Pressing on a clip begins a gesture before the timeline knows whether it is a drag or a selection.
// A selection (press and release, nothing moved) must not end the request; a real drag still does,
// at its first change; agent edits made while the press is held stay in the agent's Undo step.
{
 const f=fixture();f.ctx.dispatch({type:'beginAgentEdit',token:'select-owner'});
 f.ctx.dispatch({type:'setProject',patch:{name:'Agent first'},agentToken:'select-owner'});
 f.ctx.dispatch({type:'beginGesture'});
 assert.equal(f.state().agentEdit?.token,'select-owner','pressing on a clip does not interrupt the request');
 f.ctx.dispatch({type:'setProject',patch:{name:'Agent while held'},agentToken:'select-owner'});
 assert.equal(f.state().gestureStart,f.state().present,'the held gesture starts from the agent result');
 f.ctx.dispatch({type:'endGesture'});
 assert.equal(f.state().agentEdit?.token,'select-owner','a selection (press and release) leaves the request running');
 assert.equal(f.state().agentInterruption,undefined);assert.equal(f.state().past.length,0,'no manual Undo step for a click');
 f.ctx.dispatch({type:'endAgentEdit',token:'select-owner'});
 assert.equal(f.state().past.length,1);f.ctx.dispatch({type:'undo'});assert.equal(f.state().present.name,'Untitled','one Undo removes all the agent work');
}
{
 const f=fixture();f.ctx.dispatch({type:'beginAgentEdit',token:'drag-owner'});
 f.ctx.dispatch({type:'setProject',patch:{name:'Agent title'},agentToken:'drag-owner'});
 f.ctx.dispatch({type:'beginGesture'});
 f.ctx.dispatch({type:'update',track:'video',id:'v',patch:{out:8},transient:true});
 assert.equal(f.state().agentEdit,undefined,'a drag that changes the timeline ends the request');
 assert.equal(f.state().agentInterruption.action,'update','reported as the change, not the press');
 f.ctx.dispatch({type:'endGesture'});
 f.ctx.dispatch({type:'undo'});assert.equal(f.state().present.videoClips[0].out,10);assert.equal(f.state().present.name,'Agent title','Undo removes the drag first');
 f.ctx.dispatch({type:'undo'});assert.equal(f.state().present.name,'Untitled','then the agent work');
}
console.log('agent edit contract: selections never interrupt a request; real drags do');
