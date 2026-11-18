// Executed only by the native soak suite, with an isolated config/profile.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{app,utilityProcess,safeStorage}=require('electron');
const config=JSON.parse(fs.readFileSync(process.argv[2]));app.setPath('userData',path.join(config.directory,'user-data'));
app.whenReady().then(async()=>{
 const {PluginManager}=require('../../electron/plugins/manager.cjs'),{ExtensionRuntime}=require('../../electron/plugins/extensionRuntime.cjs'),manager=new PluginManager(path.join(config.directory,'plugins'),'2.0.0'),[row]=await manager.install(config.source,true);let forks=0;const host=new ExtensionRuntime({manager,safeStorage,utilityProcess:{fork(...args){forks++;return utilityProcess.fork(...args);}}}),samples=[],generations=new Set();
 try{
  await host.trust(row.key);
  for(let cycle=0;cycle<config.cycles;cycle++){
   const start=performance.now();await host.start(row.key);const activationMs=performance.now()-start,job=host.active.get(row.key);assert.ok(!generations.has(job.generation));generations.add(job.generation);
   assert.deepEqual(await host.execute('test.soak.cycle',{cycle}),{cycle});assert.equal(host.ui.list().length,1);assert.equal([...host.hooks.values()].reduce((n,owners)=>n+owners.size,0),1);
   const stopping=performance.now();await host.stop(row.key);const stopMs=performance.now()-stopping;await host.activate('startup');
   const counts={active:host.active.size,commands:host.commands.size,services:host.services.size,hooks:host.hooks.size,events:host.events.jobs.size,streams:host.streams.records.size,jobs:host.jobsHost.records.size,pending:host.pending.size,canceled:host.canceled.size,ui:host.ui.list().length};
   assert.ok(Object.values(counts).every(n=>n===0),JSON.stringify({cycle,counts}));assert.equal(forks,cycle+1);assert.equal(job.child.stdout,null);assert.equal(job.child.stderr,null);const nativeChildren=app.getAppMetrics().filter(metric=>metric.name==='ClipCraft extension: test.soak');assert.equal(nativeChildren.length,0,'No exited extension child remains in app process metrics');const memory=process.memoryUsage(),resources=process.getActiveResourcesInfo().reduce((all,name)=>(all[name]=(all[name]||0)+1,all),{});samples.push({cycle,activationMs,stopMs,...memory,resources,nativeChildren:nativeChildren.length,counts});
  }
  await host.dispose();fs.writeFileSync(path.join(config.directory,'result.json'),JSON.stringify({ok:true,cycles:config.cycles,forks,generations:generations.size,samples,environment:{electron:process.versions.electron,node:process.version,platform:process.platform,arch:process.arch}},null,2));app.exit(0);
 }catch(error){await host.dispose();throw error;}
}).catch(error=>{console.error(error);fs.writeFileSync(path.join(config.directory,'failure.json'),JSON.stringify({ok:false,error:error.stack}));app.exit(1);});
