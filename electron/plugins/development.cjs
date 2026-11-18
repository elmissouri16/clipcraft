const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {readFolder,validateFiles,validateIntake}=require('./package.cjs');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const clean=value=>String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,1000);
class DevelopmentSessions{
 constructor(manager,{onChanged=()=>{},onCatalog=()=>{},debounceMs=300}={}){
  Object.assign(this,{manager,onChanged,onCatalog,debounceMs});this.session=null;this.logs=[];this.bytes=0;this.sequence=0;this.dropped=0;this.windowStart=0;this.windowCount=0;this.keys=new Set();this.roots=new Set();this.watchers=[];this.disposed=false;
 }
 snapshot(){const s=this.session;return {session:s?{id:s.id,source:s.source,status:s.status,watch:s.watch,generation:s.generation,key:s.key,trusted:!!s.trusted,debuggerUrl:this.manager.extensions?.active.get(s.key)?.debuggerUrl||null,runtimeState:this.manager.extensions?.active.get(s.key)?.state||null,diagnosticKey:s.key||s.previousKey,fingerprint:s.bundle?.fingerprint||null,manifest:structuredClone(s.bundle?.manifest||s.manifest),error:s.error||''}:null,logs:this.logs.map(row=>({...row})),dropped:this.dropped};}
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
 clearLogs(){this.logs=[];this.bytes=0;this.dropped=0;this.emit();return this.snapshot();}
 resolve(key){
  const s=this.session;
  if(s?.key===key&&s.status==='ready')return {...s.bundle,key,development:{sessionId:s.id,generation:s.generation,directory:s.directory,storage:s.nodeStorage}};
  if(this.keys.has(key))throw Error('Development snapshot is no longer active. Reload or start a new session.');
  return null;
 }
 async binding(s){
  if(!(await fs.lstat(s.source)).isDirectory()||await fs.realpath(s.source)!==s.source)throw Error('Development source folder changed. End this session and select it again.');
 }
 async bundle(key){const bundle=this.resolve(key);if(!bundle?.manifest.main)return bundle;const s=this.session;await this.binding(s);const captured=await validateFiles(await readFolder(s.directory),this.manager.appVersion);if(this.session!==s||s.key!==key||s.status!=='ready'||captured.key!==bundle.fingerprint)throw Error('Development snapshot changed. Reload before activation.');return bundle;}
 async trust(key){const bundle=await this.bundle(key);if(!bundle?.manifest.main)throw Error('Not a Node development extension');this.session.trusted=true;this.emit();}
 async load(source,identity){
  const bundle=await validateIntake(await readFolder(source),this.manager.appVersion),m=bundle.manifest;
  if(m.legacyExecutable)throw Error('This executable format is retired. Build a Node extension before starting a development session.');
  if(!m.main&&!['effects','transitions','sounds','fonts','textStyles','luts','colorPresets','motionPresets','exportPresets'].some(kind=>m.contributes[kind]?.length))throw Error('Choose a Node extension or a creative pack.');
  if(identity&&(m.id!==identity.id||m.publisher!==identity.publisher))throw Error('Plugin identity changed. End this session and start another.');
  return {...bundle,fingerprint:bundle.key,files:new Map([...bundle.files].map(([name,bytes])=>[name,Buffer.from(bytes)]))};
 }
 async sourceFolder(selected){
  if(typeof selected!=='string')throw Error('Choose a compiled plugin folder or a built SDK project.');
  const chosen=path.resolve(selected);if(!(await fs.lstat(chosen)).isDirectory())throw Error('Choose a regular folder.');const root=await fs.realpath(chosen);
  try{await readFolder(root);return root;}catch{}
  const dist=path.join(root,'dist');await readFolder(dist);if(await fs.realpath(dist)!==dist)throw Error('Choose a regular compiled folder without links.');return dist;
 }
 start(selected){return this.manager.mutate(async()=>{
  if(this.disposed)throw Error('Developer sessions are closed.');
  if(this.session&&this.session.status!=='ended')throw Error('End the current development session first.');
  const source=await this.sourceFolder(selected),bundle=await this.load(source),temp=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-plugin-session-'));
  if(this.disposed){await fs.rm(temp,{recursive:true,force:true});throw Error('Developer sessions are closed.');}
  this.roots.add(temp);this.logs=[];this.bytes=0;this.dropped=0;this.windowCount=0;
  const id=crypto.randomUUID(),s={id,source,temp,manifest:bundle.manifest,status:'loading',watch:false,generation:0,key:null};
  s.nodeStorage=path.join(temp,'node-storage');this.session=s;await this.publish(s,bundle);this.log('info','Development session started. No code executed.');this.emit();return this.snapshot();
 });}
 async publish(s,bundle){
  const generation=s.generation+1,key=digest(`clipcraft-development:${s.id}:${generation}:${bundle.fingerprint}`),directory=path.join(s.temp,'snapshots',key);
  if(bundle.manifest.main){for(const [name,bytes] of bundle.files){const target=path.join(directory,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx',mode:0o400});}}
  s.bundle=bundle;s.manifest=bundle.manifest;s.generation=generation;s.key=key;s.directory=directory;s.status='ready';s.error='';
  this.keys.add(s.key);if(this.keys.size>256)this.keys.delete(this.keys.values().next().value);if(s.trusted&&!s.restart)this.manager.extensions?.suspended.add(s.key);this.manager.extensions?.events.invalidate();this.onCatalog();
 }
 revoke(s){
  const key=s.key;this.manager.authoring?.revoke(key);s.status='loading';
  s.previousKey=key||s.previousKey;s.key=null;s.bundle=null;this.manager.extensions?.events.invalidate();this.onCatalog();
 }
 reload(){return this.manager.mutate(async()=>{
  const s=this.session;if(!s||s.status==='ended')throw Error('Start a development session first.');
  const oldKey=s.key,oldDirectory=s.directory,runtime=this.manager.extensions;
  if(oldKey)s.restart=!runtime?.suspended.has(oldKey)&&!!(runtime?.active.has(oldKey)||runtime?.starting.has(oldKey));
  this.log('info','Reloading: old runtime revoked.');this.revoke(s);this.emit();
  try{if(oldKey)await runtime?.stop(oldKey);if(oldDirectory)await fs.rm(oldDirectory,{recursive:true,force:true});await this.binding(s);const bundle=await this.load(s.source,s.manifest);if(this.disposed)return this.snapshot();await this.publish(s,bundle);if(bundle.manifest.main&&s.trusted&&s.restart){try{await runtime.start(s.key);this.log('info',`Snapshot ${s.generation} activated.`);}catch(error){s.restart=false;this.log('error',clean(error.message));}}else this.log('info',`Snapshot ${s.generation} ready. Activate the extension or run its command explicitly.`);}
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
    let signature;try{await this.binding(s);signature=(await this.load(s.source,s.manifest)).fingerprint;}catch(error){signature='invalid:'+error.message;}
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
  const s=this.session;if(typeof value!=='boolean'||!s||s.status==='ended')throw Error('Invalid development watch request.');s.watch=value;this.attachWatch();this.log('info',value?'Watching compiled builds. Trusted running extensions restart after a successful reload.':'Build watching stopped.');this.emit();return this.snapshot();
 });}
 end(){return this.manager.mutate(async()=>{
  const s=this.session;if(!s||s.status==='ended')return this.snapshot();const key=s.key;this.closeWatch();this.log('info','Ending development session…');this.revoke(s);s.watch=false;s.trusted=false;await this.manager.extensions?.stop(key);await fs.rm(s.temp,{recursive:true,force:true});this.roots.delete(s.temp);s.status='ended';this.log('info','Development session ended.');this.emit();return this.snapshot();
 });}
 dispose(){
  this.disposed=true;clearTimeout(this.notifyTimer);this.closeWatch();if(this.session){this.revoke(this.session);this.session.status='ended';}
  for(const root of this.roots){try{sync.rmSync(root,{recursive:true,force:true});}catch{}}this.roots.clear();
 }
}
module.exports={DevelopmentSessions};
