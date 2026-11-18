// Managed publication for trusted Node extensions. Default publication never
// overwrites. Filesystems without hard links use an exclusive, cancellable copy.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform,Writable}=require('node:stream');
const canceled=()=>Object.assign(Error('Extension file publication canceled'),{name:'AbortError'});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameSource=(a,b)=>same(a,b)&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const missing=async file=>{try{return await fsp.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
class ExtensionFiles{
 constructor({isActive,limit=512*1024*1024,timeoutMs=300000}){Object.assign(this,{isActive,limit,timeoutMs});this.records=new Set();}
 assert(record){if(record.controller.signal.aborted||!this.isActive(record.job))throw canceled();record.verify?.();}
 async copy(record,source,file){
  const hash=crypto.createHash('sha256');let bytes=0;
  await pipeline(source.createReadStream({autoClose:false}),new Transform({transform:(chunk,_encoding,next)=>{bytes+=chunk.length;if(bytes>this.limit){next(Error('File exceeds the publication limit'));return;}hash.update(chunk);next(null,chunk);}}),fs.createWriteStream(file,{flags:'wx',mode:0o600}),{signal:record.controller.signal});
  record.bytes=bytes;record.sha256=hash.digest('hex');
 }
 async exclusiveCopy(record,source,target){
  const sink=new Writable({write:(chunk,_encoding,next)=>{
   const write=async()=>{let offset=0;while(offset<chunk.length){this.assert(record);const {bytesWritten}=await target.write(chunk,offset,chunk.length-offset,null);if(!bytesWritten)throw Error('File write made no progress');offset+=bytesWritten;}};
   write().then(()=>next(),next);
  }});
  await pipeline(fs.createReadStream(source),sink,{signal:record.controller.signal});
 }
 async publish(job,args,{signal,verify}={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['token','path','destination','overwrite'].includes(key))||typeof args.token!=='string'||!/^\d{1,16}$/.test(args.token)||['path','destination'].some(key=>typeof args[key]!=='string'||!path.isAbsolute(args[key])||args[key].length>32768||args[key].includes('\0'))||args.overwrite!==undefined&&typeof args.overwrite!=='boolean')throw Error('Provide absolute source and destination paths');
  if(this.records.size>=4||[...this.records].filter(record=>record.job===job).length>=2)throw Error('Too many file publications');
  if([...this.records].some(record=>record.job===job&&record.token===args.token))throw Error('Duplicate file publication');
  const controller=new AbortController(),record={job,token:args.token,controller,verify,published:false};let done;record.done=new Promise(resolve=>{done=resolve;});this.records.add(record);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,this.timeoutMs);let source,target;
  try{
   this.assert(record);const sourceStat=await fsp.lstat(args.path);if(!sourceStat.isFile()||sourceStat.size<1||sourceStat.size>this.limit)throw Error('Choose a nonempty regular file within the publication limit');
   source=await fsp.open(args.path,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));record.sourceStat=await source.stat();if(!record.sourceStat.isFile()||!sameSource(sourceStat,record.sourceStat))throw Error('Source changed before publication');
   const parent=await fsp.realpath(path.dirname(args.destination)),name=path.basename(args.destination);if(!name||name==='.'||name==='..')throw Error('Choose a file destination');record.destination=path.join(parent,name);
   const prior=await missing(record.destination);if(prior&&(!prior.isFile()||same(prior,record.sourceStat)))throw Error('Destination must not replace the source, a link or a directory');if(prior&&!args.overwrite)throw Error('Destination exists; choose a new filename');
   record.directory=await fsp.mkdtemp(path.join(parent,'.clipcraft-publish-'));const staged=path.join(record.directory,'payload');await this.copy(record,source,staged);this.assert(record);
   if(!sameSource(record.sourceStat,await source.stat()))throw Error('Source changed while copying');
   const stagedHandle=await fsp.open(staged,'r');try{await stagedHandle.sync();}finally{await stagedHandle.close();}
   this.assert(record);
   // Staging is private (0600). The published file gets ordinary permissions: the ones a new file
   // would have, or those of the file it replaces.
   const publicMode=0o666&~process.umask();
   if(args.overwrite){
    let current;try{current=fs.lstatSync(record.destination);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(current&&(!current.isFile()||same(current,record.sourceStat)))throw Error('Destination changed to a source, link or directory');
    fs.chmodSync(staged,current?current.mode&0o777:publicMode);
    fs.renameSync(staged,record.destination);record.published=true;record.atomic=true;
   }else{
    fs.chmodSync(staged,publicMode);
    try{fs.linkSync(staged,record.destination);record.published=true;record.atomic=true;}
    catch(error){
     if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(error.code))throw error;
     this.assert(record);target=await fsp.open(record.destination,'wx',publicMode);record.owned=await target.stat();this.assert(record);
     // FAT and exFAT give a file a new identity once it has data, so identify it after writing.
     await this.exclusiveCopy(record,staged,target);await target.sync();record.owned=await target.stat();await target.close();target=null;
     this.assert(record);const current=fs.lstatSync(record.destination);if(!same(current,record.owned))throw Error('Destination changed during publication');record.published=true;record.atomic=false;
    }
   }
   record.result={path:record.destination,bytes:record.bytes,sha256:record.sha256,atomic:record.atomic};return record.result;
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);if(target)record.owned=await target.stat().catch(()=>record.owned);await target?.close().catch(()=>{});await source?.close().catch(()=>{});
   if(!record.published&&record.owned){try{const current=await fsp.lstat(record.destination);if(same(current,record.owned))await fsp.unlink(record.destination);}catch(error){if(error.code!=='ENOENT')console.error('Incomplete extension file cleanup failed:',error.message);}}
   try{if(record.directory)await fsp.rm(record.directory,{recursive:true,force:true});}
   catch(error){if(record.result)record.result.warning='File published; temporary-file cleanup failed: '+error.message;else console.error('Extension publication staging cleanup failed:',error.message);}
   finally{this.records.delete(record);done();}
  }
 }
 cancel(job,token){const record=[...this.records].find(record=>record.job===job&&record.token===token);if(!record||record.published)return false;record.controller.abort();return true;}
 async stopped(job){const records=[...this.records].filter(record=>record.job===job);for(const record of records)if(!record.published)record.controller.abort();await Promise.all(records.map(record=>record.done));}
}
module.exports={ExtensionFiles};
