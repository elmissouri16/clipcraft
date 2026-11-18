// Interrupt the real service at a known durable-removal boundary, without cleanup.
const fs=require('node:fs/promises'),path=require('node:path');
const {PluginManager}=require('../../electron/plugins/manager.cjs');
(async()=>{
 const [root,key,phase]=process.argv.slice(2),manager=new PluginManager(root,'2.0.0'),save=manager.save.bind(manager),clear=manager.panelStorage.clearVersion.bind(manager.panelStorage),rm=fs.rm;
 const stop=()=>process.kill(process.pid,'SIGKILL');
 manager.save=async rows=>{await save(rows);if(phase==='marked'&&rows.some(r=>r.key===key&&r.removing))stop();};
 manager.panelStorage.clearVersion=async key=>{await clear(key);if(phase==='preferences')stop();};
 fs.rm=async(file,options)=>{const result=await rm(file,options);if(phase==='payload'&&file===path.join(root,key))stop();return result;};
 await manager.remove(key);throw Error('Interruption point was not reached');
})().catch(error=>{console.error(error);process.exitCode=1;});
