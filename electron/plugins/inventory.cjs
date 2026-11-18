// Host-only inventory persistence and explicit, non-executing recovery.
const fs=require('node:fs/promises'),{constants}=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readFolder,validateFiles}=require('./package.cjs');
const KEY=/^[a-f0-9]{64}$/,UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',STAGING=new RegExp(`^(?:inventory-${UUID}\\.tmp|\\.install-[a-zA-Z0-9]{6})$`),LIMIT=1024*1024;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const recoveryError=message=>Object.assign(Error(message||'Plugin inventory needs recovery. Open Settings → Plugins → Review recovery.'),{code:'PLUGIN_INVENTORY_RECOVERY'});
async function diagnosticChildren(directory){
 const names=[];for await(const entry of await fs.opendir(directory)){if(names.length===64)break;names.push(entry.name);}return names.sort();
}
function inventoryRows(value){
 if(!Array.isArray(value)||value.length>1000||value.some(x=>!x||typeof x.key!=='string'||!KEY.test(x.key)||typeof x.enabled!=='boolean'||['removing','recovered'].some(k=>x[k]!==undefined&&typeof x[k]!=='boolean'))||new Set(value.map(x=>x.key)).size!==value.length)throw recoveryError('Invalid plugin inventory. Review recovery in Settings → Plugins.');
 return value.map(x=>({key:x.key,enabled:x.enabled&&!x.removing&&!x.recovered,...(x.removing?{removing:true}:{}),...(x.recovered?{recovered:true}:{})}));
}
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,stat.mode];
class InventoryStore{
 constructor(root,version){this.root=root;this.version=version;this.plan=null;}
 async rootSafe(create=false){
  if(create)await fs.mkdir(this.root,{recursive:true});
  try{const stat=await fs.lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink())throw recoveryError('Plugin folder is not a regular directory. Restore folder access before recovery.');return true;}
  catch(error){if(error.code==='ENOENT')return false;if(error.code==='PLUGIN_INVENTORY_RECOVERY')throw error;throw recoveryError('Plugin folder cannot be read. Restore folder access before recovery.');}
 }
 async entries(){
  if(!await this.rootSafe())return [];const entries=[];
  try{for await(const entry of await fs.opendir(this.root)){if(entries.length===4096)throw recoveryError('Too many entries in the plugin folder for bounded recovery.');entries.push(entry);}}
  catch(error){if(error.code==='PLUGIN_INVENTORY_RECOVERY')throw error;throw recoveryError('Plugin folder cannot be read. Restore folder access before recovery.');}
  return entries;
 }
 async snapshot(name){
  const file=path.join(this.root,name);let stat,handle;
  try{
   stat=await fs.lstat(file);const stamp=JSON.stringify(identity(stat));
   if(!stat.isFile()||stat.isSymbolicLink())return {name,kind:'unsafe',stamp};
   if(stat.size>LIMIT)return {name,kind:'oversized',stamp};
   handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   const bytes=Buffer.alloc(LIMIT+1);let count=0;
   while(count<bytes.length){const part=await handle.read(bytes,count,bytes.length-count,count);if(!part.bytesRead)break;count+=part.bytesRead;}
   if(count>LIMIT)return {name,kind:'oversized',stamp};
   const data=bytes.subarray(0,count),result={name,kind:'invalid',stamp:stamp+':'+hash(data),bytes:data};
   try{result.value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));result.rows=inventoryRows(result.value);result.kind='valid';}catch{}
   return result;
  }catch(error){if(error.code==='ENOENT')return {name,kind:'missing',stamp:'missing'};return {name,kind:'unreadable',stamp:JSON.stringify(stat?identity(stat):[error.code]),code:error.code};}
  finally{await handle?.close();}
 }
 async read(){
  await this.rootSafe();const state=await this.snapshot('inventory.json');
  if(state.kind==='valid')return state.rows;
  if(state.kind==='missing'&&!(await this.entries()).some(e=>KEY.test(e.name)||STAGING.test(e.name)||['inventory.backup.json','.recovery'].includes(e.name)))return [];
  throw recoveryError(state.kind==='unreadable'?'Plugin inventory cannot be read. Check file access and review recovery in Settings → Plugins.':state.kind==='invalid'?'Invalid plugin inventory. Review recovery in Settings → Plugins.':undefined);
 }
 async atomic(name,bytes){
  const temp=path.join(this.root,`inventory-${crypto.randomUUID()}.tmp`);
  try{const file=await fs.open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await fs.rename(temp,path.join(this.root,name));}
  finally{await fs.rm(temp,{force:true});}
 }
 async save(rows){
  rows=inventoryRows(rows);await this.rootSafe(true);const primary=await this.snapshot('inventory.json');
  if(!['valid','missing'].includes(primary.kind))throw recoveryError();
  // Keep the previous good index. Never overwrite an unreadable or damaged backup
  // silently; explicit recovery archives it before replacement.
  if(primary.kind==='valid'){const backup=await this.snapshot('inventory.backup.json');if(['valid','missing'].includes(backup.kind))await this.atomic('inventory.backup.json',primary.bytes);}
  await this.atomic('inventory.json',Buffer.from(JSON.stringify(rows,null,2)));
 }
 async scan(){
  const entries=(await this.entries()).sort((a,b)=>a.name.localeCompare(b.name)),primary=await this.snapshot('inventory.json'),backup=await this.snapshot('inventory.backup.json'),known=new Map();
  // A valid current index is authoritative. An older backup can contain a
  // successfully removed version; consult it only when the current index broke.
  for(const state of primary.kind==='valid'?[primary]:[backup,primary]){
   // Salvage only individually valid metadata from parseable damaged arrays.
   for(const row of state.rows||(Array.isArray(state.value)?state.value:[])){try{const [valid]=inventoryRows([row]),old=known.get(valid.key);known.set(valid.key,{key:valid.key,enabled:false,...(valid.removing||old?.removing?{removing:true}:{})});}catch{}}
  }
  const keys=[...new Set([...known.keys(),...entries.filter(e=>KEY.test(e.name)).map(e=>e.name)])].sort();if(keys.length>1000)throw recoveryError('Recovery exceeds the 1,000 installed-version limit. No files were changed.');
  const packages=[],archive=[],signatures=[];
  for(const key of keys){
   const file=path.join(this.root,key);let stat;
   try{stat=await fs.lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;}
   const row=known.get(key)||{key,enabled:false};
   if(!stat){packages.push({...row,status:row.removing?'removing':'unavailable',reason:'missing'});signatures.push([key,'missing']);continue;}
   if(!stat.isDirectory()||stat.isSymbolicLink()){packages.push({...row,status:known.has(key)?row.removing?'removing':'unavailable':'excluded',reason:'unsafe'});signatures.push([key,identity(stat)]);continue;}
   let bundle;
   try{bundle=await validateFiles(await readFolder(file),this.version);if(bundle.key!==key)throw Error('Fingerprint mismatch');}
   catch(error){packages.push({...row,status:row.removing?'removing':'unavailable',reason:'invalid'});archive.push(key);const children=await diagnosticChildren(file);signatures.push([key,identity(stat),await Promise.all(children.map(async name=>[name,identity(await fs.lstat(path.join(file,name)))]))]);continue;}
   const m=bundle.manifest;packages.push({...row,status:row.removing?'removing':'valid',name:m.name,id:m.id,version:m.version,publisher:m.publisher});signatures.push([key,bundle.key]);
  }
  for(const entry of entries.filter(e=>STAGING.test(e.name))){const stat=await fs.lstat(path.join(this.root,entry.name));signatures.push([entry.name,identity(stat)]);if(!stat.isSymbolicLink()&&(stat.isFile()||stat.isDirectory()))archive.push(entry.name);}
  const blocked=!['valid','invalid','missing'].includes(primary.kind)||!['valid','invalid','missing'].includes(backup.kind);
  const registered=new Set((primary.rows||[]).map(r=>r.key));
  const managed=entries.some(e=>KEY.test(e.name)||STAGING.test(e.name)||['inventory.backup.json','.recovery'].includes(e.name));
  const needed=primary.kind!=='valid'&&(managed||primary.kind!=='missing')||archive.length>0||packages.some(p=>p.reason!=='missing'&&!registered.has(p.key)||p.status==='excluded')||backup.kind==='invalid';
  const signature=hash(JSON.stringify([primary.stamp,backup.stamp,signatures]));
  return {primary,backup,packages,archive,blocked,needed,signature};
 }
 async prepare(){
  const state=await this.scan(),token=crypto.randomBytes(24).toString('hex');this.plan={token,signature:state.signature,expires:Date.now()+5*60*1000};
  return {token,state:state.primary.kind,needed:state.needed,blocked:state.blocked,packages:state.packages,archive:state.archive,backupState:state.backup.kind};
 }
 async archiveDirectory(){
  await this.rootSafe(true);const root=path.join(this.root,'.recovery');await fs.mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw recoveryError('Recovery archive folder is not a regular directory.');
  const id=crypto.randomUUID(),folder=path.join(root,id);await fs.mkdir(folder,{mode:0o700});return {id,folder};
 }
 async preserve(file,bytes){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
 async recover(token){
  const plan=this.plan;this.plan=null;
  if(!plan||typeof token!=='string'||token!==plan.token||plan.expires<Date.now())throw recoveryError('Recovery review expired. Review recovery again.');
  const state=await this.scan();if(state.signature!==plan.signature)throw recoveryError('Plugin files changed after review. Review recovery again.');
  if(state.blocked)throw recoveryError('Inventory access or file type prevents safe backup. Restore regular readable files before recovery.');
  if(!state.needed)throw recoveryError('No inventory recovery is needed.');
  const {id,folder}=await this.archiveDirectory();
  for(const file of [state.primary,state.backup])if(file.bytes)await this.preserve(path.join(folder,file.name),file.bytes);
  const rows=state.packages.filter(p=>p.status!=='excluded').map(p=>({key:p.key,enabled:false,recovered:true,...(p.removing?{removing:true}:{})}));
  await this.preserve(path.join(folder,'recovery.json'),Buffer.from(JSON.stringify({version:1,rows,archived:state.archive,at:new Date().toISOString()},null,2)));
  // Recheck immediately before publication; raw state is already preserved.
  if((await this.scan()).signature!==state.signature)throw recoveryError('Plugin files changed while preserving recovery state. Review recovery again.');
  await this.atomic('inventory.json',Buffer.from(JSON.stringify(rows,null,2)));
  await this.atomic('inventory.backup.json',Buffer.from(JSON.stringify(rows,null,2)));
  // Move only reviewed managed artifacts. Unknown root files and all panel data
  // stay untouched; invalid packages and uncommitted staging are preserved whole.
  for(const name of state.archive)await fs.rename(path.join(this.root,name),path.join(folder,name));
  return {archiveId:id,recovered:rows.length};
 }
 async archivePath(id){if(typeof id!=='string'||!new RegExp(`^${UUID}$`).test(id))throw recoveryError('Invalid recovery archive.');await this.rootSafe();const parent=path.join(this.root,'.recovery'),folder=path.join(parent,id);for(const item of [parent,folder]){const stat=await fs.lstat(item);if(!stat.isDirectory()||stat.isSymbolicLink())throw recoveryError('Recovery archive is unavailable.');}return folder;}
}
module.exports={InventoryStore,inventoryRows,recoveryError};
