const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ProjectPersistence}=require('../../../electron/project/persistence.cjs');
const slots=require('../../../electron/project/autosave.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-persistence-')),file=path.join(dir,'project.json'),writer=new ProjectPersistence();
 try{
  const writes=Array.from({length:12},(_,n)=>writer.writeProject(file,JSON.stringify({id:'project',n})));
  await Promise.all(writes);assert.equal(JSON.parse(fs.readFileSync(file)).n,11,'queued writes remain ordered');assert.equal(fs.existsSync(file+'.part'),false);
  const root=path.join(dir,'slots');
  await Promise.all(Array.from({length:12},(_,n)=>writer.writeSlot(root,{id:'project',title:'Edit '+n,updatedAt:n+1,projectJson:JSON.stringify({id:'project',n})})));
  assert.equal(slots.readSlot(root,'project').project.n,11);assert.equal(slots.listSlots(root).length,1);
  await assert.rejects(writer.writeProject(path.join(dir,'missing','file.json'),'{}'),/ENOENT/);
  await writer.writeProject(file,'{"recovered":true}');assert.equal(JSON.parse(fs.readFileSync(file)).recovered,true,'one failed write does not poison later saves');
  assert.equal(await writer.writeSlot(root,{id:'../bad',projectJson:'{}'}),null,'slot path validation remains in force');
  console.log('Worker persistence keeps atomic ordered writes, slot roundtrips, validation and error recovery.');
 }finally{await writer.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
