const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {createHost}=require('../../fixtures/extensionRuntimeHarness.cjs');
const {ExtensionProcesses}=require('../../../electron/plugins/extensionProcesses.cjs');
(async()=>{
 const socket=net.createServer();socket.on('error',()=>{});const serverPort=await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
 const harness=createHost({fixture:{manifest:{id:'fixture.processes'},code:`let server;exports.activate=async c=>{
  await c.commands.register('binary',async()=>{const p=await c.processes.spawn({file:${JSON.stringify(process.execPath)},args:['-e',"process.stdout.write(Buffer.from([0,255,128]));setTimeout(()=>process.stderr.write('ok'),100)"],encoding:'bytes',output:'both'});const chunks=[];for await(const chunk of p.output)chunks.push({stream:chunk.stream,data:Array.from(chunk.data)});const result=await p.result;return {chunks,stdout:Array.from(result.stdout),stderr:Array.from(result.stderr)};});
  await c.commands.register('start',async()=>{server=await c.processes.startServer({file:${JSON.stringify(process.execPath)},args:['-e',"require('node:http').createServer((q,r)=>r.end('worker ready')).listen(${serverPort},'127.0.0.1')"],ready:{url:'http://127.0.0.1:${serverPort}'}});return {id:server.id,url:server.url};});
  await c.commands.register('ping',async()=>({body:await (await fetch(server.url)).text()}));
 };`}}),host=harness.host,processes=new ExtensionProcesses({isActive:job=>host.active.get(job.key)===job}),checks=[];
 host.invoke=async request=>{const job=host.active.get(request.key),args=request.args;if(request.method==='processes.start')return processes.start(job,args);if(request.method==='processes.serverStart')return processes.startServer(job,args);if(request.method==='processes.read')return processes.read(job,args.id);if(request.method==='processes.closeOutput')return processes.closeOutput(job,args.id);if(request.method==='processes.wait')return processes.wait(job,args.id);if(request.method==='processes.kill')return processes.kill(job,args.id);throw Error(request.method);};host.onStopped=job=>processes.stopped(job);
 try{
  await host.start('fixture');const binary=await host.execute('fixture.processes.binary',{});assert.deepEqual(binary.stdout,[0,255,128]);assert.deepEqual(binary.stderr,[111,107]);assert.deepEqual(binary.chunks.find(chunk=>chunk.stream==='stdout').data,[0,255,128]);checks.push('real worker transports binary capture and streamed typed arrays');
  const server=await host.execute('fixture.processes.start',{});assert.equal((await host.execute('fixture.processes.ping',{})).body,'worker ready');assert.equal(await (await fetch(server.url)).text(),'worker ready');checks.push('managed server survives the command that created it and a later command can use it');
  await host.stop('fixture');await assert.rejects(fetch(server.url));assert.equal(processes.records.size,0);checks.push('Stop revokes the real worker and closes its helper listener');
  await fs.writeFile(path.join(harness.dir,'streaming-result.json'),JSON.stringify({ok:true,checks},null,2));console.log('Worker process streaming verified: '+harness.dir);
 }finally{await host.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
