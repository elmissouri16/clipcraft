// Validated, immutable plugin package storage. Every mutation is serialized and the inventory is atomic.
const fs = require('node:fs/promises');
const path = require('node:path');
const {readFolder,readArchive,validateFiles,validateIntake}=require('./package.cjs');
const {InventoryStore}=require('./inventory.cjs');
const migrationPair=(a,b)=>a.publisher===b.publisher&&!!(a.legacyExecutable&&b.main||b.legacyExecutable&&a.main);
class PluginManager {
  constructor(root, appVersion) { this.root=root; this.appVersion=appVersion; this.queue=Promise.resolve();this.inventoryStore=new InventoryStore(root,appVersion); this.panelStorage=new (require('./panelStorage.cjs').PanelStorage)(this); }
  async inventory() {
    return this.inventoryStore.read();
  }
  async save(rows) {
    this.invalidateDiscovery();
    try{return await this.inventoryStore.save(rows);}finally{this.invalidateDiscovery();}
  }
  prepareRecovery(){return this.mutate(()=>this.inventoryStore.prepare());}
  recover(token){return this.mutate(async()=>({...await this.inventoryStore.recover(token),rows:await this.list()}));}
  async read(key) {
    if(!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid plugin fingerprint.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Installed plugin content changed. Remove this version and reinstall its package.');
    return bundle.manifest;
  }
  async icon(key) {
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid plugin fingerprint.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Installed plugin content changed.');
    return bundle.manifest.icon?'data:image/png;base64,'+Buffer.from(bundle.files.get(bundle.manifest.icon)).toString('base64'):null;
  }
  async commandBundle(key) {
    const development=await this.development?.bundle(key);if(development)return development;
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid plugin fingerprint.');
    // Authorization needs this inventory row and freshly verified target bytes,
    // not a discovery scan of every unrelated installed asset.
    const row=(await this.inventory()).find(r=>r.key===key&&r.enabled);
    if(!row)throw Error('Command plugin is disabled or unavailable.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Command package integrity check failed.');
    if(bundle.manifest.legacyExecutable&&!bundle.manifest.legacyExecutable.creative)throw Error('Command plugin is disabled or unavailable.');
    return bundle;
  }

  invalidateDiscovery(){this.discovery=null;}
  list() {
    // Coalesce only concurrent discovery. Never retain verified payloads after
    // settlement, and isolate mutable metadata returned to separate consumers.
    if(!this.discovery){
      const snapshot=this.readDiscovery();this.discovery=snapshot;
      const release=()=>{if(this.discovery===snapshot)this.discovery=null;};
      snapshot.then(release,release);
    }
    return this.discovery.then(rows=>structuredClone(rows));
  }
  async readDiscovery() {
    const result=[];
    for(const row of await this.inventory()) {
      // Do not resolve pending payloads at all: another installed version of the
      // same plugin must not expose this version as a retained render dependency.
      if(row.removing){result.push({...row,error:'Plugin removal is pending. Retry removal to delete its remaining files and saved panel data.'});continue;}
      try { const manifest=await this.read(row.key);result.push({...row,enabled:row.enabled&&(!manifest.legacyExecutable||manifest.legacyExecutable.creative),manifest}); }
      catch(error) { result.push({...row,enabled:false,error:error.message}); }
    }
    const active=new Set(result.filter(row=>row.enabled&&row.manifest).map(row=>row.manifest.id));
    return result.map(row=>({...row,available:!row.recovered&&!!row.manifest&&active.has(row.manifest.id)}));
  }
  async extensionRows(){const rows=await this.list(),s=this.development?.session;return s?.status==='ready'&&s.manifest.main?[{key:s.key,enabled:true,manifest:s.manifest,development:true},...rows.filter(row=>row.manifest?.id!==s.manifest.id)]:rows;}
  async presets() {
    return (await this.list()).flatMap(row=>row.enabled && row.manifest ? row.manifest.contributes.exportPresets.map(p=>({
      ...p, pluginId:row.manifest.id, version:row.manifest.version, digest:row.key, pluginName:row.manifest.name,
      contributionId:`${row.manifest.id}/${p.id}`,
    })) : []);
  }
  async timelineTypes() { return require('./customTimeline.cjs').timelineTypes(this); }
  async effects() { return this.renderContributions('effects'); }
  async transitions() { return this.renderContributions('transitions'); }
  async renderContributions(kind) {
    const rows=await this.list(),active=new Set(rows.filter(r=>r.enabled&&r.manifest).map(r=>r.manifest.id));
    return rows.flatMap(row=>!row.recovered&&row.manifest&&active.has(row.manifest.id) ? (row.manifest.contributes[kind]||[]).map(item=>({
      ...item,pluginId:row.manifest.id,version:row.manifest.version,digest:row.key,pluginName:row.manifest.name,
      contributionId:`${row.manifest.id}/${item.id}`,preferred:row.enabled&&(!row.manifest.legacyExecutable||!rows.some(other=>other.enabled&&other.manifest?.main&&other.manifest.id===row.manifest.id&&other.manifest.contributes[kind]?.some(value=>value.id===item.id))),
    })) : []);
  }
  async creative() {
    const [textStyles,luts,colorPresets,motionPresets]=await Promise.all(['textStyles','luts','colorPresets','motionPresets'].map(kind=>this.renderContributions(kind)));
    return {motionPresets,textStyles:textStyles.map(s=>({...s,style:{...s.style,...(s.style.font?.startsWith('pack:')?{font:`pack-font:${s.digest}:${s.style.font.slice(5)}`}:{})}})),luts,colorPresets:colorPresets.map(s=>({...s,...(s.settings.filterLut?{filterLutName:luts.find(l=>l.digest===s.digest&&l.id===s.settings.filterLut)?.name}:{}),...(s.settings.lut?{lutName:luts.find(l=>l.digest===s.digest&&l.id===s.settings.lut)?.name}:{})}))};
  }
  async sounds() {
    return (await this.renderContributions('sounds')).filter(s=>s.preferred).map(s=>({...s,id:`pack-sound:${s.digest}:${s.id}`,localId:s.id,group:s.kind==='music'?'Music':'Sound FX',sub:`${s.pluginName} (${s.pluginId})`,path:`pack-sound:${s.digest}:${s.id}`,kind:'audio'}));
  }
  async fonts() {
    return (await this.renderContributions('fonts')).map(f=>({...f,id:`pack-font:${f.digest}:${f.id}`,localId:f.id,source:'pack',faces:f.faces.map(({weight,style})=>({weight,style}))}));
  }
  async contentBytes(id,kind,face=0) {
    if(typeof id!=='string'||!new RegExp(`^pack-${kind}:([a-f0-9]{64}):([a-z][a-z0-9-]{0,63})$`).test(id))throw Error('Invalid pack asset ID.');
    const [,key,localId]=id.split(':'),rows=await this.list(),row=rows.find(r=>r.key===key);
    if(!row?.available||(kind==='sound'&&!row.enabled))throw Error('Content pack is disabled or unavailable.');
    const bundle=await validateFiles(await readFolder(path.join(this.root,key)),this.appVersion);
    if(bundle.key!==key)throw Error('Pack integrity check failed.');
    const item=bundle.manifest.contributes[{sound:'sounds',font:'fonts',lut:'luts'}[kind]]?.find(f=>f.id===localId);
    if(!item)throw Error('Unknown pack asset.');
    if(kind==='font'&&(!Number.isInteger(face)||face<0||face>=item.faces.length))throw Error('Invalid font face.');
    const file=kind==='font'?item.faces[face].file:item.file;
    return {bytes:bundle.files.get(file),item,key};
  }
  soundAsset(id) { return this.mutate(async()=>{
    const {bytes,item,key}=await this.contentBytes(id,'sound');
    // Own a durable copy outside the removable package, including for previews.
    const dir=path.join(path.dirname(this.root),'pack-sounds');await fs.mkdir(dir,{recursive:true});
    const file=path.join(dir,`${key}-${item.id}${path.extname(item.file)}`);
    // Repair missing/modified cached copies from verified package bytes.
    let same=false;try{const stat=await fs.lstat(file);if(stat.isFile())same=bytes.equals(await fs.readFile(file));}catch{}
    if(!same){const tmp=file+'.'+require('node:crypto').randomUUID();try{await fs.writeFile(tmp,bytes,{flag:'wx'});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
    return {path:file,name:item.name,origin:'plugin-pack',credit:{license:item.license,providerName:'ClipCraft extension',creator:(await this.read(key)).publisher,line:`${item.name} — ${item.license}`}};
  }); }
  mutate(fn) { const job=this.queue.then(async()=>{this.invalidateDiscovery();try{return await fn();}finally{this.invalidateDiscovery();}}); this.queue=job.catch(()=>{}); return job; }
  install(source, folder=false, {bootstrap=false,requiredKey}={}) { return this.mutate(async()=>{
    await fs.mkdir(this.root,{recursive:true});
    let staging;
    try {
      const bundle=await validateIntake(await (folder?readFolder(source):readArchive(source)),this.appVersion);
      const {manifest,key}=bundle;
      if(requiredKey!==undefined&&(!/^[a-f0-9]{64}$/.test(requiredKey)||key!==requiredKey))throw Error('This archive is not the exact pack required by the project. No plugin was installed.');
      const rows=await this.inventory();
      if(bootstrap&&rows.some(row=>row.key===key&&row.recovered))return this.list();
      if(rows.some(row=>row.key===key&&row.removing))throw Error('Plugin removal is pending. Retry removal before reinstalling this version.');
      const current=await this.list();
      // An ID is one publisher's. Accepting another publisher's package as an "update" would disable
      // the original and hand its identity to an unrelated author.
      const foreign=current.find(row=>row.manifest?.id===manifest.id&&row.manifest.publisher!==manifest.publisher&&(row.manifest.main||manifest.main));
      if(foreign)throw Error(`"${manifest.id}" is already installed from ${foreign.manifest.publisher}. Remove it before installing a plugin with the same ID from ${manifest.publisher}.`);
      for(const row of current) if(row.manifest?.id===manifest.id) {
        if(row.manifest.version===manifest.version && row.key!==key&&!migrationPair(row.manifest,manifest)) throw Error('This version already exists with different content. Increment the package version.');
        const item=rows.find(x=>x.key===row.key);if(!migrationPair(row.manifest,manifest))item.enabled=false;
      }
      if(rows.length>=1000 && !rows.some(x=>x.key===key)) throw Error('At most 1,000 plugin versions may be installed. Remove an unused version first.');
      const dest=path.join(this.root,key);
      staging=await fs.mkdtemp(path.join(this.root,'.install-'));
      const payload=path.join(staging,'payload');
      await fs.mkdir(payload);
      for(const [name,bytes] of bundle.files){await fs.mkdir(path.dirname(path.join(payload,name)),{recursive:true});await fs.writeFile(path.join(payload,name),bytes,{flag:'wx'});}
      try { await fs.rename(payload,dest); }
      catch(e) { if(!['EEXIST','ENOTEMPTY'].includes(e.code)) throw e; await this.read(key); }
      const found=rows.find(x=>x.key===key);
      if(found){found.enabled=true;delete found.recovered;}else rows.push({key,enabled:true});
      await this.save(rows);
      return this.list();
    } finally { if(staging)await fs.rm(staging,{recursive:true,force:true}); }
  }); }
  setEnabled(key,enabled) { return this.mutate(async()=>{
    if(typeof enabled!=='boolean') throw Error('enabled must be a boolean.');
    const rows=await this.inventory(), row=rows.find(x=>x.key===key);
    if(!row) throw Error('Unknown plugin.');
    if(row.removing)throw Error('Plugin removal is pending. Retry removal to finish.');
    if(enabled) {
      const manifest=await this.read(key);if(manifest.legacyExecutable&&!manifest.legacyExecutable.creative)throw Error('This executable package is retired. Install its rebuilt Node extension.');
      delete row.recovered;
      for(const other of rows) if(other.key!==key) {
        try { const candidate=await this.read(other.key);if(candidate.id===manifest.id&&!migrationPair(candidate,manifest))other.enabled=false; } catch { other.enabled=false; }
      }
    }
    row.enabled=enabled; await this.save(rows); return this.list();
  }); }
  clearPanelStorage(key) { return this.mutate(async()=>{
    const row=(await this.inventory()).find(row=>row.key===key);
    if(!row)throw Error('Unknown plugin.');
    if(row.removing)throw Error('Plugin removal is pending. Retry removal to finish deleting its saved data.');
    await this.panelStorage.clearVersion(key);return true;
  }); }
  remove(key) { return this.mutate(async()=>{
    const rows=await this.inventory();
    const row=rows.find(x=>x.key===key);
    if(!row) throw Error('Unknown plugin.');
    // Publish revocation before any irreversible cleanup. Keep this marker until
    // every cleanup and the final inventory write succeed, so retries are safe.
    if(!row.removing){row.enabled=false;row.removing=true;await this.save(rows);}
    await this.panelStorage.clearVersion(key);
    await fs.rm(path.join(this.root,key),{recursive:true,force:true});
    await this.save(rows.filter(x=>x.key!==key));return this.list();
  }); }
}
module.exports={PluginManager};
