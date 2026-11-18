const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-streams-'));
 const provider=path.join(dir,'provider'),consumer=path.join(dir,'consumer');
 for(const [source,id] of [[provider,'studio.producer'],[consumer,'studio.consumer']]){await fs.mkdir(path.join(source,'dist'),{recursive:true});await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id,name:id,publisher:'ClipCraft fixture',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',activationEvents:['startup'],contributes:{}}));}
 await fs.writeFile(path.join(provider,'dist/extension.cjs'),`exports.activate=async c=>{await c.services.register('output',{
  ordinary:(input,{signal})=>({input,signal:typeof signal.aborted}),
  async *chunks(){for(let i=0;i<3;i++)yield {index:i}},
  async *map(){yield new Map([['unsupported',1]])},
  async *binary(){const bytes=new Uint8Array(4*1024*1024);bytes[0]=12;bytes[1]=23;yield bytes.subarray(0,2)},
  async *large(){yield 'x'.repeat(1024*1024+1)},
  async *failure(){yield 'first';throw Error('stream fixture failure')},
  async *slow(_input,{signal}){try{yield 'started';await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}finally{await c.configuration.update({key:'closed',value:true});}},
  async canceled(_input,{signal}){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await c.configuration.update({key:'requestClosed',value:true});return true;}
 });};`);
 await fs.writeFile(path.join(consumer,'dist/extension.cjs'),`exports.activate=async c=>{
  await c.commands.register('collect',async()=>{const values=[];for await(const chunk of c.services.stream('studio.producer.output','chunks'))values.push(chunk);return values;});
  await c.commands.register('break',async()=>{for await(const chunk of c.services.stream('studio.producer.output','slow'))break;return true;});
  await c.commands.register('binary',async()=>{for await(const chunk of c.services.stream('studio.producer.output','binary'))return {values:[...chunk],bufferBytes:chunk.buffer.byteLength};});
  await c.commands.register('map',async()=>{for await(const chunk of c.services.stream('studio.producer.output','map')){};});
  await c.commands.register('large',async()=>{for await(const chunk of c.services.stream('studio.producer.output','large')){};});
  await c.commands.register('failure',async()=>{for await(const chunk of c.services.stream('studio.producer.output','failure')){};});
  await c.commands.register('pending',async()=>{for await(const chunk of c.services.stream('studio.producer.output','slow')){};});
  await c.commands.register('request',()=>c.services.call('studio.producer.output','canceled'));
  await c.commands.register('process',async()=>{const child=await c.processes.spawn({file:${JSON.stringify(process.execPath)},args:['-e','process.stdout.write("managed from Node extension")']});return child.result;});
 };`);
 const script=path.join(dir,'runner.cjs');await fs.writeFile(script,`
const {app,utilityProcess,safeStorage}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
app.whenReady().then(async()=>{
 const manager=new (require(${JSON.stringify(path.join(root,'electron/plugins/manager.cjs'))}).PluginManager)(${JSON.stringify(path.join(dir,'plugins'))},'2.0.0');
 await manager.install(${JSON.stringify(provider)},true);await manager.install(${JSON.stringify(consumer)},true);const rows=await manager.list(),pk=rows.find(r=>r.manifest.id==='studio.producer').key,ck=rows.find(r=>r.manifest.id==='studio.consumer').key;
 const host=new (require(${JSON.stringify(path.join(root,'electron/plugins/extensionRuntime.cjs'))}).ExtensionRuntime)({manager,utilityProcess,safeStorage}),processes=new (require(${JSON.stringify(path.join(root,'electron/plugins/extensionProcesses.cjs'))}).ExtensionProcesses)({isActive:j=>host.active.get(j.key)===j});
 host.onStopped=j=>processes.stopped(j).catch(()=>{});host.invoke=r=>{const job=host.active.get(r.key);if(r.method==='processes.start')return processes.start(job,r.args);if(r.method==='processes.wait')return processes.wait(job,r.args.id);if(r.method==='processes.kill')return processes.kill(job,r.args.id);throw Error(r.method);};
 await host.trust(pk);await host.trust(ck);await host.start(pk);await host.start(ck);const checks=[];
 assert.deepEqual(await host.execute('studio.consumer.collect',{}),[{index:0},{index:1},{index:2}]);assert.equal(host.streams.records.size,0);checks.push('pull-based cross-extension streams preserve order and close on completion');
 const ordinary=await host.call(host.active.get(ck),'services.call',{id:'studio.producer.output',method:'ordinary',input:42});assert.deepEqual(ordinary,{input:42,signal:'boolean'});checks.push('ordinary services receive a cancellation context');
 await host.execute('studio.consumer.break',{});assert.equal(await host.call(host.active.get(pk),'configuration.get','closed'),true);assert.equal(host.streams.records.size,0);checks.push('breaking iteration runs the provider finalizer');
 assert.deepEqual(await host.execute('studio.consumer.binary',{}),{values:[12,23],bufferBytes:2});await assert.rejects(host.execute('studio.consumer.map',{}),/plain data/);checks.push('binary views are copied without transferring oversized backing buffers; unsupported objects are rejected');
 await assert.rejects(host.execute('studio.consumer.large',{}),/exceeds 1 MiB/);await assert.rejects(host.execute('studio.consumer.failure',{}),/stream fixture failure/);assert.equal(host.streams.records.size,0);checks.push('oversized chunks and provider errors reject without leaking stream handles');
 const processResult=await host.execute('studio.consumer.process',{});assert.equal(processResult.code,0);assert.equal(processResult.stdout,'managed from Node extension');checks.push('Node SDK starts and awaits a real managed subprocess');
 const pending=host.execute('studio.consumer.pending',{});pending.catch(()=>{});for(let i=0;i<100&&![...host.streams.records.values()].some(r=>r.busy);i++)await new Promise(r=>setTimeout(r,10));assert.ok([...host.streams.records.values()].some(r=>r.busy));await host.stop(ck);await assert.rejects(pending,/stopped|exited/);for(let i=0;i<100&&host.streams.records.size;i++)await new Promise(r=>setTimeout(r,10));assert.equal(host.streams.records.size,0);assert.ok(host.active.get(pk));checks.push('consumer shutdown cancels pending stream reads without stopping the provider');
 await host.start(ck);const request=host.execute('studio.consumer.request',{});request.catch(()=>{});for(let i=0;i<100&&![...host.pending.values()].some(r=>r.owner?.key===ck);i++)await new Promise(r=>setTimeout(r,10));assert.ok([...host.pending.values()].some(r=>r.owner?.key===ck));await host.stop(ck);await assert.rejects(request,/stopped|exited/);for(let i=0;i<100&&!(await host.call(host.active.get(pk),'configuration.get','requestClosed'));i++)await new Promise(r=>setTimeout(r,10));assert.equal(await host.call(host.active.get(pk),'configuration.get','requestClosed'),true);checks.push('consumer shutdown signals cancellation to ordinary service requests');
 await host.dispose();await fs.writeFile(${JSON.stringify(path.join(dir,'result.json'))},JSON.stringify({ok:true,checks},null,2));app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});`);
 const child=spawn(require('electron'),[script],{env:{...process.env,NODE_PATH:path.join(root,'node_modules')},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>child.kill('SIGKILL'),45000);const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);assert.equal(code,0,log);assert.ok(JSON.parse(await fs.readFile(path.join(dir,'result.json'))).ok);console.log('Native extension streaming verified: '+dir);
})().catch(e=>{console.error(e);process.exitCode=1;});
