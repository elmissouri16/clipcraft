const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {ExtensionUi}=require('../../../electron/plugins/extensionUi.cjs'),{ExtensionMessages,inputOptions}=require('../../../electron/plugins/extensionMessages.cjs');
(async()=>{
 const job={key:'key',generation:'one',state:'running',manifest:{id:'fixture.expanded',name:'Fixture'}},runtime={active:new Map(),execute:async(id,input)=>({id,input})};runtime.active.set(job.key,job);const ui=new ExtensionUi(runtime);
 const status=ui.register(job,'status',{id:'status',title:'Ready',command:'run',alignment:'right',tooltip:''});assert.ok(status.instance);ui.updateStatus(job,{id:'status',instance:status.instance,title:'Busy',enabled:false,disabledReason:'Wait'});await assert.rejects(ui.execute(status.id,{},status.instance,'status'),/Wait/);assert.equal(ui.list()[0].title,'Busy');
 assert.throws(()=>ui.updateStatus(job,{id:'status',instance:status.instance,title:'Partial',tooltip:'\0'}),/tooltip/);assert.equal(ui.list()[0].title,'Busy');
 ui.remove(job,'status','status');const replacement=ui.register(job,'status',{id:'status',title:'Replacement',command:'run'});assert.throws(()=>ui.updateStatus(job,{id:'status',instance:status.instance,title:'Old'}),/changed/);await assert.rejects(ui.execute(status.id,{},status.instance,'status'),/changed/);assert.equal((await ui.execute(status.id,{},replacement.instance,'status')).id,'fixture.expanded.run');
 for(const placement of ['left-rail','library','workbench'])ui.register(job,'view',{id:placement,title:'View',entry:'assets/view.html',placement});assert.throws(()=>ui.register(job,'view',{id:'invalid',title:'View',entry:'assets/view.html',placement:'unknown'}),/placement/);
 for(const location of ['menu.project','menu.timeline'])ui.register(job,'action',{id:location,title:'Menu item',command:'run',location});
 const owner={isDestroyed:()=>false,webContents:Object.assign(new EventEmitter(),{isDestroyed:()=>false})},other={...owner};let active=true;const messages=new ExtensionMessages({isActive:()=>active,getWindow:()=>owner});
 const pending=messages.show(job,{title:'Name',minLength:2,maxLength:8,value:'old'},'1',true),id=messages.list().items[0].id;
 assert.throws(()=>messages.finishInput(id,'valid',other),/unavailable/);assert.equal(messages.finish(id,'submit',owner),false);assert.throws(()=>messages.finishInput(id,'',owner),/limits/);assert.equal(messages.pending.size,1);messages.finishInput(id,'valid',owner);assert.equal(await pending,'valid');
 for(const input of [{title:''},{title:'Name',minLength:9,maxLength:2},{title:'Name',value:'a\n'},{title:'Name',password:'yes'},{title:'Name',unknown:1}])assert.throws(()=>inputOptions(input));
 const stopped=messages.show(job,{title:'Stop'},'2',true);active=false;messages.prune();assert.equal(await stopped,undefined);assert.equal(messages.pending.size,0);ui.stopped(job);assert.equal(ui.list().length,0);
 console.log('Input ownership/validation/Stop, status identity/updates, view placements and menu locations passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
