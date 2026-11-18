// Creative preset tests retain native owner, generation and publication boundaries.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {PluginManager}=require('../../../electron/plugins/manager.cjs'),{DevelopmentSessions}=require('../../../electron/plugins/development.cjs'),{AuthoringTests}=require('../../../electron/plugins/authoring.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-authoring-')),owner=new EventEmitter();owner.isDestroyed=()=>false;
 const manager=new PluginManager(path.join(root,'inventory'),'2.0.0'),dev=new DevelopmentSessions(manager),checks=[];manager.development=dev;const service=new AuthoringTests({development:dev,getWindow:()=>({webContents:owner})});manager.authoring=service;const check=name=>{checks.push(name);console.log('PASS',name);};
 try{
  const source=path.join(root,'source');await fs.cp(path.resolve(__dirname,'../../../examples/plugins/review-copy'),source,{recursive:true});const state=await dev.start(source),key=state.session.key,id=state.session.manifest.contributes.exportPresets[0].id;
  assert.equal(state.session.status,'ready');assert.deepEqual(await manager.presets(),[]);assert.equal(service.provider,undefined);check('temporary creative declarations never join installed presets or expose retired provider execution');
  const exported=service.export({key,id});assert.equal(service.verify(exported.token,owner).key,key);assert.throws(()=>service.export({key,id}),/Finish or cancel/);assert.throws(()=>service.verify(exported.token,new EventEmitter()),/canceled/);await dev.reload();assert.throws(()=>service.verify(exported.token,owner),/canceled/);check('author export is owner-bound, exclusive and revoked by reload');
  assert.throws(()=>service.export({key,id}),/no longer active/);assert.throws(()=>service.export({key:dev.snapshot().session.key,id:'unknown'}),/declared/);check('retired snapshots and unknown contributions cannot authorize exports');
  const last=service.export({key:dev.snapshot().session.key,id});owner.emit('did-start-navigation');assert.throws(()=>service.verify(last.token,owner),/canceled/);assert.equal(owner.listenerCount('destroyed'),0);check('navigation cancels tests and removes owner listeners');
  const next=service.export({key:dev.snapshot().session.key,id});assert.equal(service.finish(next.token),true);assert.equal(service.finish(next.token),false);assert.throws(()=>service.verify(next.token,owner),/canceled/);assert.deepEqual(await manager.list(),[]);check('explicit finish is idempotent and leaves no installed identities');
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify({ok:true,checks:checks.length,passed:checks},null,2));console.log('Evidence: '+root);
 }finally{dev.dispose();service.revoke();}
})().catch(error=>{console.error(error);process.exitCode=1;});
