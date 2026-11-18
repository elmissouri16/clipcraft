// Adopted media is session-owned until a saved document makes it durable.
// Sweep only at process startup: histories, clipboard, exports and uncertain
// replies can all retain paths for the entire preceding editor session.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const NAME=/^[a-f0-9-]{36}\.[a-z0-9]+$/;
const stamp=stat=>({dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,birthtimeMs:stat.birthtimeMs});
const same=(a,b)=>Object.keys(a).every(key=>a[key]===b?.[key]);
async function readJson(file,limit=8192){
 const original=await fsp.lstat(file);if(!original.isFile()||original.isSymbolicLink())throw Error('Invalid media retention record');
 const handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('Invalid media retention record');const bytes=Buffer.alloc(stat.size+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead!==stat.size)throw Error('Media retention record changed');return JSON.parse(bytes.subarray(0,bytesRead).toString());}finally{await handle.close();}
}
async function directory(dir){try{const stat=await fsp.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid media retention directory');return await fsp.opendir(dir);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
class ExtensionMediaRetention{
 constructor(root,{autosaveRoot,recoveryFile}={}){this.autosaveRoot=autosaveRoot;this.recoveryFile=recoveryFile;this.root=root;this.owned=path.join(root,'owned');this.records=path.join(root,'ownership');this.snapshots=path.join(root,'references');this.session=crypto.randomUUID();this.queue=Promise.resolve();this.ready=this.sweep();}
 async write(file,value){await fsp.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+crypto.randomUUID()+'.tmp';try{await fsp.writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await fsp.rename(temporary,file);}finally{await fsp.rm(temporary,{force:true});}}
 run(work){const next=this.queue.then(()=>this.ready).then(work);this.queue=next.catch(()=>{});return next;}
 recordFile(name){if(!NAME.test(name))throw Error('Invalid owned media identity');return path.join(this.records,name+'.json');}
 track(file){return this.run(async()=>{if(path.dirname(file)!==this.owned)throw Error('Invalid owned media path');const stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid owned media file');await this.write(this.recordFile(path.basename(file)),{version:1,session:this.session,pinned:false,stamp:stamp(stat)});});}
 references(json){
  if(json==null)return [];
  if(typeof json!=='string')throw Error('Media retention requires serialized project data');
  if(!json.toLowerCase().includes(JSON.stringify(this.owned).slice(1,-1).toLowerCase())&&!/\\(?:u|\/)/.test(json))return [];
  return this.names(JSON.parse(json));
 }
 names(document){
  const pending=[document],names=new Set();
  while(pending.length){const value=pending.pop();if(typeof value==='string'){if(path.isAbsolute(value)&&path.dirname(path.resolve(value)).normalize('NFC').toLowerCase()===this.owned.normalize('NFC').toLowerCase()&&NAME.test(path.basename(value).toLowerCase()))names.add(path.basename(value).toLowerCase());}else if(value&&typeof value==='object')for(const child of Object.values(value))pending.push(child);}
  if(names.size>32768)throw Error('Too many retained media files');return [...names].sort();
 }
 snapshotFile(owner){if(typeof owner!=='string'||!owner||owner.length>160)throw Error('Invalid media reference owner');return path.join(this.snapshots,crypto.createHash('sha256').update(owner).digest('hex')+'.json');}
 async snapshot(owner){try{const data=await readJson(this.snapshotFile(owner),2*1024*1024);if(data.version!==1||data.owner!==owner||!Array.isArray(data.files)||data.files.length>32768||data.files.some(name=>!NAME.test(name)))throw Error('Invalid media references');return data.files;}catch(error){if(error.code==='ENOENT')return [];throw error;}}
 retain(json,write,{owner,durable=false,successful=value=>value!==false&&value!==null}={}){return this.run(async()=>{
  const names=this.references(json);
  if(durable)for(const name of names){let record;try{record=await readJson(this.recordFile(name));}catch(error){if(error.code==='ENOENT')continue;throw error;}if(!record.pinned)await this.write(this.recordFile(name),{...record,pinned:true});}
  let protectedFiles;
  if(owner){const previous=await this.snapshot(owner);protectedFiles=[...new Set([...previous,...names])].sort();if(protectedFiles.length>32768)throw Error('Too many retained media files');if(JSON.stringify(previous)!==JSON.stringify(protectedFiles))await this.write(this.snapshotFile(owner),{version:1,owner,files:protectedFiles});}
  // Protect both the old and new disk states before IO. A failed write or a lost
  // acknowledgement leaves a conservative union; only confirmed writes replace it.
  const result=await write();
  if(owner&&successful(result)&&JSON.stringify(protectedFiles)!==JSON.stringify(names))await this.write(this.snapshotFile(owner),{version:1,owner,files:names});
  return result;
 });}
 async sweep(){
  const report={removed:0,bytes:0,skipped:0,ok:true};this.report=report;
  try{
   // Projects without tracked extension sources need no recovery/slot scan.
   const owned=await directory(this.owned);if(!owned)return report;await owned.close();
   const journal=await directory(this.records);if(!journal)return report;await journal.close();
   const protectedNames=new Set(),snapshots=await directory(this.snapshots);
   if(snapshots)for await(const entry of snapshots){if(!entry.name.endsWith('.json'))continue;const file=path.join(this.snapshots,entry.name),data=await readJson(file,2*1024*1024);if(data.version!==1||!Array.isArray(data.files)||data.files.length>32768||data.files.some(name=>!NAME.test(name)))throw Error('Invalid media references');for(const name of data.files)protectedNames.add(name);if(protectedNames.size>100000)throw Error('Media reference limit reached');}
   // Reference journals are conservative guards, not the only source of truth.
   // Re-read authoritative recovery/slot files even when their journal is lost.
   if(this.recoveryFile){try{for(const name of this.names(await readJson(this.recoveryFile,128*1024*1024)))protectedNames.add(name);}catch(error){if(error.code!=='ENOENT')throw error;}}
   if(this.autosaveRoot){const slots=await directory(this.autosaveRoot);if(slots)for await(const entry of slots){if(!/^[A-Za-z0-9_-]{1,80}\.json$/.test(entry.name)||entry.name==='index.json')continue;for(const name of this.names(await readJson(path.join(this.autosaveRoot,entry.name),128*1024*1024)))protectedNames.add(name);if(protectedNames.size>100000)throw Error('Media reference limit reached');}}
   const records=await directory(this.records);if(!records)return report;
   for await(const entry of records){
    const name=entry.name.slice(0,-5);if(!entry.name.endsWith('.json')||!NAME.test(name)){report.skipped++;continue;}
    const metadata=this.recordFile(name),file=path.join(this.owned,name);
    try{
     const record=await readJson(metadata);if(record.version!==1||typeof record.pinned!=='boolean'||typeof record.session!=='string'||!record.stamp||!['dev','ino','size','mtimeMs','birthtimeMs'].every(key=>Number.isFinite(record.stamp[key]))){report.skipped++;continue;}
     if(record.pinned||record.session===this.session||protectedNames.has(name)){report.skipped++;continue;}
     // No await between checking the original file identity and unlinking it.
     let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code!=='ENOENT')throw error;await fsp.rm(metadata,{force:true});continue;}
     if(!stat.isFile()||stat.isSymbolicLink()||!same(record.stamp,stamp(stat))){report.skipped++;continue;}
     fs.unlinkSync(file);report.removed++;report.bytes+=stat.size;await fsp.rm(metadata,{force:true});
    }catch{report.skipped++;}
   }
  }catch(error){report.ok=false;report.error=error.message;}
  return report;
 }
}
module.exports={ExtensionMediaRetention};
