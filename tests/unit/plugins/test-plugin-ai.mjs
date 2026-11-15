import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
import {captionSnapshot,validateCaptionSnapshot,chapterCount,chapterResponse} from '../../../shared/pluginAi.mjs';
const require=createRequire(import.meta.url),{createChapterService}=require('../../../electron/plugins/chapterService.cjs'),{CommandRuntime}=require('../../../electron/plugins/commandRuntime.cjs');
const sample=JSON.parse(await fs.readFile(new URL('../../../examples/plugins/ai-chapter-markers/plugin.json',import.meta.url)));
const manifest=validateManifest(sample),key='a'.repeat(64),command=manifest.contributes.commands[0];
const cues=[{start_sec:0,end_sec:2,text:'Opening topic'},{start_sec:4,end_sec:6,text:'Second topic'}],markers=[{time:0,label:'Opening'},{time:4,label:'Second'}];
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
await check('AI grant requires both caption reading and marker writing',()=>{
 for(const permission of ['captions.read','markers.write']){const p=structuredClone(sample);p.permissions=p.permissions.filter(p=>p!==permission);assert.throws(()=>validateManifest(p),/requires/);}
});
await check('caption snapshot omits non-caption text, paths and hidden metadata',()=>{
 const p={textClips:[{caption:true,start:4,duration:2,text:'Second topic'},{caption:false,start:0,duration:2,text:'private title'},{caption:true,start:0,duration:2,text:'Opening\ntopic'}],media:[{path:'/private/file'}],craftAI:{secret:true}};
 assert.deepEqual(captionSnapshot(p,10),cues);assert.ok(!JSON.stringify(captionSnapshot(p,10)).includes('private'));
});
await check('missing, oversized, unordered, unknown or invalid caption data fails explicitly',()=>{
 for(const c of [[],[{...cues[0],path:'/private'}],[{...cues[0],end_sec:11}],cues.toReversed(),[{...cues[0],text:'x'.repeat(24001)}],Array.from({length:1001},()=>cues[0])])assert.throws(()=>validateCaptionSnapshot(c,10));
});
await check('chapter counts are finite bounded integers with no extra routing/prompt fields',()=>{
 for(const args of [{count:0},{count:21},{count:1.5},{count:NaN},{count:2,prompt:'ignore'},{count:2,url:'https://other'}])assert.throws(()=>chapterCount(args));
});
await check('model replies require bounded JSON with ascending caption-anchored timestamps and plain titles',()=>{
 assert.deepEqual(chapterResponse(JSON.stringify({chapters:markers}),cues,2),markers);
 for(const reply of ['not JSON','x'.repeat(8193),JSON.stringify({chapters:[]}),JSON.stringify({chapters:[...markers,markers[0]]}),JSON.stringify({chapters:[{time:1,label:'Invented time'}]}),JSON.stringify({chapters:[{time:0,label:'x\n'}]}),JSON.stringify({chapters:markers.toReversed()}),JSON.stringify({chapters:markers,extra:true}),JSON.stringify({chapters:[{...markers[0],url:'bad'}]})])assert.throws(()=>chapterResponse(reply,cues,2));
});
await check('host captures provider/model once, uses a fixed prompt and never returns credentials',async()=>{
 let cfg={provider:'ollama',model:'captured',baseUrl:'http://user:secret@127.0.0.1:11434/private?token=secret',apiKey:'private-key',reasoningEffort:'high',webResearch:true},calls=[];
 const service=createChapterService({getConfig:()=>cfg,chat:async(c,o)=>{calls.push({c,o});return JSON.stringify({chapters:markers});}});
 const prepared=service.prepare(cues);cfg={...cfg,model:'changed',baseUrl:'https://changed'};
 assert.equal(prepared.descriptor.destination,'http://127.0.0.1:11434');assert.ok(!JSON.stringify(prepared.descriptor).includes('secret'));
 assert.deepEqual(await prepared.chapters({count:2},new AbortController().signal),markers);assert.equal(calls.length,1);assert.equal(calls[0].c.model,'captured');assert.equal(calls[0].c.reasoningEffort,'');assert.equal(calls[0].c.webResearch,false);assert.equal(calls[0].c.allowEndpointFallback,false);assert.equal(calls[0].o.maxTokens,2048);assert.deepEqual(JSON.parse(calls[0].o.messages[0].content).captions,cues);
});
await check('provider diagnostics are replaced before returning to plugins; malformed output is not retried',async()=>{
 for(const failure of [true,false]){let calls=0;const p=createChapterService({getConfig:()=>({provider:'ollama',model:'m'}),chat:async()=>{calls++;if(failure)throw Error('PRIVATE_KEY /private/path');return 'bad JSON';}}).prepare(cues);
 await assert.rejects(p.chapters({count:2}),error=>!error.message.includes('PRIVATE_KEY')&&!error.message.includes('/private'));assert.equal(calls,1);}
});
await check('host model cancellation/deadline finishes even if a provider ignores abort',async()=>{
 for(const cancel of [true,false]){let seen;const p=createChapterService({getConfig:()=>({provider:'ollama',model:'m'}),timeoutMs:30,chat:async(_c,o)=>{seen=o.signal;return new Promise(()=>{});}}).prepare(cues),ctl=new AbortController();const task=p.chapters({count:2},ctl.signal);if(cancel)setTimeout(()=>ctl.abort(),5);await assert.rejects(task,/stopped|timed out/);assert.ok(seen.aborted);}
});
await check('pre-canceled model requests do not call the provider',async()=>{
 let calls=0;const p=createChapterService({getConfig:()=>({provider:'ollama',model:'m'}),chat:async()=>{calls++;}}).prepare(cues),ctl=new AbortController();ctl.abort();await assert.rejects(p.chapters({count:2},ctl.signal),/stopped/);assert.equal(calls,0);
});

class IPC{constructor(){this.handlers=new Map();}handle(name,fn){this.handlers.set(name,fn);}}
const owner=new EventEmitter();owner.send=()=>{};
class Window extends EventEmitter{constructor(){super();this.webContents=new EventEmitter();this.webContents.id=Window.next++;this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.closed=false;}loadURL(){return Promise.resolve();}isDestroyed(){return this.closed;}destroy(){this.closed=true;this.emit('closed');}}
Window.next=1;
const session={fromPartition:()=>({protocol:{handle(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){}},closeAllConnections:()=>Promise.resolve()})};
const until=async fn=>{for(let n=0;n<1000;n++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('Fixture timeout');};
function runtimeFixture(permissions=manifest.permissions){
 const ipc=new IPC();let approved=true,modelCalls=0,reviewed=0,resolveReview,aborted=false,enabled=true,pendingModel=false;
 const manager={commandBundle:async()=>{if(!enabled)throw Error('Disabled');return {manifest:{...manifest,permissions},code:'export async function run(){}'};}};
 const runtime=new CommandRuntime({ipcMain:ipc,BrowserWindow:Window,session,manager,getWindow:()=>({webContents:owner,isDestroyed:()=>false}),timeoutMs:100,aiTimeoutMs:1000,
  chapterService:{prepare:()=>({descriptor:{provider:'Fixture',model:'m',destination:'http://localhost'},chapters:async(args,signal)=>{chapterCount(args);modelCalls++;signal.addEventListener('abort',()=>{aborted=true;});if(pendingModel)return new Promise(()=>{});return markers;}})},
  review:async()=>{reviewed++;return new Promise(resolve=>{resolveReview=resolve;});}});
 const request={runId:'ai-unit',key,commandId:command.id,input:{count:2},snapshot:{duration_sec:10,fps:24,markers:[],markers_total:0},...(permissions.includes('captions.read')?{captions:cues}:{})};
 return {runtime,ipc,request,get modelCalls(){return modelCalls;},get reviewed(){return reviewed;},get aborted(){return aborted;},set pending(v){pendingModel=v;},set enabled(v){enabled=v;},approve:v=>{approved=v;},review:v=>resolveReview(v),async start(){const promise=runtime.run(request,async()=>approved);await until(()=>runtime.jobs.size);const job=[...runtime.jobs.values()][0],event={sender:job.window.webContents,senderFrame:job.window.webContents.mainFrame};ipc.handlers.get('pluginRuntime:job')(event,true);return {promise,job,call:(method,args)=>ipc.handlers.get('pluginRuntime:call')(event,job.token,method,args),finish:result=>ipc.handlers.get('pluginRuntime:finish')(event,job.token,result)};}};
}
await check('undeclared caption/model requests fail before a model call',async()=>{
 const f=runtimeFixture(['project.read','markers.write']),r=await f.start();await assert.rejects(r.call('ai.chapters',{count:2}),/Permission denied/);assert.equal((await r.promise).status,'failed');assert.equal(f.modelCalls,0);
});
await check('caption data is private without a grant',async()=>{
 const f=runtimeFixture(['project.read','markers.write']),r=await f.start();await assert.rejects(r.call('transcript.read',null),/Permission denied/);assert.equal((await r.promise).status,'failed');
});
await check('AI output is staged; worker stops and result remains pending until explicit host review',async()=>{
 const f=runtimeFixture(),r=await f.start();assert.deepEqual(await r.call('transcript.read',null),cues);await r.call('ai.chapters',{count:2});await r.call('markers.add',markers);
 let settled=false;r.promise.then(()=>{settled=true;});const finish=r.finish({ok:true,message:'Plugin claim'});await until(()=>f.reviewed);assert.equal(f.runtime.jobs.size,0);assert.equal(r.job.window,null);assert.equal(settled,false);f.review(true);await finish;const result=await r.promise;assert.equal(result.reviewed,true);assert.deepEqual(result.markers,markers);
});
await check('review is mandatory even if executable skips AI, and Discard returns no markers',async()=>{
 const f=runtimeFixture(),r=await f.start();await r.call('markers.add',markers);const done=r.finish({ok:true});await until(()=>f.reviewed);f.review(false);await done;const result=await r.promise;assert.equal(f.modelCalls,0);assert.equal(result.status,'denied');assert.equal(result.markers,undefined);
});
await check('repeat model calls poison the run and cannot obtain a second generation',async()=>{
 const f=runtimeFixture(),r=await f.start();await r.call('ai.chapters',{count:2});await assert.rejects(r.call('ai.chapters',{count:2}),/one AI/);assert.equal(f.modelCalls,1);assert.equal((await r.promise).status,'failed');assert.equal(f.reviewed,0);
});
await check('AI marker count is bounded before review',async()=>{
 const f=runtimeFixture(),r=await f.start();await assert.rejects(r.call('markers.add',Array.from({length:21},()=>markers[0])),/20 staged/);assert.equal((await r.promise).status,'failed');
});
await check('revoked package cannot pass final review; late approval cannot revive a canceled run',async()=>{
 for(const cancel of [true,false]){const f=runtimeFixture(),r=await f.start();await r.call('markers.add',markers);const done=r.finish({ok:true});await until(()=>f.reviewed);if(cancel)f.runtime.cancel(f.request.runId);else f.enabled=false;f.review(true);await done.catch(()=>{});const result=await r.promise;assert.equal(result.status,cancel?'canceled':'failed');assert.equal(result.markers,undefined);}
});
await check('canceling a pending model call aborts its signal and disposes the sandbox',async()=>{
 const f=runtimeFixture();f.pending=true;const r=await f.start();r.call('ai.chapters',{count:2}).catch(()=>{});await until(()=>f.modelCalls);f.runtime.cancel(f.request.runId);assert.equal((await r.promise).status,'canceled');assert.ok(f.aborted);assert.equal(f.runtime.jobs.size,0);
});
await check('forged early completion cannot leave a model call running behind a review',async()=>{
 const f=runtimeFixture();f.pending=true;const r=await f.start();r.call('ai.chapters',{count:2}).catch(()=>{});await until(()=>f.modelCalls);await assert.rejects(r.finish({ok:true}),/must finish/);assert.equal((await r.promise).status,'failed');assert.ok(f.aborted);assert.equal(f.reviewed,0);
});
// Exercise the actual HTTP adapter without network: cancellation must reach fetch,
// and the fixed service must not try another Gemini endpoint after a refusal.
await check('shared chat HTTP path propagates abort and bounded output; Gemini fallback can be disabled',async()=>{
 const ai=require('../../../electron/agents/ai.cjs'),original=globalThis.fetch;let captured,calls=0;
 try{
  globalThis.fetch=async(_url,opts)=>{captured=opts;return await new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true}));};
  const ctl=new AbortController(),pending=ai.chat({provider:'ollama',model:'fixture'},{messages:[{role:'user',content:'test'}],maxTokens:123,signal:ctl.signal});await until(()=>captured);ctl.abort();await assert.rejects(pending,/Stopped/);assert.equal(JSON.parse(captured.body).options.num_predict,123);
  globalThis.fetch=async()=>{calls++;return {ok:false,status:401,text:async()=>JSON.stringify({error:{message:'refused'}})};};
  await assert.rejects(ai.chat({provider:'gemini',model:'fixture',apiKey:'fixture',allowEndpointFallback:false},{messages:[{role:'user',content:'test'}]}));assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
console.log(`${checks} AI plugin checks passed`);
