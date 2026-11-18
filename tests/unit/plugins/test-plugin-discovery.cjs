// Discovery deduplication must not become persistent integrity or authorization caching.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PluginManager}=require('../../../electron/plugins/manager.cjs');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-discovery-unit-')),source=path.join(dir,'source'),manager=new PluginManager(path.join(dir,'plugins'),'2.0.0'),checks=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS',name);};
 await fs.mkdir(path.join(source,'dist'),{recursive:true});await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'test.discovery',name:'Discovery fixture',publisher:'Test',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[{id:'run',name:'Run'}]}}));await fs.writeFile(path.join(source,'dist/extension.cjs'),'throw Error("Discovery must never evaluate code");');const [row]=await manager.install(source,true);
 const originalRead=manager.read.bind(manager);let reads=0;manager.read=async key=>{reads++;return originalRead(key);};
 const [one,two]=await Promise.all([manager.list(),manager.list()]);check('concurrent callers share verification',reads===1);one[0].manifest.name='Mutated consumer';one[0].enabled=false;check('consumers receive independent metadata',two[0].enabled&&two[0].manifest.name==='Discovery fixture');
 await manager.list();check('settled discovery is not cached',reads===2);
 reads=0;await Promise.all([manager.effects(),manager.transitions(),manager.fonts(),manager.sounds(),manager.creative(),manager.presets()]);check('parallel creative catalogs verify each installed payload once',reads===1);
 // Hold a pre-write snapshot. A later save must not lend its result to new reads.
 let entered,release;const started=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);let hold=true;
 manager.read=async key=>{if(hold){hold=false;entered();await barrier;}return originalRead(key);};
 const before=manager.list();await started;await manager.save([{key:row.key,enabled:false}]);const after=await manager.list();check('inventory publication invalidates in-flight discovery',after[0].enabled===false);release();assert.equal((await before)[0].enabled,true);check('old snapshot settlement cannot restore revoked discovery',(await manager.list())[0].enabled===false);await assert.rejects(manager.commandBundle(row.key),/disabled/);
 await manager.setEnabled(row.key,true);manager.read=originalRead;
 // Target lookup must not scan unrelated payloads or trust metadata from discovery.
 const other=path.join(dir,'other');await fs.cp(source,other,{recursive:true});const manifest=JSON.parse(await fs.readFile(path.join(other,'plugin.json')));manifest.id='test.unrelated';await fs.writeFile(path.join(other,'plugin.json'),JSON.stringify(manifest));await manager.install(other,true);await manager.list();
 manager.list=()=>{throw Error('Command lookup must not depend on discovery');};assert.equal((await manager.commandBundle(row.key)).key,row.key);check('target authorization does not scan other packages',true);
 const file=path.join(manager.root,row.key,'dist/extension.cjs');await fs.appendFile(file,'\n// tampered');await assert.rejects(manager.commandBundle(row.key),/integrity/);check('fresh command verification rejects modified bytes after discovery',true);
 delete manager.list;const corrupt=(await manager.list()).find(value=>value.key===row.key);check('later discovery notices modified payloads',!corrupt.enabled&&!!corrupt.error);
 const creative=await manager.install(path.resolve(__dirname,'../../../examples/plugins/color-pulse'),true),pack=creative.find(value=>value.manifest?.id==='clipcraft-examples.color-pulse');assert.equal((await manager.commandBundle(pack.key)).manifest.contributes.effects.length,1);check('creative preview bundles remain supported',true);
 const legacy=await manager.install(path.resolve(__dirname,'../../fixtures/plugins/legacy/chapter-markers'),true),old=legacy.find(value=>value.manifest?.id==='clipcraft-examples.chapter-markers');await assert.rejects(manager.commandBundle(old.key),/unavailable/);check('historical executable-only packages stay unavailable despite old inventory flags',true);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,checks},null,2));console.log('Discovery evidence: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
