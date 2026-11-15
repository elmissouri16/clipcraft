const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createGifFrames}=require('../../../electron/export/pluginGifFrames.cjs');
(async()=>{
 const handlers=new Map(),ipcMain={handle:(name,handler)=>handlers.set(name,handler)};let instance;
 class Window extends EventEmitter{
  constructor(){super();instance=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{id:7,mainFrame:{},setWindowOpenHandler:()=>{},send:(_channel,data)=>{this.sent=data;},capturePage:async()=>({isEmpty:()=>false,getSize:()=>({width:32,height:18}),toPNG:()=>Buffer.from('frame')})});this.closed=false;}
  isDestroyed(){return this.closed;}loadURL(){return Promise.resolve();}loadFile(){return Promise.resolve();}destroy(){this.closed=true;this.emit('closed');}
 }
 const create=createGifFrames({ipcMain,BrowserWindow:Window,manager:{ready:Promise.resolve(),effects:async()=>[],transitions:async()=>[]}}),controller=new AbortController();
 const project={id:'private',videoClips:[]},plan={width:32,height:18,start_sec:0.6,fps:10};
 const renderer=create({project,plan,signal:controller.signal}),event={sender:instance.webContents,senderFrame:instance.webContents.mainFrame};
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 await assert.rejects(handlers.get('pluginGif:frameJob')({sender:{id:7},senderFrame:event.senderFrame}),/Unknown/);checks++;
 await assert.rejects(handlers.get('pluginGif:frameJob')({...event,senderFrame:{}}),/Unknown/);checks++;
 let frame=renderer.frame(0),settled=false;frame.then(()=>{settled=true;});
 const job=await handlers.get('pluginGif:frameJob')(event);check('authorized renderer receives the captured composition and original start',()=>{assert.equal(job.project,project);assert.equal(job.time_sec,0.6);});
 await assert.rejects(handlers.get('pluginGif:frameJob')(event),/already taken/);checks++;
 check('stale sequence cannot acknowledge a frame',()=>assert.equal(handlers.get('pluginGif:frameReady')(event,null,0),false));await new Promise(r=>setTimeout(r,1));assert.equal(settled,false);
 handlers.get('pluginGif:frameReady')(event,null,1);await frame;checks++;
 frame=renderer.frame(1);check('next sample retains the original timeline offset',()=>assert.deepEqual(instance.sent,{time_sec:0.7,sequence:2}));
 handlers.get('pluginGif:frameReady')(event,'decode failed',2);await assert.rejects(frame,/decode failed/);checks++;
 frame=renderer.frame(2);controller.abort();await assert.rejects(frame,/canceled/);check('abort and repeated cleanup safely dispose the renderer',()=>{renderer.close();renderer.close();assert.equal(instance.closed,true);});
 await assert.rejects(handlers.get('pluginGif:frameJob')(event),/Unknown/);checks++;
 console.log(JSON.stringify({ok:true,checks}));
})().catch(error=>{console.error(error);process.exitCode=1;});
