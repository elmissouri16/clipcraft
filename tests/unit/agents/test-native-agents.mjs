import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runAgent } from "../../../src/features/agent/runAgent.js";
import { emptyProject, historyReducer } from "../../../src/state/store.js";
const require=createRequire(import.meta.url);
const {createNativeAgents}=require("../../../electron/agents/nativeAgents.cjs");
const {toJsonSchema}=require("../../../electron/agents/ai.cjs");
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const realClaude=await import('@anthropic-ai/claude-agent-sdk');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-native-tests-'));
const checks=[],check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const clients=new Map(),queries=[];
const claudeSdk={...realClaude,query:({prompt,options})=>{
 queries.push(options);
 let closed=false;
 return {async *[Symbol.asyncIterator](){
  assert.deepEqual(options.tools,[]);assert.equal(options.outputFormat,undefined);
  const server=options.mcpServers.clipcraft.instance;
  let client=clients.get(server);
  if(!client){const[a,b]=InMemoryTransport.createLinkedPair();client=new Client({name:'native-test',version:'1'});await server.connect(a);await client.connect(b);clients.set(server,client);}
  for await(const message of prompt){assert.equal(typeof message.message.content,'string');}
  const offered=(await client.listTools()).tools.map(tool=>tool.name);check('Claude receives native in-process editor tools',offered.includes('get_project')&&offered.includes('complete_edit'));
  await client.callTool({name:'get_project',arguments:{}});
  await client.callTool({name:'add_text',arguments:{text:'Claude native title',start_sec:8,duration_sec:1}});
  await client.callTool({name:'inspect_frames',arguments:{times_sec:[0]}});
  for(let n=0;n<6;n++){const result=await client.callTool({name:'complete_edit',arguments:{}});const data=JSON.parse(result.content[0].text);if(data.ready)break;check('Claude receives typed visual evidence from its native tool',result.content.some(block=>block.type==='image'));}
  yield {type:'result',subtype:'success',result:'Claude completed the native edit.',session_id:options.resume||'00000000-0000-4000-8000-000000000001'};
 },close(){closed=true;}};
}};
const native=createNativeAgents({loadSdk:async()=>claudeSdk,resolveExecutable:cfg=>cfg.provider==='codex-sdk'?new URL("../../fixtures/codex-native-stub.cjs",import.meta.url).pathname:'/fake/claude',childEnv:()=>({...process.env,FVE_NATIVE_FIXTURE_LOG:path.join(dir,'protocol.jsonl')})});
try{
 for(const provider of ['codex-sdk','claude-agent-sdk']){
  let state={past:[],future:[],present:{...emptyProject(),media:[{id:'m',name:'Video',type:'video',duration:10}],videoClips:[{id:'v',mediaId:'m',in:0,out:10,speed:1}]}},listener,resolveTool,stopListener,callId=0;
  const pending=new Map(),contents=[],events=[],captures=[];
  const invoke=(name,args)=>new Promise(resolve=>{const id=String(callId++);pending.set(id,resolve);listener({requestId:'native-test',callId:id,name,args});});
  const api={
   agentStep:()=>{throw new Error('SDK editor must never use the JSON step loop');},
   mcpTools:async()=>({ok:true,tools:[]}),onAgentNativeTool:cb=>{listener=cb;return()=>{listener=null;}},onAgentNativeStop:cb=>{stopListener=cb;return()=>{};},
   agentNativeToolResult:async({callId,result})=>{pending.get(callId)(result);pending.delete(callId);},
   agentInspectFrames:async req=>{captures.push(req.times_sec);return {revision:req.revision,frames:req.times_sec.map(time_sec=>({id:`frame-${time_sec}`,source:'timeline',time_sec}))};},
   agentRunNative:async req=>{const result=await native.run({provider,model:'test-model'},{...req,tools:req.tools.map(tool=>({...tool,parameters:toJsonSchema(tool.parameters)})),sessionKey:provider,onTool:async(name,args)=>{
     const result=await invoke(name,args);return {isError:!!result.error,content:[{type:'text',text:JSON.stringify(result)},...(result.frames?.length?[{type:'image',mimeType:'image/jpeg',data:'aGVsbG8='}]:[])]};},isComplete:async()=>!!(await invoke('__native_status',{})).ready});return {ok:true,...result};},
  };
  const ctx={provider,api,getProject:()=>state.present,dispatch:a=>{state=historyReducer(state,a);},settle:async()=>{}};
  for(let i=0;i<2;i++){
   contents.push({role:'user',parts:[{text:`Add title request ${i}`}]});
   const result=await runAgent({contents,ctx,onEvent:event=>events.push(event),isCanceled:()=>false,requestId:'native-test',sessionKey:provider});
   assert.ok(!result.error,JSON.stringify(result));
   check(`${provider} completes using native callbacks`,result.changed&&state.present.textClips.length===i+1);
  }
  check(`${provider} verifies edited intervals instead of accepting unrelated frames`,captures.flat().some(t=>t>=8&&t<9));
  check(`${provider} saves tool pairs without image bytes`,!JSON.stringify(contents).includes('aGVsbG8='));
  check(`${provider} streams contextual tool activity`,events.some(e=>e.name==='add_text'&&e.status==='running'&&e.activity?.excerpt));
  check(`${provider} reports actual tool outcomes`,events.some(e=>e.name==='complete_edit'&&e.activity?.outcome==='Edit checks passed'));
 }
 check('Claude resumes its native session on the second user request',!queries[0].resume&&queries[1].resume==='00000000-0000-4000-8000-000000000001');
 check('Claude allows only registered tools',queries.every(options=>options.allowedTools.every(name=>name.startsWith('mcp__clipcraft__'))));
 const protocol=fs.readFileSync(path.join(dir,'protocol.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 check('Codex creates one native thread for multiple user requests',protocol.filter(item=>item.method==='thread/start').length===1&&protocol.filter(item=>item.method==='turn/start').length===2);
 check('Codex replayed native callbacks execute the edit only once',protocol.some(item=>item.duplicateCallbackCompleted));
 check('Codex rejects callbacks belonging to an older turn',protocol.some(item=>item.staleCallbackRejected));
 check('Codex registers direct dynamic tools without an output schema',protocol.some(item=>item.tools?.includes('get_project')&&!item.hasOutputSchema));
 native.close();
 if(process.env.NATIVE_AGENT_EVIDENCE)fs.writeFileSync(process.env.NATIVE_AGENT_EVIDENCE,JSON.stringify({checks},null,2));
 console.log('native agents OK: '+checks.join('; '));
}finally{native.close();for(const client of clients.values())await client.close().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}
