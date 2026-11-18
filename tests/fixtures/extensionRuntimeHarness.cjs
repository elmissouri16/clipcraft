// The real ExtensionRuntime and the real extensionWorker.cjs under plain Node. Only Electron's
// utilityProcess (a forked child that emulates process.parentPort), safeStorage and the plugin
// manager are stand-ins, so lifecycle and host-call behaviour can be tested without a window.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{fork}=require('node:child_process'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'../..');
if(process.env.CLIPCRAFT_EXTENSION_WORKER){
 const port=new EventEmitter();port.postMessage=message=>{if(process.connected)process.send(message);};
 process.on('message',data=>port.emit('message',{data}));process.on('disconnect',()=>process.exit(0));
 process.parentPort=port;require(process.env.CLIPCRAFT_EXTENSION_WORKER);
}else{
 const utilityProcess={fork(file,_args,{env,cwd}={}){
  const child=fork(__filename,[],{env:{...env,CLIPCRAFT_EXTENSION_WORKER:file},cwd,stdio:['pipe','pipe','pipe','ipc'],serialization:'advanced'}),worker=new EventEmitter();
  Object.assign(worker,{stdout:child.stdout,stderr:child.stderr,pid:child.pid,postMessage:message=>{if(child.connected)child.send(message);},kill:()=>child.kill('SIGKILL')});
  child.on('message',message=>worker.emit('message',message));child.on('exit',code=>worker.emit('exit',code));child.on('error',()=>{});return worker;
 }};
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('enc:'+value),decryptString:bytes=>String(bytes).slice(4)};
 // extensions: {key:{manifest:{id,...},code:'exports.activate=…'}}. Every package is enabled and trusted.
 function createHost(extensions,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-extension-harness-')),plugins=path.join(dir,'plugins'),rows=[];
  for(const [key,{manifest,code}] of Object.entries(extensions)){
   fs.mkdirSync(path.join(plugins,key,'dist'),{recursive:true});fs.writeFileSync(path.join(plugins,key,'dist/extension.cjs'),code);
   rows.push({key,enabled:true,manifest:{publisher:'Tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',activationEvents:[],name:manifest.id,...manifest,contributes:{commands:[],views:[],...manifest.contributes}}});
  }
  const manager={root:plugins,development:null,async commandBundle(key){const row=rows.find(entry=>entry.key===key);if(!row)throw Error('Unknown plugin');return {manifest:row.manifest};},async list(){return rows;}};
  const {ExtensionRuntime}=require(path.join(root,'electron/plugins/extensionRuntime.cjs')),host=new ExtensionRuntime({manager,utilityProcess,safeStorage,...options});
  fs.mkdirSync(host.root,{recursive:true});fs.writeFileSync(path.join(host.root,'trust.json'),JSON.stringify(Object.fromEntries(rows.map(row=>[row.key,true]))));
  return {host,rows,dir,async close(){await host.dispose().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}};
 }
 module.exports={createHost,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
}
