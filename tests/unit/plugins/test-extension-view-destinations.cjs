const assert=require('node:assert/strict');
const {viewPlacement,PLACEMENTS}=require('../../../shared/extensionViewPlacement.cjs');
for(const placement of PLACEMENTS)assert.equal(viewPlacement({placement}).placement,placement);
for(const input of [{placement:'other'},{placement:'bottom',height:300},{placement:'floating',width:159},{placement:'floating',height:Infinity},{placement:'workbench',bounds:{x:0,y:0,width:1,height:1}},{placement:'player-overlay',bounds:{x:.9,y:0,width:.2,height:.5}},{placement:'player-overlay',bounds:{x:0,y:0,width:0,height:1}},{placement:'modal',unknown:true}])assert.throws(()=>viewPlacement(input));
assert.deepEqual(viewPlacement({placement:'player-overlay',bounds:{x:.2,y:.3,width:.5,height:.5}}).bounds,{x:.2,y:.3,width:.5,height:.5});
console.log('Native destinations and normalized overlay/window geometry passed');
// Floating pages cycle focus locally; Escape can close a modal without exposing
// the disabled editor behind it. The native window/page disposal is covered in Electron.
const {EventEmitter}=require('node:events'),{ExtensionViews}=require('../../../electron/plugins/extensionViews.cjs');
(async()=>{
 const handlers=new Map(),runtime={active:new Map()},host=new ExtensionViews({runtime,manager:{},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},getWindow:()=>null}),extension={key:'key',state:'running'},frame={origin:'clipcraft-extension-view://fixture'},messages=[];
 const wc=Object.assign(new EventEmitter(),{id:42,mainFrame:frame,send:(...value)=>messages.push(value)});let focused=0,closed;
 const job={id:'demo.window',origin:frame.origin,extension,view:{webContents:wc,getVisible:()=>true},owner:{focus:()=>focused++},window:{},token:'token',data:{placement:'floating'}};
 runtime.active.set(extension.key,extension);host.active.set(job.id,job);host.senders.set(wc.id,job);host.close=id=>{closed=id;};const focus=direction=>handlers.get('extensionView:call')({sender:wc,senderFrame:frame},'token','focus',direction);
 assert.equal(await focus('forward'),true);assert.deepEqual(messages,[['extensionView:focusCycle','forward']]);assert.equal(focused,0);await focus('escape');assert.equal(focused,1);job.data.placement='modal';await focus('escape');assert.equal(closed,job.id);assert.equal(focused,1);console.log('Floating focus-cycle and native modal Escape routing passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
