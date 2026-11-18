const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {readRegularFile}=require('./package.cjs');
const LIMITS=Object.freeze({value:16*1024,total:64*1024,keys:64,depth:16,nodes:2048});
class StorageError extends Error{}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const keyValid=key=>typeof key==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(key)&&!['__proto__','prototype','constructor'].includes(key);
function jsonValue(value){
 let nodes=0;const seen=new Set();
 const visit=(v,depth)=>{
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)throw new StorageError('Storage value is too complex.');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v!=='object'||(!Array.isArray(v)&&!plain(v))||seen.has(v))throw new StorageError('Storage accepts only JSON data.');
  if(Object.getOwnPropertySymbols(v).length)throw new StorageError('Storage accepts only JSON data.');
  seen.add(v);for(const [key,item] of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(key))throw new StorageError('Reserved storage property.');visit(item,depth+1);}seen.delete(v);
  if(Array.isArray(v)&&(Object.keys(v).length!==v.length||!Object.keys(v).every((key,index)=>key===String(index))))throw new StorageError('Storage arrays must be dense.');
 };
 visit(value,0);const json=JSON.stringify(value);if(Buffer.byteLength(json)>LIMITS.value)throw new StorageError('Storage value exceeds 16 KiB.');return JSON.parse(json);
}
function encoded(values){
 if(!plain(values)||Object.keys(values).length>LIMITS.keys)throw new StorageError('Storage supports at most 64 keys.');
 for(const [key,value] of Object.entries(values)){if(!keyValid(key))throw new StorageError('Invalid storage key.');jsonValue(value);}
 const json=JSON.stringify({version:1,values});if(Buffer.byteLength(json)>LIMITS.total)throw new StorageError('Storage quota exceeds 64 KiB.');return json;
}
class PanelStorage{
 constructor(manager){this.manager=manager;this.root=path.join(manager.root,'.panel-storage');}
 async folder(key,create=false){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw new StorageError('Invalid storage namespace.');
  const folder=path.join(this.root,key);
  for(const dir of [this.root,folder]){
   if(create)await fs.mkdir(dir,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
   let stat;try{stat=await fs.lstat(dir);}catch(error){if(error.code==='ENOENT')return null;throw error;}
   if(!stat.isDirectory()||stat.isSymbolicLink())throw new StorageError('Storage location is unavailable.');
  }
  return folder;
 }
 async read(file){
  try{
   const bytes=await readRegularFile(file,LIMITS.total,'Saved storage'),data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!plain(data)||Object.keys(data).sort().join(',')!=='values,version'||data.version!==1)throw new Error('Invalid format');
   encoded(data.values);return data.values;
  }catch(error){if(error.code==='ENOENT')return {};throw new StorageError('Saved storage cannot be read. Clear saved data to reset it.');}
 }
 async execute(key,panelId,method,args,verify){
  try{return await this.manager.mutate(async()=>{
   if(typeof panelId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(panelId))throw new StorageError('Invalid storage namespace.');
   const allowed=method==='set'?['key','value']:['get','remove'].includes(method)?['key']:[];
   if(!plain(args)||Object.keys(args).some(k=>!allowed.includes(k))||(['get','set','remove'].includes(method)&&!keyValid(args.key))||!['get','set','remove','keys','clear'].includes(method))throw new StorageError('Invalid storage request.');
   const value=method==='set'?jsonValue(args.value):null;
   await verify();const folder=await this.folder(key,true),file=path.join(folder,panelId+'.json');
   if(method==='clear'){await verify();await fs.rm(file,{force:true});return {ok:true,value:true};}
   const values=await this.read(file);await verify();
   if(method==='get')return {ok:true,value:Object.hasOwn(values,args.key)?values[args.key]:null};
   if(method==='keys')return {ok:true,value:Object.keys(values)};
   if(method==='set')values[args.key]=value;else delete values[args.key];
   const json=encoded(values),temp=path.join(folder,`.write-${crypto.randomUUID()}.tmp`);
   try{
    await fs.writeFile(temp,json,{flag:'wx',mode:0o600});
    await verify(); // Closure/revocation before publication cannot persist a late write.
    await fs.rename(temp,file);
   }finally{await fs.rm(temp,{force:true});}
   return {ok:true,value:true};
  });}catch(error){return {ok:false,error:error instanceof StorageError?error.message:'Plugin storage is unavailable.'};}
 }
 async clearVersion(key){const folder=await this.folder(key);if(folder)await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={PanelStorage,LIMITS,jsonValue,encoded};
