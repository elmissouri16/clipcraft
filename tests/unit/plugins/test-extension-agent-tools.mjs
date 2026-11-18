import assert from 'node:assert/strict';
import {emptyProject,historyReducer,prepareExtensionCommit,pluginEditsApplied} from '../../../src/state/store.js';
import {makeAgentCtx} from '../../../src/features/agent/agentCtx.js';
import {createToolRunner} from '../../../src/features/agent/tools.js';
import {ExtensionAgentSession} from '../../../src/features/plugins/extensionAgentSession.js';
const key='a'.repeat(64),manifest={id:'fixture.node',name:'Ordinary Node',version:'0.1.0',main:'dist/extension.cjs',contributes:{commands:[{id:'run',name:'Run',description:'Argument: count',parameters:[]}]}};
function fixture(){
 let state={past:[],present:{...emptyProject(),id:'node-agent',videoClips:[{id:'gap',gap:true,in:0,out:5}]},future:[]},stopped=false,mode='edit',calls=0,received;
 state=historyReducer(state,{type:'beginAgentEdit',token:'owner'});
 const api={pluginsList:async()=>[{key,enabled:true,manifest}]};globalThis.window={api};
 const app={getAgentEdit:()=>state.agentEdit,pluginCommandReady:()=>true,runExtensionCommand:async(input,callbacks)=>{calls++;received=input;if(mode==='denied')return {status:'denied'};
  const session=new ExtensionAgentSession({...callbacks,getHistory:()=>state,hasProject:()=>true,isBusy:()=>false});
  for(let index=0;index<2;index++){
   const action={type:'setMarkers',markers:[...state.present.markers,{id:'marker'+index,time:index,label:'Native'}]},next=historyReducer({past:[],present:state.present,future:[]},action).present;
   if(mode==='invalid')next.textClips=[{id:'invalid',start:0,duration:-1}];
   if(mode==='interrupted')state=historyReducer(state,{type:'setProject',patch:{name:'User edit'}});
   if(mode==='canceled')stopped=true;
   session.commit(action,next,candidate=>{const plan=prepareExtensionCommit(state,candidate,()=>true,callbacks.agentToken);state=historyReducer(state,plan);assert.ok(pluginEditsApplied(state,plan));});session.receipt('markers.apply',{applied:1,changed:true},manifest.id);
   state=historyReducer(state,{type:'craftChat',projectId:state.present.id,chat:{pending:true}});
  }
  return {status:'completed',document_receipts:session.receipts,receipts:[],untrusted_extension_response:{claimed_markers:999,artifact:{path:'/forged'}}};
 }};
 const ctx=makeAgentCtx({app,getProject:()=>state.present,dispatch:action=>{state=historyReducer(state,action);},settle:async()=>{},requestId:'owner',isCurrent:()=>true,isStopped:()=>stopped,allowPluginCommands:true});const runner=createToolRunner({...ctx,isCanceled:()=>stopped});
 return {runner,api,get state(){return state;},set mode(value){mode=value;},get calls(){return calls;},get received(){return received;},dispatch:action=>{state=historyReducer(state,action);}};
}
const discover=f=>f.runner.run('list_plugin_commands',{}),run=(f,args={})=>f.runner.run('run_plugin_command',{key,command_id:'run',...args});
let f=fixture(),catalog=await discover(f);assert.equal(catalog.commands[0].runtime,'node');assert.equal(catalog.commands[0].arguments_format,'json-object');assert.equal(catalog.commands[0].description,'Argument: count');
let result=await run(f,{arguments_json:'{"count":2,"nested":{"choices":[true,"x"]}}'});assert.ok(!result.error,result.error);assert.equal(result.changed,true);assert.equal(result.document_receipts.length,2);assert.equal(result.artifacts.length,0);assert.equal(result.untrusted_extension_response.claimed_markers,999);assert.equal(result.markers_added,undefined);assert.equal(f.received.input.count,2);assert.equal(f.state.agentEdit.steps.length,2);assert.equal(f.state.past.length,0);f.dispatch({type:'endAgentEdit',token:'owner'});assert.equal(f.state.past.length,1);f.dispatch({type:'undo'});assert.equal(f.state.present.markers.length,0);f.dispatch({type:'redo'});assert.equal(f.state.present.markers.length,2);
for(const retry_of of ['failed-tool-call']){f=fixture();await discover(f);result=await run(f,{arguments_json:'{"count":2}',retry_of});assert.ok(!result.error,result.error);assert.equal(f.received.input.count,2);assert.equal(Object.hasOwn(f.received.input,'retry_of'),false);}
for(const args of [{arguments_json:'[]'},{arguments_json:'null'},{arguments_json:'invalid'},{arguments_json:'x'.repeat(16385)},{input:[{id:'count',value:2}]}]){f=fixture();await discover(f);assert.ok((await run(f,args)).error);assert.equal(f.calls,0);}
for(const mode of ['invalid','interrupted','canceled']){f=fixture();f.mode=mode;await discover(f);result=await run(f);assert.ok(result.error,mode);assert.equal(f.state.present.markers.length,0);}
f=fixture();f.mode='denied';await discover(f);assert.ok((await run(f)).permission_denied);assert.ok((await run(f)).permission_denied);assert.equal(f.calls,1);
f=fixture();assert.match((await run(f)).error,/Discover/);
f=fixture();f.api.pluginsDevelopment=async()=>({session:{status:'ready',key:'b'.repeat(64),manifest:{...manifest,name:'Development Node'}}});catalog=await discover(f);assert.equal(catalog.total,2);assert.ok(catalog.commands.some(command=>command.development&&command.key==='b'.repeat(64)));

console.log('Ordinary Node discovery/arguments, final-state validation, native receipts, repeated writes, metadata, one Undo, denial and interruption passed');
