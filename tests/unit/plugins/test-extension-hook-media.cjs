const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{ExtensionMedia}=require('../../../electron/plugins/extensionMedia.cjs'),{wav}=require('../../fixtures/extensionAudio.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-hook-media-')),job={},active=new Set([job]),media=new ExtensionMedia({root,isActive:job=>active.has(job),inspectFile:async()=>({type:'audio',duration:.5,width:0,height:0,hasAudio:true,hasVideo:false})});
 const create=()=>media.import(job,{bytes:wav(),name:'Staged audio.wav'}),artifact=await create();
 const [one,two]=await Promise.all([media.item(job,artifact.id,true,'one'),media.item(job,artifact.id,true,'two')]);assert.equal(one.path,two.path);await media.release(job,artifact.id);assert.equal(media.records.has(artifact.id),false);await media.releaseLease('one');await fs.access(one.path);await media.commitLease('two');await fs.access(one.path);
 const canceled=await create(),item=await media.item(job,canceled.id,true,'canceled');await media.releaseLease('canceled');await assert.rejects(fs.access(item.path));assert.ok((await media.item(job,canceled.id)).path.includes('pending'));
 const raced=await create(),staged=media.item(job,raced.id,true,'raced'),abort=media.releaseLease('raced'),normal=media.item(job,raced.id,true);await Promise.all([staged,abort]);const adopted=await normal;await fs.access(adopted.path);await media.release(job,raced.id);await fs.access(adopted.path);
 const stopped=await create(),pending=await media.item(job,stopped.id,true,'stopped');active.delete(job);await media.stopped(job);await media.releaseLease('stopped');await assert.rejects(fs.access(pending.path));assert.equal(media.leases.size,0);await fs.access(one.path);await fs.access(adopted.path);
 console.log('Staged media lease rollback, shared adoption, concurrent copy and stop cleanup passed: '+root);
})().catch(error=>{console.error(error);process.exitCode=1;});
