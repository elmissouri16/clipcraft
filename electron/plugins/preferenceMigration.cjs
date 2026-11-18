// Editor-reviewed copying of selected JSON preferences; no plugin code or grants run here.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {encoded}=require('./panelStorage.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
class PreferenceMigration{
 constructor(manager){this.manager=manager;this.review=null;}
 async pair({from,to,panel}){
  if(!/^[a-f0-9]{64}$/.test(from)||!/^[a-f0-9]{64}$/.test(to)||from===to||typeof panel!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(panel))throw Error('Choose two installed versions and one panel.');
  const rows=await this.manager.list(),source=rows.find(r=>r.key===from),target=rows.find(r=>r.key===to);
  if(!source?.manifest||source.recovered||source.removing||!target?.manifest||target.recovered||target.removing||!target.manifest)throw Error('Both versions must be intact and installed.');
  if(source.manifest.id!==target.manifest.id||source.manifest.publisher!==target.manifest.publisher)throw Error('Preferences can only move between matching plugin identities.');
  for(const row of [source,target])if(!row.manifest.legacyPreferences?.panels?.some(p=>p.id===panel))throw Error('Both versions must declare this panel and local storage.');
  const storage=this.manager.panelStorage,read=async key=>{const dir=await storage.folder(key);return dir?storage.read(path.join(dir,panel+'.json')):{};};
  const [values,destination]=await Promise.all([read(from),read(to)]);return {source,target,values,destination};
 }
 prepare(request){return this.manager.mutate(async()=>{
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['from','to','panel'].includes(k)))throw Error('Invalid preference migration request.');
  const {source,target,values,destination}=await this.pair(request),token=crypto.randomUUID();
  this.review={...request,token,expires:Date.now()+300000,signature:hash({values,destination})};
  return {token,from:request.from,to:request.to,panel:request.panel,plugin:target.manifest.name,sourceVersion:source.manifest.version,targetVersion:target.manifest.version,keys:Object.entries(values).map(([key,value])=>({key,bytes:Buffer.byteLength(JSON.stringify(value)),conflict:Object.hasOwn(destination,key),same:Object.hasOwn(destination,key)&&hash(destination[key])===hash(value)}))};
 });}
 commit({token,keys,overwrite=false}={}){return this.manager.mutate(async()=>{
  const review=this.review;this.review=null;
  if(!review||review.token!==token||review.expires<Date.now())throw Error('Preference review expired. Review again.');
  if(!Array.isArray(keys)||!keys.length||keys.length>64||new Set(keys).size!==keys.length||typeof overwrite!=='boolean')throw Error('Choose preference keys to copy.');
  const {values,destination}=await this.pair(review);if(hash({values,destination})!==review.signature)throw Error('Preferences changed. Review again before copying.');
  for(const key of keys){if(typeof key!=='string'||!Object.hasOwn(values,key))throw Error('Unknown preference key.');if(Object.hasOwn(destination,key)&&!overwrite)throw Error('Confirm replacement of existing destination keys.');}
  const next={...destination};for(const key of keys)next[key]=values[key];const json=encoded(next),folder=await this.manager.panelStorage.folder(review.to,true),file=path.join(folder,review.panel+'.json'),tmp=path.join(folder,'.migration-'+crypto.randomUUID()+'.tmp');
  try{await fs.writeFile(tmp,json,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
  return {copied:keys.length,to:review.to,panel:review.panel};
 });}
}
module.exports={PreferenceMigration};
