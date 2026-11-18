// Regressions from the 2026-11-18 plugin API review, against the real runtime and worker
// (tests/fixtures/extensionRuntimeHarness.cjs). Usage: node tests/unit/plugins/test-extension-reliability.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHost,sleep}=require('../../fixtures/extensionRuntimeHarness.cjs');
const checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
(async()=>{
 // --- handlers that fail without an Error, stray rejections, stop and start races
 let t=createHost({a:{manifest:{id:'test.a',contributes:{commands:[{id:'nullish',name:'n'}]}},code:`
  const fs=require('node:fs'),path=require('node:path');
  exports.activate=async c=>{
   await c.commands.register('nullish',()=>Promise.reject());
   await c.commands.register('thrown-null',()=>{throw null;});
   await c.commands.register('stray',()=>{Promise.reject(new Error('stray rejection'));return 'returned';});
   await c.commands.register('ok',()=>'ok');
   await c.commands.register('emit',async()=>[(await c.events.emit('topic',1)).name,(await c.events.emit('test.a.topic',2)).name]);
   exports.storage=c.extension.storagePath;
  };
  exports.deactivate=async()=>{const file=path.join(exports.storage,'deactivated.txt');fs.mkdirSync(exports.storage,{recursive:true});fs.appendFileSync(file,'x');await new Promise(r=>setTimeout(r,150));};`}});
 await t.host.start('a');
 await assert.rejects(t.host.execute('test.a.nullish'),/failed without an error/);
 await assert.rejects(t.host.execute('test.a.thrown-null'),/failed without an error/);
 assert.equal(await t.host.execute('test.a.ok'),'ok');check('a handler that rejects or throws without an Error answers its caller and the extension keeps running');
 assert.equal(await t.host.execute('test.a.stray'),'returned');await sleep(300);
 assert.equal(await t.host.execute('test.a.ok'),'ok');assert.ok(t.host.active.get('a').logs.some(line=>/Unhandled rejection: Error: stray rejection/.test(JSON.stringify(line))));
 check('a stray rejection in authored code is logged and does not end the activation');
 assert.deepEqual(await t.host.execute('test.a.emit'),['test.a.topic','test.a.topic']);check('events.emit publishes under the package ID once, with or without the prefix');
 const storage=path.join(t.host.root,'test.a');
 await Promise.all([t.host.stop('a'),t.host.stop('a'),t.host.stop('a')]);
 assert.equal(fs.readFileSync(path.join(storage,'deactivated.txt'),'utf8'),'x');check('overlapping stops run deactivate() once');
 await t.host.start('a');const stopping=t.host.stop('a');await sleep(20);
 assert.equal(await t.host.start('a'),true);await stopping;
 assert.equal(t.host.active.get('a')?.state,'running');assert.equal(await t.host.execute('test.a.ok'),'ok');check('start during a stop waits, then yields a running activation');
 await t.close();

 // --- one failing extension does not keep the others from activating
 t=createHost({bad:{manifest:{id:'test.bad',activationEvents:['startup']},code:`exports.activate=()=>{throw Error('boom in activate');};`},
  good:{manifest:{id:'test.good',activationEvents:['startup'],contributes:{commands:[{id:'ok',name:'ok'}]}},code:`exports.activate=async c=>{await c.commands.register('ok',()=>'ok');};`}});
 const errors=await t.host.activate('startup',{continueOnError:true});assert.equal(errors.length,1);assert.match(errors[0].message,/boom in activate/);
 assert.equal(t.host.active.get('good')?.state,'running');
 await t.host.stop('good',{suspend:false});t.host.suspended.delete('bad');
 await assert.rejects(t.host.activate('startup'),/boom in activate/);assert.equal(t.host.active.get('good')?.state,'running');
 check('activation tries every matching extension and reports the failure afterwards');
 await t.close();

 // --- typed services, declared setting defaults, change attribution, publisher-bound storage
 const service=`const contract={version:1,methods:{greet:{input:{type:'object',properties:{name:{type:'string'},title:{type:'string'}},required:['name']},output:{type:'string'}}}};`;
 t=createHost({s:{manifest:{id:'test.s',publisher:'First'},code:`${service}
  exports.activate=async c=>{const seen=[];const sub=c.events.on('configuration.changed',(value,context)=>{seen.push(context.source.kind);});await sub.ready;
   await c.services.registerTyped('text',contract,{greet:input=>(input.title?input.title+' ':'')+input.name});
   await c.ui.registerSettings({id:'main',title:'Main',location:'settings.plugins',fields:[{key:'count',label:'Count',type:'number',default:5},{key:'mode',label:'Mode',type:'select',default:'slow',options:[{label:'Slow',value:'slow'},{label:'Fast',value:'fast'}]},{key:'token',label:'Token',type:'secret'}]});
   await c.commands.register('greet',async()=>{const client=await c.services.connect('test.s.text',contract);return client.call('greet',{name:'Ada',title:undefined});});
   await c.commands.register('settings',async()=>({count:await c.configuration.get('count'),mode:await c.configuration.get('mode'),missing:await c.configuration.get('missing'),token:await c.secrets.get('token')}));
   await c.commands.register('write',async()=>{await c.configuration.update({key:'mode',value:'fast'});await c.secrets.store({key:'token',value:'s3cret'});return true;});
   await c.commands.register('seen',()=>seen);};`}});
 await t.host.start('s');
 assert.equal(await t.host.execute('test.s.greet'),'Ada');check('typed services accept an optional property passed as undefined');
 assert.deepEqual(await t.host.execute('test.s.settings'),{count:5,mode:'slow',missing:undefined,token:undefined});check('configuration.get returns the default a registered settings field declares');
 await t.host.execute('test.s.write');await t.host.ui.update('test.s.main','count',7);await sleep(200);
 assert.deepEqual(await t.host.execute('test.s.settings'),{count:7,mode:'fast',missing:undefined,token:'s3cret'});
 assert.deepEqual(await t.host.execute('test.s.seen'),['extension','extension','user']);check('a change made in the native settings form is attributed to the user');
 await t.host.stop('s');t.rows[0].manifest={...t.rows[0].manifest,publisher:'Second'};await t.host.start('s');
 assert.deepEqual(await t.host.execute('test.s.settings'),{count:5,mode:'slow',missing:undefined,token:undefined});check('a package with the same ID from another publisher starts with empty settings and secrets');
 await t.close();

 // --- managed processes
 if(process.platform!=='win32'){
  const {ExtensionProcesses}=require('../../../electron/plugins/extensionProcesses.cjs'),job={},processes=new ExtensionProcesses({isActive:()=>true});
  const started=await processes.start(job,{file:'/bin/sh',args:['-c','sleep 6 & echo started'],timeoutMs:20000}),began=Date.now(),result=await processes.wait(job,started.id);
  assert.equal(result.code,0);assert.match(result.stdout,/started/);assert.ok(Date.now()-began<5000);
  check('a program that leaves a background child holding its output still returns its result');
 }
 console.log(`EXTENSION RELIABILITY OK (${checks.length} checks)`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>setTimeout(()=>process.exit(),500).unref());
