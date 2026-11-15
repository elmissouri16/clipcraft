const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{PanelStorage,jsonValue}=require('../../../electron/plugins/panelStorage.cjs'),{PluginManager}=require('../../../electron/plugins/manager.cjs');
(async()=>{
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 const {validatePanel}=await import('../../../shared/pluginPanels.mjs');
 check('storage is a separate optional panel grant',()=>assert.deepEqual(validatePanel({id:'test',name:'Test',entry:'panel.html',permissions:['storage.local']}).permissions,['storage.local']));
 check('legacy read-only panel normalization is unchanged',()=>assert.deepEqual(validatePanel({id:'test',name:'Test',entry:'panel.html',permissions:['project.read']}),{id:'test',name:'Test',entry:'panel.html',permissions:['project.read']}));
 check('duplicate or unknown grants rejected',()=>{for(const permissions of [['storage.local','storage.local'],['filesystem']])assert.throws(()=>validatePanel({id:'test',name:'Test',entry:'panel.html',permissions}));});
 for(const value of [undefined,NaN,Infinity,BigInt(1),new Date(),Buffer.from('a'),()=>{},Array(2),{constructor:'x'},JSON.parse('{"__proto__":{}}'),{[Symbol('x')]:1}])check('non-JSON or unsafe data rejected',()=>assert.throws(()=>jsonValue(value)));
 const cyclic={};cyclic.self=cyclic;check('cycles rejected',()=>assert.throws(()=>jsonValue(cyclic)));
 let deep={};for(let i=0;i<18;i++)deep={deep};check('deep values rejected',()=>assert.throws(()=>jsonValue(deep)));
 check('large values and node budgets rejected',()=>{assert.throws(()=>jsonValue('x'.repeat(16384)));assert.throws(()=>jsonValue(Array(2049).fill(0)));});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-panel-storage-unit-'));
 try{
  const manager=new PluginManager(root,'2.0.0'),store=manager.panelStorage,key='a'.repeat(64),other='b'.repeat(64),panel='test';let active=true,verifyCalls=0;
  const verify=async()=>{verifyCalls++;if(!active)throw Error('/private/hidden/path unavailable');};
  const op=(method,args={},k=key,p=panel)=>store.execute(k,p,method,args,verify);
  assert.deepEqual(await op('get',{key:'missing'}),{ok:true,value:null});checks++;
  const sample={note:'Saved 🪄',count:7,enabled:true,extra:[null,1]};assert.equal((await op('set',{key:'preferences',value:sample})).ok,true);checks++;
  check('fresh service reads committed data after restart',()=>assert.ok(new PanelStorage(manager)));
  assert.deepEqual(await new PanelStorage(manager).execute(key,panel,'get',{key:'preferences'},verify),{ok:true,value:sample});checks++;
  assert.deepEqual(await op('keys'),{ok:true,value:['preferences']});checks++;
  assert.deepEqual(await op('get',{key:'preferences'},other),{ok:true,value:null});checks++;
  assert.deepEqual(await op('get',{key:'preferences'},key,'other-panel'),{ok:true,value:null});checks++;
  for(const args of [{key:'../path',value:1},{key:'constructor',value:1},{key:'valid',value:undefined},{key:'valid',value:1,namespace:other}]){assert.equal((await op('set',args)).ok,false);checks++;}
  const failed=await op('set',{key:'preferences',value:'x'.repeat(16384)});check('quota failure preserves the previous value',()=>assert.equal(failed.ok,false));assert.deepEqual((await op('get',{key:'preferences'})).value,sample);checks++;
  await op('clear');for(const key of ['a','b','c','d'])assert.equal((await op('set',{key,value:'x'.repeat(16000)})).ok,true);assert.equal((await op('set',{key:'e',value:'x'.repeat(16000)})).ok,false);check('total quota cannot exceed 64 KiB',()=>{});
  await op('clear');await Promise.all(Array.from({length:64},(_,i)=>op('set',{key:'k'+i,value:i})));assert.equal((await op('keys')).value.length,64);assert.equal((await op('set',{key:'overflow',value:1})).ok,false);checks++;
  assert.equal((await op('remove',{key:'k0'})).ok,true);assert.equal((await op('get',{key:'k0'})).value,null);checks++;
  // Revoke at the final verification, after the temp file exists but before rename.
  await op('clear');await op('set',{key:'preferences',value:sample});let calls=0;
  const closed=await store.execute(key,panel,'set',{key:'preferences',value:'late'},async()=>{if(++calls===3)throw Error('Closed');});
  check('closure before publication rolls back a staged write',()=>assert.equal(closed.ok,false));assert.deepEqual((await op('get',{key:'preferences'})).value,sample);checks++;
  const folder=path.join(root,'.panel-storage',key);assert.deepEqual((await fs.readdir(folder)).filter(n=>n.endsWith('.tmp')),[]);checks++;
  active=false;const revoked=await op('get',{key:'preferences'});check('revoked operations expose no filesystem paths',()=>assert.deepEqual(revoked,{ok:false,error:'Plugin storage is unavailable.'}));active=true;
  await fs.writeFile(path.join(folder,'test.json'),'{bad json');assert.equal((await op('get',{key:'preferences'})).ok,false);await op('clear');assert.equal((await op('get',{key:'preferences'})).value,null);check('explicit clear recovers malformed saved data',()=>{});
  const secret=path.join(root,'outside.json');await fs.writeFile(secret,'private');await fs.symlink(secret,path.join(folder,'test.json'));assert.equal((await op('get',{key:'preferences'})).ok,false);await op('clear');assert.equal(await fs.readFile(secret,'utf8'),'private');check('symlink reads and clear cannot reach another file',()=>{});
  await op('set',{key:'kept',value:1});await store.clearVersion(key);assert.equal((await op('get',{key:'kept'})).value,null);checks++;
  await fs.rm(path.join(root,'.panel-storage',other),{recursive:true,force:true});await fs.symlink(root,path.join(root,'.panel-storage',other));assert.equal((await op('set',{key:'x',value:1},other)).ok,false);check('symlink namespace is rejected',()=>{});
  check('operations repeatedly verify their live owner',()=>assert.ok(verifyCalls>10));
  // Real manager lifecycle: disabling retains data, exact-version removal deletes it.
  const example=path.resolve(__dirname,'../../../examples/plugins/project-dashboard');await manager.install(example,true);const row=(await manager.panels()).find(p=>p.id==='dashboard');
  const approved=()=>manager.panelBundle(row.key,row.id);
  assert.equal((await store.execute(row.key,row.id,'set',{key:'note',value:'retained'},approved)).ok,true);await manager.setEnabled(row.key,false);
  assert.equal((await store.execute(row.key,row.id,'get',{key:'note'},approved)).ok,false);await manager.setEnabled(row.key,true);assert.equal((await store.execute(row.key,row.id,'get',{key:'note'},approved)).value,'retained');check('disabled versions retain data but lose access',()=>{});
  await manager.clearPanelStorage(row.key);assert.equal((await store.execute(row.key,row.id,'get',{key:'note'},approved)).value,null);checks++;
  await store.execute(row.key,row.id,'set',{key:'note',value:'removed'},approved);await manager.remove(row.key);await assert.rejects(fs.stat(path.join(root,'.panel-storage',row.key)),{code:'ENOENT'});check('removing a version deletes its namespace',()=>{});
  console.log(JSON.stringify({ok:true,checks}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
