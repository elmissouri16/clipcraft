import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import fs from 'node:fs';
import {emptyProject} from '../../../src/state/store.js';import {gifPlan} from '../../../shared/pluginGif.mjs';
const require=createRequire(import.meta.url),{CommandRuntime}=require('../../../electron/plugins/commandRuntime.cjs');
const manifest=JSON.parse(fs.readFileSync(new URL('../../../examples/plugins/gif-export/plugin.json',import.meta.url)));
const handlers=new Map(),ipcMain={handle:(name,fn)=>handlers.set(name,fn)};
const owner=new EventEmitter();owner.mainFrame={};owner.send=()=>{};
let windows=0,exported=0,approval;
class Window extends EventEmitter{
 constructor(){super();this.webContents=new EventEmitter();this.webContents.id=++windows;this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.destroyed=false;}
 isDestroyed(){return this.destroyed;}loadURL(){return Promise.resolve();}destroy(){this.destroyed=true;this.emit('closed');}
}
const manager={commandBundle:async()=>({manifest,code:'export function run(){}'})};
const runtime=new CommandRuntime({ipcMain,BrowserWindow:Window,session:{fromPartition:()=>({protocol:{handle(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){}},closeAllConnections:async()=>{}})},manager,getWindow:()=>({webContents:owner,isDestroyed:()=>false})});
runtime.gifExporter={run:async({plan,verify})=>{assert.equal(runtime.jobs.size,0);await verify();exported++;return {format:'gif',path:'/verified.gif',...plan};}};
const project={...emptyProject(),width:320,height:180,videoClips:[{id:'gap',gap:true,in:0,out:2}]};
const request={runId:'gif-unit',key:'a'.repeat(64),commandId:'export-gif',input:{start_sec:0,end_sec:1,max_size:'size-320',fps:'fps-10'},snapshot:{duration_sec:2,fps:30,markers:[],markers_total:0},exportProject:project};
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const start=async()=>{const promise=runtime.run(request,async(_manifest,_command,info)=>{approval=info;return true;});for(let i=0;i<200&&!runtime.jobs.size;i++)await new Promise(r=>setTimeout(r,5));const job=[...runtime.jobs.values()][0];assert.ok(job);const event={sender:job.window.webContents,senderFrame:job.window.webContents.mainFrame},payload=handlers.get('pluginRuntime:job')(event,true);return {promise,job,event,payload};};
let active=await start();check('approval contains resolved immutable GIF settings',()=>assert.deepEqual(approval.gif,gifPlan({width:320,height:180,duration_sec:2},request.input)));
check('worker never receives the composition or paths',()=>assert.deepEqual(Object.keys(active.payload).sort(),['code','commandId','input','token']));
const call=(active,method,args)=>handlers.get('pluginRuntime:call')(active.event,active.payload.token,method,args),finish=(active,result)=>handlers.get('pluginRuntime:finish')(active.event,active.payload.token,result);
await call(active,'export.gif',request.input);check('staging writes no output',()=>assert.equal(exported,0));await finish(active,{ok:true,message:'invented filename'});let result=await active.promise;
check('only host output is returned, after worker shutdown',()=>{assert.equal(exported,1);assert.equal(result.artifact.path,'/verified.gif');assert.equal(result.message,undefined);});
active=await start();await assert.rejects(call(active,'export.gif',{...request.input,end_sec:1.5}),/approved/);check('staged settings cannot exceed approved settings',()=>assert.equal(exported,1));assert.equal((await active.promise).status,'failed');
active=await start();await call(active,'export.gif',request.input);await assert.rejects(call(active,'export.gif',request.input),/Only one/);assert.equal((await active.promise).status,'failed');check('second job poisons the entire run',()=>assert.equal(exported,1));
active=await start();await call(active,'export.gif',request.input);await finish(active,{ok:false,error:'failed after staging'});assert.equal((await active.promise).status,'failed');check('worker failure after staging exports nothing',()=>assert.equal(exported,1));
active=await start();await assert.rejects(finish(active,{ok:true,artifact:{format:'gif',path:'/forged.gif'}}),/No GIF/);result=await active.promise;check('forged worker artifact cannot become host success',()=>{assert.equal(result.status,'failed');assert.equal(result.artifact,undefined);assert.equal(exported,1);});
active=await start();await call(active,'export.gif',request.input);runtime.cancel(request.runId);assert.equal((await active.promise).status,'canceled');check('cancellation discards a staged job',()=>assert.equal(exported,1));
const old=manifest.permissions;manifest.permissions=['project.read'];check('composition requires export permission',()=>assert.ok(true));assert.match((await runtime.run(request,async()=>true)).error,/Composition data requires/);manifest.permissions=old;
console.log(JSON.stringify({ok:true,checks}));
