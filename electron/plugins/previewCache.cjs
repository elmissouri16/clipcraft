// Only replayable preview files are disposable. Project-owned pack-sounds are never cache candidates.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const FILE=/^[a-f0-9]{64}-[a-z][a-z0-9-]{0,63}\.(wav|mp3|ogg)$/;
const signature=items=>JSON.stringify(items.map(({name,bytes,mtime,ino,active})=>({name,bytes,mtime,ino,active})));
async function boundedNames(directory,limit,message){
 const names=[];for await(const entry of await fs.opendir(directory)){if(names.length===limit)throw Error(message);names.push(entry.name);}return names;
}
class PreviewCache{
 constructor(manager){this.manager=manager;this.root=path.join(manager.root,'.preview-cache');this.leases=new Map();this.review=null;this.generation=0;}
 bind(owner){if(this.owner===owner)return;if(this.owner)for(const [name,fn] of this.ownerListeners||[])this.owner.removeListener(name,fn);this.dispose();this.owner=owner;this.ownerListeners=[['destroyed',()=>this.dispose()],['render-process-gone',()=>this.dispose()],['did-start-navigation',(_e,_url,_inPlace,main)=>{if(main)this.dispose();}]];for(const [name,fn] of this.ownerListeners)owner.on(name,fn);}
 async folder(create=false){if(create)await fs.mkdir(this.root,{recursive:true,mode:0o700});try{const s=await fs.lstat(this.root);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Preview cache directory is unavailable.');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async entries(){if(!await this.folder())return [];const names=await boundedNames(this.root,5000,'Preview cache contains too many entries to review safely.');const rows=[];for(const name of names.sort()){if(!FILE.test(name))continue;const stat=await fs.lstat(path.join(this.root,name));if(!stat.isFile()||stat.isSymbolicLink())continue;rows.push({name,bytes:stat.size,mtime:stat.mtimeMs,ino:stat.ino,active:[...this.leases.values()].some(v=>v===name)});}return rows;}
 acquire(id){return this.manager.mutate(async()=>{
  const generation=this.generation;const {bytes,item,key}=await this.manager.contentBytes(id,'sound'),name=`${key}-${item.id}${path.extname(item.file)}`;await this.folder(true);const rows=await this.entries();if(!rows.some(r=>r.name===name)&&rows.reduce((n,r)=>n+r.bytes,0)+bytes.length>512*1024*1024)throw Error('Preview cache is full. Review unused preview files in Settings.');
  const file=path.join(this.root,name),tmp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}const info=await require('./contentAudio.cjs').inspectPackSound(file);if(generation!==this.generation)throw Error('Preview owner changed while preparing audio.');const token=crypto.randomUUID();this.leases.set(token,name);return {token,path:file,name:item.name,...info};
 });}
 release(token){if(typeof token!=='string')return false;return this.leases.delete(token);}
 async bytesIn(dir,depth=0){if(depth>4)return 0;let stat;try{stat=await fs.lstat(dir);}catch(e){if(e.code==='ENOENT')return 0;throw e;}if(stat.isSymbolicLink())return 0;if(stat.isFile())return stat.size;if(!stat.isDirectory())return 0;let total=0;const names=await boundedNames(dir,10000,'Storage directory is too large to inspect safely.');for(const name of names)total+=await this.bytesIn(path.join(dir,name),depth+1);return total;}
 report(){return this.manager.mutate(async()=>{
  const entries=await this.entries(),rows=await this.manager.inventory();let installedBytes=0;for(const row of rows)installedBytes+=await this.bytesIn(path.join(this.manager.root,row.key));
  const ownedSoundBytes=await this.bytesIn(path.join(path.dirname(this.manager.root),'pack-sounds')),preferenceBytes=await this.bytesIn(path.join(this.manager.root,'.panel-storage'));
  const token=crypto.randomUUID();this.review={token,expires:Date.now()+300000,signature:signature(entries)};return {token,entries:entries.map(({name,bytes,active})=>({name,bytes,active})),cacheBytes:entries.reduce((n,r)=>n+r.bytes,0),removableBytes:entries.filter(r=>!r.active).reduce((n,r)=>n+r.bytes,0),installedBytes,ownedSoundBytes,preferenceBytes};
 });}
 clean(token){return this.manager.mutate(async()=>{
  const review=this.review;this.review=null;if(!review||review.token!==token||review.expires<Date.now())throw Error('Storage review expired. Review again.');const entries=await this.entries();if(signature(entries)!==review.signature)throw Error('Preview cache changed. Review again before cleanup.');let bytes=0,count=0;
  for(const row of entries.filter(r=>!r.active)){await fs.unlink(path.join(this.root,row.name));bytes+=row.bytes;count++;}return {bytes,count};
 });}
 dispose(){this.generation++;this.leases.clear();this.review=null;}
}
module.exports={PreviewCache};
