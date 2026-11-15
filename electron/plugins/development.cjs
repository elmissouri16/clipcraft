const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {readFolder,validateFiles,fingerprint}=require('./package.cjs');
const {PanelStorage}=require('./panelStorage.cjs');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const clean=value=>String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,1000);
class DevelopmentSessions{
 constructor(manager,{onChanged=()=>{},onCatalog=()=>{},debounceMs=300}={}){
  Object.assign(this,{manager,onChanged,onCatalog,debounceMs});this.session=null;this.logs=[];this.bytes=0;this.sequence=0;this.dropped=0;this.windowStart=0;this.windowCount=0;this.keys=new Set();this.commits=new Map();this.roots=new Set();this.watchers=[];this.disposed=false;
 }
 snapshot(){const s=this.session;return {session:s?{id:s.id,source:s.source,status:s.status,watch:s.watch,generation:s.generation,key:s.key,fingerprint:s.bundle?.fingerprint||null,manifest:structuredClone(s.bundle?.manifest||s.manifest),error:s.error||''}:null,logs:this.logs.map(row=>({...row})),dropped:this.dropped};}
 emit(){if(!this.disposed)this.onChanged(this.snapshot());}
 notify(){if(this.notifyTimer||this.disposed)return;this.notifyTimer=setTimeout(()=>{this.notifyTimer=null;this.emit();},100);this.notifyTimer.unref?.();}
 log(level,message,source='lifecycle'){
  if(this.disposed||typeof message!=='string')return false;
  if(source!=='lifecycle'){
   const now=Date.now();if(now-this.windowStart>=1000){this.windowStart=now;this.windowCount=0;}
   if(++this.windowCount>30){this.dropped++;this.notify();return false;}
  }
  const row={id:++this.sequence,time:new Date().toISOString(),generation:this.session?.generation||0,level:['debug','info','warning','error'].includes(level)?level:'info',source,message:clean(message)};
  const bytes=Buffer.byteLength(JSON.stringify(row));this.logs.push(row);this.bytes+=bytes;
  while(this.logs.length>200||this.bytes>128*1024)this.bytes-=Buffer.byteLength(JSON.stringify(this.logs.shift()));
  this.notify();return true;
 }
 record(key,level,message,source='runtime'){if(!key||this.session?.key!==key)return false;return this.log(level,message,source);}
 rememberCommit(runId,key){
  if(this.session?.status!=='ready'||this.session.key!==key)return;this.commits.set(runId,{key,time:Date.now()});if(this.commits.size>32)this.commits.delete(this.commits.keys().next().value);
 }
 authorizeCommit(runId,key){const entry=this.commits.get(runId);this.commits.delete(runId);return !!entry&&entry.key===key&&Date.now()-entry.time<30000&&this.session?.status==='ready'&&this.session.key===key;}
 clearLogs(){this.logs=[];this.bytes=0;this.dropped=0;this.emit();return this.snapshot();}
 resolve(key){
  const s=this.session;
  if(s?.key===key&&s.status==='ready')return {...s.bundle,key,development:{sessionId:s.id,generation:s.generation}};
  if(this.keys.has(key))throw Error('Development snapshot is no longer active. Reload or start a new session.');
  return null;
 }
 storageFor(key){
  const s=this.session;if(!s||s.key!==key||s.status!=='ready')return null;
  return {execute:(_key,...args)=>s.storage.execute(s.storageKey,...args)};
 }
 panels(){const s=this.session;if(!s||s.status!=='ready')return [];return (s.bundle.manifest.contributes.panels||[]).map(panel=>({...panel,key:s.key,pluginId:s.manifest.id,pluginName:s.manifest.name,publisher:s.manifest.publisher,version:s.manifest.version,development:true,sessionId:s.id}));}
 async load(source,identity){
  const bundle=await validateFiles(await readFolder(source),this.manager.appVersion),m=bundle.manifest;
  if(['effects','transitions','exportPresets','aiProviders'].some(kind=>m.contributes[kind]?.length)||!m.contributes.commands.length&&!m.contributes.panels?.length)throw Error('Development sessions support command and panel packages. Install declarative rendering/provider contributions normally.');
  if(identity&&(m.id!==identity.id||m.publisher!==identity.publisher))throw Error('Plugin identity changed. End this session and start another.');
  return {...bundle,fingerprint:bundle.key,files:new Map([...bundle.files].map(([name,bytes])=>[name,Buffer.from(bytes)]))};
 }
 async sourceFolder(selected){
  if(typeof selected!=='string')throw Error('Choose a compiled plugin folder or a built SDK project.');
  const root=path.resolve(selected);if(!(await fs.lstat(root)).isDirectory())throw Error('Choose a regular folder.');
  try{await readFolder(root);return root;}catch{}
  const dist=path.join(root,'dist');await readFolder(dist);return dist;
 }
 start(selected){return this.manager.mutate(async()=>{
  if(this.disposed)throw Error('Developer sessions are closed.');
  if(this.session&&this.session.status!=='ended')throw Error('End the current development session first.');
  const source=await this.sourceFolder(selected),bundle=await this.load(source),temp=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-plugin-session-'));
  if(this.disposed){await fs.rm(temp,{recursive:true,force:true});throw Error('Developer sessions are closed.');}
  this.roots.add(temp);this.logs=[];this.bytes=0;this.dropped=0;this.windowCount=0;
  const id=crypto.randomUUID(),s={id,source,temp,manifest:bundle.manifest,status:'loading',watch:false,generation:0,key:null,storageKey:digest(id),storage:new PanelStorage({root:temp,mutate:fn=>this.manager.mutate(fn)})};
  this.session=s;this.publish(s,bundle);this.log('info','Development session started. No code executed.');this.emit();return this.snapshot();
 });}
 publish(s,bundle){
  s.bundle=bundle;s.manifest=bundle.manifest;s.generation++;s.key=digest(`clipcraft-development:${s.id}:${s.generation}:${bundle.fingerprint}`);s.status='ready';s.error='';
  this.keys.add(s.key);if(this.keys.size>256)this.keys.delete(this.keys.values().next().value);this.onCatalog();
 }
 revoke(s){
  const key=s.key;s.status='loading';for(const [run,entry] of this.commits)if(entry.key===key)this.commits.delete(run);
  if(key&&this.manager.commandRuntime?.active?.key===key)this.manager.commandRuntime.cancel(this.manager.commandRuntime.active.runId);
  if(key&&this.manager.panelRuntime?.active?.key===key)this.manager.panelRuntime.close(undefined,'closed');
  s.key=null;s.bundle=null;this.onCatalog();
 }
 reload(){return this.manager.mutate(async()=>{
  const s=this.session;if(!s||s.status==='ended')throw Error('Start a development session first.');
  this.log('info','Reloading: old runtime revoked.');this.revoke(s);this.emit();
  try{const bundle=await this.load(s.source,s.manifest);if(this.disposed)return this.snapshot();this.publish(s,bundle);this.log('info',`Snapshot ${s.generation} ready. Reopen its panel or run its command explicitly.`);}
  catch(error){s.status='failed';s.error=clean(error.message);this.log('error',s.error);}
  if(s.watch)this.attachWatch();this.emit();return this.snapshot();
 });}
 closeWatch(){clearInterval(this.pollTimer);this.pollTimer=null;clearTimeout(this.watchTimer);this.watchTimer=null;for(const watcher of this.watchers)watcher.close();this.watchers=[];}
 attachWatch(){
  this.closeWatch();const s=this.session;if(!s?.watch||s.status==='ended'||this.disposed)return;
  s.observed=s.bundle?.fingerprint||s.observed;let checking=false;
  const inspect=async()=>{
   if(checking||this.session!==s||!s.watch||s.status==='ended'||this.disposed)return;checking=true;
   try{
    let signature;try{signature=fingerprint(await readFolder(s.source));}catch(error){signature='invalid:'+error.message;}
    if(this.session!==s||!s.watch||s.status==='ended'||this.disposed)return;
    if(signature!==s.observed){s.observed=signature;await this.reload();}
   }catch(error){this.log('error',clean(error.message));}finally{checking=false;}
  };
  const changed=()=>{clearTimeout(this.watchTimer);this.watchTimer=setTimeout(()=>{this.watchTimer=null;inspect();},this.debounceMs);};
  this.pollTimer=setInterval(inspect,1000);this.pollTimer.unref?.();changed();
  try{
   const parent=sync.watch(path.dirname(s.source),(_event,file)=>{if(String(file)===path.basename(s.source))changed();});parent.on('error',error=>this.log('error',clean(error.message)));this.watchers.push(parent);
   if(sync.existsSync(s.source)){const child=sync.watch(s.source,changed);child.on('error',error=>this.log('error',clean(error.message)));this.watchers.push(child);}
  }catch(error){this.log('error',clean(error.message));}
 }
 setWatch(value){return this.manager.mutate(async()=>{
  const s=this.session;if(typeof value!=='boolean'||!s||s.status==='ended')throw Error('Invalid development watch request.');s.watch=value;this.attachWatch();this.log('info',value?'Watching compiled builds. Code still needs execution approval.':'Build watching stopped.');this.emit();return this.snapshot();
 });}
 end(){return this.manager.mutate(async()=>{
  const s=this.session;if(!s||s.status==='ended')return this.snapshot();this.closeWatch();this.log('info','Development session ended.');this.revoke(s);s.status='ended';s.watch=false;await fs.rm(s.temp,{recursive:true,force:true});this.roots.delete(s.temp);this.emit();return this.snapshot();
 });}
 dispose(){
  this.disposed=true;clearTimeout(this.notifyTimer);this.closeWatch();if(this.session){this.revoke(this.session);this.session.status='ended';}
  for(const root of this.roots){try{sync.rmSync(root,{recursive:true,force:true});}catch{}}this.roots.clear();
 }
}
module.exports={DevelopmentSessions};
