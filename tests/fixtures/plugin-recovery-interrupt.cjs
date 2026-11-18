const {PluginManager}=require('../../electron/plugins/manager.cjs');
(async()=>{
 const [root,phase]=process.argv.slice(2),manager=new PluginManager(root,'2.0.0'),store=manager.inventoryStore,review=await manager.prepareRecovery();
 if(phase==='archive'){
  const preserve=store.preserve.bind(store);store.preserve=async(file,bytes)=>{await preserve(file,bytes);if(file.endsWith('recovery.json'))process.kill(process.pid,'SIGKILL');};
 }else{
  const fs=require('node:fs/promises'),path=require('node:path'),rename=fs.rename;
  fs.rename=async(from,to)=>{await rename(from,to);if(phase==='index'&&to===path.join(root,'inventory.json')||phase==='artifact'&&path.dirname(to)!==root&&path.basename(from).startsWith('.install-'))process.kill(process.pid,'SIGKILL');};
 }
 await manager.recover(review.token);throw Error('Interrupt point did not execute');
})().catch(error=>{console.error(error);process.exitCode=1;});
