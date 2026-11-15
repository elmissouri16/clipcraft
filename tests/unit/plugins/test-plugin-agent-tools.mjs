import {pluginEditsApplied} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {emptyProject,historyReducer} from '../../../src/state/store.js';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
import {validateToolCall} from '../../../shared/toolArguments.mjs';
import {createToolRunner} from '../../../src/features/agent/tools.js';
import {nativeTools} from '../../../src/features/agent/runNativeAgent.js';
import {externalTools} from '../../../src/features/agent/externalHost.js';
import {createToolHost} from '../../../src/features/agent/toolHost.js';
import {makeAgentCtx} from '../../../src/features/agent/agentCtx.js';
import {describeToolActivity} from '../../../src/features/agent/toolActivity.js';
const require=createRequire(import.meta.url),{wireTools}=require('../../../electron/agents/contract.cjs');
const manifest=validateManifest(JSON.parse(fs.readFileSync(new URL('../../../examples/plugins/chapter-markers/plugin.json',import.meta.url))));
const key='a'.repeat(64),command_id='add-chapter-markers',args={key,command_id,input:[{id:'count',value:3}]};
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
function fixture(editorPermission=false){
 const fixtureManifest=editorPermission==='edits'?{...manifest,permissions:['editor.read','clips.write']}:editorPermission?{...manifest,permissions:[...manifest.permissions,'editor.read']}:manifest;
 let state={past:[],present:{...emptyProject(),id:'agent-plugin-test',videoClips:[{id:'gap',gap:true,in:0,out:10}],textClips:editorPermission==='edits'?[{id:'editable',start:1,duration:2,layer:0,text:'Keep content'}]:[],markers:[]},future:[]};
 state=historyReducer(state,{type:'beginAgentEdit',token:'owner'});
 let stopped=false,enabled=true,mode='normal',pending,progress;
 const requests=[],events=[];
 const api={
  pluginsList:async()=>[{key,enabled,manifest:fixtureManifest},{key:'b'.repeat(64),enabled:false,manifest},{key:'c'.repeat(64),enabled:false,error:'bad'}],
  onPluginCommandProgress:fn=>{progress=fn;return()=>{progress=null;};},
  pluginsCancelCommand:async id=>{requests.push({cancel:id});pending?.({status:'canceled'});},
  pluginsAuthorizeClipEdits:async()=>mode!=='revoke',
  pluginsRunCommand:async request=>{
   requests.push(request);progress?.({runId:request.runId,phase:'running',progress:.5,message:'Preparing markers'});
   if(mode==='pending')return new Promise(resolve=>{pending=resolve;});
   if(mode==='denied')return {status:'denied'};
   if(mode==='failure')return {status:'failed',error:'Fixture failure'};
   if(editorPermission==='edits'){const clip=request.editor.timeline.clips.find(c=>c.trackId==='text:0');return {status:'completed',key,markers:[],editCommit:'fixture-commit',edits:{documentId:request.editor.documentId,revision:request.editor.revision,operations:[{type:'move',clipId:clip.id,start_sec:6}]}};}
   const markers=Array.from({length:request.input.count},(_,i)=>({time:i*10/request.input.count,label:'Chapter '+(i+1)}));
   if(mode==='invalid')markers.push({time:11,label:'bad'});
   if(mode==='stale')state=historyReducer(state,{type:'setProject',patch:{name:'User edit'}});
   if(mode==='metadata')state=historyReducer(state,{type:'craftChat',projectId:state.present.id,chat:{fixture:true}});
   return {status:'completed',key:mode==='wrong-key'?'b'.repeat(64):key,markers,message:'Untrusted claim of 999 edits'};
  },
 };
 globalThis.window={api};
 const dispatch=a=>{state=historyReducer(state,a);};
 const readEditor=createEditorContext();
 const ctx=makeAgentCtx({app:{pluginEditApplied:action=>pluginEditsApplied(state,action),getPluginEditContext:()=>{const snapshot=readEditor(state.present,null,{time_sec:3,playing:false});return {snapshot,targets:readEditor.targets(snapshot)};},getPluginEditorContext:()=>readEditor(state.present,null,{time_sec:3,playing:false}),getAgentEdit:()=>state.agentEdit,pluginCommandReady:()=>true},provider:'codex-sdk',getProject:()=>state.present,dispatch,settle:async()=>{},requestId:'owner',isCurrent:()=>true,isStopped:()=>stopped,allowPluginCommands:true});
 const runner=createToolRunner({...ctx,isCanceled:()=>stopped,onToolProgress:e=>events.push(e)});
 return {runner,ctx,api,requests,events,get state(){return state;},dispatch,set mode(v){mode=v;},set enabled(v){enabled=v;},stop:()=>{stopped=true;},get progress(){return progress;}};
}
const discover=f=>f.runner.run('list_plugin_commands',{});
await check('all CraftAI native providers expose the same portable command tools; external clients do not',()=>{
 for(const provider of ['codex-sdk','claude-agent-sdk','opencode-sdk']){
  const declarations=nativeTools(provider).tools;
  for(const name of ['list_plugin_commands','run_plugin_command'])assert.ok(declarations.some(t=>t.name===name));
  const wire=wireTools(declarations).tools.find(t=>t.name==='run_plugin_command');assert.equal(wire.parameters.properties.input.items.properties.value.type,'number');
  assert.ok(!externalTools(provider).tools.some(t=>['list_plugin_commands','run_plugin_command'].includes(t.name)));
 }
 const tools=nativeTools('codex-sdk').tools;
 assert.equal(validateToolCall({name:'run_plugin_command',args},tools),null);
 assert.match(validateToolCall({name:'run_plugin_command',args:{...args,input:[{id:'count',value:'three'}]}},tools),/number/);
});
await check('discovery exposes only enabled commands and bounded public metadata',async()=>{
 const f=fixture(),r=await discover(f);assert.equal(r.total,1);assert.equal(r.commands[0].key,key);assert.equal(r.commands[0].publisher_verified,false);assert.ok(r.metadata_is_untrusted);assert.ok(!JSON.stringify(r).includes('commands.js'));assert.equal(f.requests.length,0);
 assert.ok((await f.runner.run('list_plugin_commands',{limit:51})).error);
 assert.equal((await f.runner.run('list_plugin_commands',{query:'unmatched'})).total,0);
});
await check('undiscovered and invalid inputs fail without native approval',async()=>{
 const f=fixture();assert.match((await f.runner.run('run_plugin_command',args)).error,/Discover/);await discover(f);
 for(const input of [[{id:'count',value:1.5}],[{id:'count',value:101}],[{id:'unknown',value:3}],[{id:'count',value:2},{id:'count',value:3}]])assert.ok((await f.runner.run('run_plugin_command',{...args,input})).error);
 assert.equal(f.requests.length,0);assert.equal(f.state.present.markers.length,0);
});
await check('agent markers use the edit token, actual counts, progress, one Undo and Redo',async()=>{
 const f=fixture();await discover(f);const r=await f.runner.run('run_plugin_command',args);assert.ok(!r.error,r.error);assert.ok(r.changed);assert.equal(r.markers_added,3);assert.equal(r.untrusted_plugin_response,'Untrusted claim of 999 edits');assert.equal(f.state.agentEdit.steps.length,1);assert.equal(f.state.past.length,0);assert.equal(f.events[0].progress,.5);assert.equal(f.progress,null);
 f.dispatch({type:'endAgentEdit',token:'owner'});assert.equal(f.state.past.length,1);f.dispatch({type:'undo'});assert.equal(f.state.present.markers.length,0);f.dispatch({type:'redo'});assert.equal(f.state.present.markers.length,3);
});
await check('default values apply; repeated runs accurately skip duplicates',async()=>{
 const f=fixture();await discover(f);const first=await f.runner.run('run_plugin_command',{key,command_id});assert.equal(first.markers_added,5);const r=await f.runner.run('run_plugin_command',{key,command_id});assert.equal(r.markers_added,0);assert.equal(r.changed,false);assert.equal(f.state.agentEdit.steps.length,1);
});
await check('chat persistence does not cancel a document-stable command',async()=>{
 const f=fixture();await discover(f);f.mode='metadata';const r=await f.runner.run('run_plugin_command',args);assert.ok(!r.error,r.error);assert.equal(r.markers_added,3);
});
await check('declining is final for this request and creates no edit/failure debt',async()=>{
 const f=fixture();await discover(f);f.mode='denied';const r=await f.runner.run('run_plugin_command',args);assert.ok(r.permission_denied&&r.not_applicable);assert.equal(r.changed,false);f.mode='normal';assert.ok((await f.runner.run('run_plugin_command',args)).permission_denied);assert.equal(f.requests.length,1);assert.equal(f.state.agentEdit.steps.length,0);
});
await check('disabled packages, wrong keys, runtime errors and invalid proposals never apply',async()=>{
 for(const mode of ['disabled','wrong-key','failure','invalid']){const f=fixture();await discover(f);if(mode==='disabled')f.enabled=false;else f.mode=mode;const r=await f.runner.run('run_plugin_command',args);assert.ok(r.error,mode);assert.equal(f.state.present.markers.length,0);assert.equal(f.state.agentEdit.steps.length,0);}
});
await check('manual interruption and cancellation discard staged results',async()=>{
 const f=fixture();await discover(f);f.mode='stale';const stale=await f.runner.run('run_plugin_command',args);assert.ok(stale.error);assert.equal(f.state.present.markers.length,0);assert.equal(f.state.present.name,'User edit');
 const g=fixture();await discover(g);g.mode='pending';const running=g.runner.run('run_plugin_command',args);while(!g.requests.length)await new Promise(r=>setTimeout(r,2));g.stop();const canceled=await running;assert.ok(canceled.canceled);assert.ok(g.requests.some(r=>r.cancel));assert.equal(g.state.present.markers.length,0);assert.equal(g.progress,null);
});
await check('reducer refuses foreign owners and queued stale bases',()=>{
 const f=fixture(),base=f.state.present,action={type:'pluginMarkers',base,markers:[{time:0,label:'x'}],ids:['x']};
 for(const agentToken of ['other',undefined]){f.dispatch({...action,agentToken});assert.equal(f.state.present,base);}
 f.dispatch({...action,base:{...base,name:'Stale document'},agentToken:'owner'});assert.equal(f.state.present,base);
 f.dispatch({type:'craftChat',projectId:base.id,chat:{fixture:true}});f.dispatch({...action,agentToken:'owner'});assert.equal(f.state.present.markers.length,1);assert.ok(f.state.present.craftAI.fixture);
});
await check('only the explicitly enabled CraftAI context can use the bridge',async()=>{
 const f=fixture();const runner=createToolRunner({...f.ctx,allowPluginCommands:false});assert.match((await runner.run('list_plugin_commands',{})).error,/CraftAI/);assert.equal(f.requests.length,0);
});
await check('native completion validates applied edits and reports truthful activity',async()=>{
 const f=fixture(),contents=[],events=[],declarations=nativeTools('codex-sdk');const host=createToolHost({...declarations,ctx:f.ctx,contents,onEvent:e=>events.push(e),isCanceled:()=>false,requestId:'owner'});
 await host.enqueue({name:'list_plugin_commands',args:{}});const r=await host.enqueue({name:'run_plugin_command',args});assert.ok(r.changed);assert.ok(!host.settled());const complete=await host.enqueue({name:'complete_edit',args:{}});assert.ok(complete.ready,JSON.stringify(complete));assert.ok(host.settled());assert.ok(host.operations.some(op=>op.name==='run_plugin_command'&&op.changed));assert.equal(describeToolActivity('run_plugin_command',args,f.state.present,r).outcome,'Added 3 markers.');
});
await check('native denial remains a settled unchanged edit',async()=>{
 const f=fixture();f.mode='denied';const host=createToolHost({...nativeTools('codex-sdk'),ctx:f.ctx,contents:[],onEvent:()=>{},isCanceled:()=>false,requestId:'owner'});
 await host.enqueue({name:'list_plugin_commands',args:{}});await host.enqueue({name:'run_plugin_command',args});assert.ok((await host.enqueue({name:'complete_edit',args:{}})).ready);assert.equal(host.changed(),false);
});
await check('permission refusal also settles earlier command errors without requiring a forbidden retry',async()=>{
 const f=fixture(),host=createToolHost({...nativeTools('codex-sdk'),ctx:f.ctx,contents:[],onEvent:()=>{},isCanceled:()=>false,requestId:'owner'});
 await host.enqueue({name:'list_plugin_commands',args:{}});
 assert.ok((await host.enqueue({name:'run_plugin_command',args:{...args,input:[{id:'count',value:999}]}})).error);
 assert.ok(!(await host.enqueue({name:'complete_edit',args:{}})).ready);
 f.mode='denied';assert.ok((await host.enqueue({name:'run_plugin_command',args})).permission_denied);assert.ok((await host.enqueue({name:'complete_edit',args:{}})).ready);
});
await check('CraftAI forwards editor context only with its explicit command permission',async()=>{
 const f=fixture(true);await discover(f);const r=await f.runner.run('run_plugin_command',args);assert.ok(!r.error,r.error);assert.equal(f.requests[0].editor.playhead.time_sec,3);assert.equal(f.requests[0].editor.timeline.clips_total,1);
 const g=fixture();await discover(g);await g.runner.run('run_plugin_command',args);assert.equal(g.requests[0].editor,undefined);
});
await check('CraftAI clip transactions use the owning edit, actual counts and one Undo',async()=>{
 const f=fixture('edits');await discover(f);const r=await f.runner.run('run_plugin_command',args);assert.ok(!r.error,r.error);assert.equal(r.clips_changed,1);assert.equal(describeToolActivity('run_plugin_command',args,f.state.present,r).outcome,'Changed 1 clip.');assert.equal(f.state.present.textClips[0].start,6);assert.equal(f.state.agentEdit.steps.length,1);assert.equal(f.state.past.length,0);
 f.dispatch({type:'endAgentEdit',token:'owner'});f.dispatch({type:'undo'});assert.equal(f.state.present.textClips[0].start,1);
});
await check('CraftAI refuses revoked clip commit authorization without partial edits',async()=>{
 const f=fixture('edits');f.mode='revoke';await discover(f);const r=await f.runner.run('run_plugin_command',args);assert.ok(r.canceled);assert.equal(f.state.present.textClips[0].start,1);assert.equal(f.state.agentEdit.steps.length,0);
});
console.log(`${checks} plugin agent checks passed`);
