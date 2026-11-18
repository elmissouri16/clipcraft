// Recovery must bound enumeration before allocating arrays or sampling children.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PluginManager}=require('../../../electron/plugins/manager.cjs');
let directory;const checks=[],observations={};
async function virtualEntries(target,count,run,{eagerAllowed=false}={}){
 const readdir=fs.readdir,opendir=fs.opendir,stats={eager:0,opened:0,closed:0,yielded:0,perScan:[]};
 const entry=index=>({name:'child-'+String(index).padStart(6,'0')+'.txt',isFile:()=>true,isDirectory:()=>false});
 fs.readdir=async(file,...args)=>{if(file!==target)return readdir(file,...args);stats.eager++;if(!eagerAllowed)throw Error('Recovery must not collect an eager child array');stats.yielded+=count;return Array.from({length:count},(_,i)=>entry(i));};
 fs.opendir=async(file,...args)=>{if(file!==target)return opendir(file,...args);stats.opened++;return (async function*(){let yielded=0;try{for(let i=0;i<count;i++){stats.yielded++;yielded++;yield entry(i);}}finally{stats.closed++;stats.perScan.push(yielded);}})();};
 try{await run(stats);assert.equal(stats.opened,stats.closed,'every iterator closes');return stats;}finally{fs.readdir=readdir;fs.opendir=opendir;}
}
(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-recovery-enumeration-'));
 const crowded=path.join(directory,'crowded'),manager=new PluginManager(crowded,'2.0.0');await fs.mkdir(crowded);await fs.writeFile(path.join(crowded,'keep.txt'),'Original unrelated file');
 observations.rootOverflow=await virtualEntries(crowded,4200,async stats=>{await assert.rejects(manager.prepareRecovery(),error=>error.code==='PLUGIN_INVENTORY_RECOVERY'&&/Too many entries/.test(error.message));assert.equal(stats.yielded,4097,'stop at the first excess entry');assert.equal(stats.eager,0);},{eagerAllowed:true});
 assert.deepEqual(await fs.readdir(crowded),['keep.txt']);assert.equal(await fs.readFile(path.join(crowded,'keep.txt'),'utf8'),'Original unrelated file');checks.push('root overflow stops at entry 4097, closes enumeration and writes nothing');
 observations.exactRoot=await virtualEntries(crowded,4096,async stats=>{assert.equal((await manager.inventoryStore.entries()).length,4096);assert.equal(stats.yielded,4096);assert.equal(stats.eager,0);},{eagerAllowed:true});checks.push('the exact 4096-entry root boundary is accepted');
 const broken=path.join(directory,'broken'),key='a'.repeat(64),payload=path.join(broken,key),recovery=new PluginManager(broken,'2.0.0');await fs.mkdir(payload,{recursive:true});for(let i=0;i<64;i++)await fs.writeFile(path.join(payload,'child-'+String(i).padStart(6,'0')+'.txt'),'Retained '+i);
 observations.invalidPackage=await virtualEntries(payload,100000,async stats=>{
  const review=await recovery.prepareRecovery();assert.equal(review.needed,true);assert.equal(review.packages[0].reason,'invalid');assert.equal(stats.yielded,65,'sample at most 64 names plus a stopping entry');
  const changed=path.join(payload,'child-000000.txt');await fs.appendFile(changed,' changed');await assert.rejects(recovery.recover(review.token),/changed after review/);await assert.rejects(fs.stat(path.join(broken,'inventory.json')),{code:'ENOENT'});
  const fresh=await recovery.prepareRecovery(),result=await recovery.recover(fresh.token),archive=await recovery.inventoryStore.archivePath(result.archiveId);assert.equal((await fs.readdir(path.join(archive,key))).length,64);assert.equal(await fs.readFile(path.join(archive,key,'child-000000.txt'),'utf8'),'Retained 0 changed');assert.deepEqual(await recovery.inventory(),[{key,enabled:false,recovered:true}]);assert.ok(stats.perScan.every(n=>n<=65));assert.equal(stats.eager,0);
 });checks.push('invalid-package diagnostics sample bounded entries, reject changed reviews and preserve the whole directory');
 const opendir=fs.opendir;fs.opendir=async(file,...args)=>{if(file===crowded)throw Object.assign(Error('Injected enumeration access failure'),{code:'EACCES'});return opendir(file,...args);};try{await assert.rejects(manager.prepareRecovery(),error=>error.code==='PLUGIN_INVENTORY_RECOVERY'&&/cannot be read/.test(error.message));}finally{fs.opendir=opendir;}assert.deepEqual(await fs.readdir(crowded),['keep.txt']);checks.push('enumeration access failure remains fail-closed without mutations');
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks,observations},null,2));console.log('Recovery enumeration verified: '+directory);
})().catch(async error=>{if(directory)await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:false,error:error.stack,checks,observations},null,2));console.error(error);console.error('Recovery enumeration evidence: '+directory);process.exitCode=1;});
