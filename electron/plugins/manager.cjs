// Validated, immutable plugin package storage. Every mutation is serialized and the inventory is atomic.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {readFolder,readArchive,validateFiles}=require('./package.cjs');
class PluginManager {
  constructor(root, appVersion) { this.root=root; this.appVersion=appVersion; this.queue=Promise.resolve(); this.panelStorage=new (require('./panelStorage.cjs').PanelStorage)(this); }
  async inventory() {
    let value;
    try { value=JSON.parse(await fs.readFile(path.join(this.root,'inventory.json'),'utf8')); }
    catch(e) { if(e.code==='ENOENT') return []; throw Error('Plugin inventory could not be read. Restore inventory.json before changing plugins.'); }
    if(!Array.isArray(value) || value.length>1000 || value.some(x=>!x || typeof x.key!=='string' || !/^[a-f0-9]{64}$/.test(x.key) || typeof x.enabled!=='boolean') || new Set(value.map(x=>x.key)).size!==value.length) throw Error('Invalid plugin inventory.');
    return value.map(x=>({key:x.key,enabled:x.enabled}));
  }
  async save(rows) {
    await fs.mkdir(this.root,{recursive:true});
    const temp=path.join(this.root,`inventory-${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(temp,JSON.stringify(rows,null,2),{flag:'wx'}); await fs.rename(temp,path.join(this.root,'inventory.json')); }
    finally { await fs.rm(temp,{force:true}); }
  }
  async read(key) {
    if(!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid plugin fingerprint.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Installed plugin content changed. Remove this version and reinstall its package.');
    return bundle.manifest;
  }
  async commandBundle(key) {
    const development=this.development?.resolve(key);if(development)return development;
    await this.read(key);
    const row=(await this.list()).find(r=>r.key===key&&r.enabled);
    if(!row)throw Error('Command plugin is disabled or unavailable.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Command package integrity check failed.');
    return bundle;
  }

  async list() {
    const result=[];
    for(const row of await this.inventory()) {
      try { result.push({...row,manifest:await this.read(row.key)}); }
      catch(error) { result.push({...row,enabled:false,error:error.message}); }
    }
    const active=new Set(result.filter(row=>row.enabled&&row.manifest).map(row=>row.manifest.id));
    return result.map(row=>({...row,available:!!row.manifest&&active.has(row.manifest.id)}));
  }
  async presets() {
    return (await this.list()).flatMap(row=>row.enabled && row.manifest ? row.manifest.contributes.exportPresets.map(p=>({
      ...p, pluginId:row.manifest.id, version:row.manifest.version, digest:row.key, pluginName:row.manifest.name,
      contributionId:`${row.manifest.id}/${p.id}`,
    })) : []);
  }
  async actions(){
    const rows=await this.list(),s=this.development?.session;
    if(s?.status==='ready')rows.push({key:s.key,enabled:true,manifest:s.bundle.manifest,development:true,sessionId:s.id});
    return (await import('../../shared/pluginActions.mjs')).actionCatalog(rows);
  }
  async panels(){return [...(this.development?.panels()||[]),...(await this.list()).flatMap(row=>row.enabled&&row.manifest?(row.manifest.contributes.panels||[]).map(panel=>({...panel,key:row.key,pluginId:row.manifest.id,pluginName:row.manifest.name,publisher:row.manifest.publisher,version:row.manifest.version})):[])];}
  async panelBundle(key,id){
   const development=this.development?.resolve(key);if(development){const panel=development.manifest.contributes.panels?.find(p=>p.id===id);if(!panel)throw Error('Unknown development panel.');return {...development,panel};}
   if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid panel fingerprint.');
   const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
   if(bundle.key!==key||!(await this.inventory()).some(row=>row.key===key&&row.enabled))throw Error('Panel version is disabled, changed or unavailable.');
   const panel=bundle.manifest.contributes.panels?.find(p=>p.id===id);if(!panel)throw Error('Unknown panel.');return {...bundle,panel};
  }
  async providers() {
    return (await this.list()).flatMap(row=>row.enabled&&row.manifest ? (row.manifest.contributes.aiProviders||[]).map(provider=>({...provider,pluginId:row.manifest.id,pluginName:row.manifest.name,publisher:row.manifest.publisher,version:row.manifest.version,digest:row.key})) : []);
  }
  async effects() { return this.renderContributions('effects'); }
  async transitions() { return this.renderContributions('transitions'); }
  async renderContributions(kind) {
    const rows=await this.list(),active=new Set(rows.filter(r=>r.enabled&&r.manifest).map(r=>r.manifest.id));
    return rows.flatMap(row=>row.manifest&&active.has(row.manifest.id) ? (row.manifest.contributes[kind]||[]).map(item=>({
      ...item,pluginId:row.manifest.id,version:row.manifest.version,digest:row.key,pluginName:row.manifest.name,
      contributionId:`${row.manifest.id}/${item.id}`,preferred:row.enabled,
    })) : []);
  }
  mutate(fn) { const job=this.queue.then(fn); this.queue=job.catch(()=>{}); return job; }
  install(source, folder=false) { return this.mutate(async()=>{
    await fs.mkdir(this.root,{recursive:true});
    const staging=await fs.mkdtemp(path.join(this.root,'.install-'));
    try {
      const bundle=await validateFiles(await (folder?readFolder(source):readArchive(source)),this.appVersion);
      const {manifest,key}=bundle;
      const rows=await this.inventory();
      const current=await this.list();
      for(const row of current) if(row.manifest?.id===manifest.id) {
        if(row.manifest.version===manifest.version && row.key!==key) throw Error('This version already exists with different content. Increment the package version.');
        const item=rows.find(x=>x.key===row.key); item.enabled=false;
      }
      if(rows.length>=1000 && !rows.some(x=>x.key===key)) throw Error('At most 1,000 plugin versions may be installed. Remove an unused version first.');
      const dest=path.join(this.root,key);
      const payload=path.join(staging,'payload');
      await fs.mkdir(payload);
      for(const [name,bytes] of bundle.files)await fs.writeFile(path.join(payload,name),bytes,{flag:'wx'});
      try { await fs.rename(payload,dest); }
      catch(e) { if(!['EEXIST','ENOTEMPTY'].includes(e.code)) throw e; await this.read(key); }
      const found=rows.find(x=>x.key===key);
      if(found) found.enabled=true; else rows.push({key,enabled:true});
      await this.save(rows);
      return this.list();
    } finally { await fs.rm(staging,{recursive:true,force:true}); }
  }); }
  setEnabled(key,enabled) { return this.mutate(async()=>{
    if(typeof enabled!=='boolean') throw Error('enabled must be a boolean.');
    const rows=await this.inventory(), row=rows.find(x=>x.key===key);
    if(!row) throw Error('Unknown plugin.');
    if(enabled) {
      const manifest=await this.read(key);
      for(const other of rows) if(other.key!==key) {
        try { if((await this.read(other.key)).id===manifest.id) other.enabled=false; } catch { other.enabled=false; }
      }
    }
    row.enabled=enabled; await this.save(rows); return this.list();
  }); }
  clearPanelStorage(key) { return this.mutate(async()=>{
    if(!(await this.inventory()).some(row=>row.key===key))throw Error('Unknown plugin.');
    await this.panelStorage.clearVersion(key);return true;
  }); }
  remove(key) { return this.mutate(async()=>{
    const rows=await this.inventory();
    if(!rows.some(x=>x.key===key)) throw Error('Unknown plugin.');
    await this.save(rows.filter(x=>x.key!==key));
    await this.panelStorage.clearVersion(key);
    await fs.rm(path.join(this.root,key),{recursive:true,force:true}); return this.list();
  }); }
}
module.exports={PluginManager};
