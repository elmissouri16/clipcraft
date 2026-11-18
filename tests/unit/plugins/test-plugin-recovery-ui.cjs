// Damaged inventory at startup, explicit Settings recovery, then a real process restart.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),net=require('node:net'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-plugin-recovery-ui-'));
 const {PluginManager}=require('../../../electron/plugins/manager.cjs'),manager=new PluginManager(path.join(dir,'plugins'),'2.0.0');
 await manager.install(path.join(root,'tests/fixtures/plugins/legacy/project-dashboard'),true);await manager.install(path.join(root,'examples/plugins/color-pulse'),true);const rows=await manager.install(path.join(root,'examples/plugins/review-copy'),true),dashboard=rows.find(r=>r.manifest.legacyPreferences?.panels?.length),effect=(await manager.effects())[0],pending=rows.find(r=>r.manifest.contributes.exportPresets.length),panel=dashboard.manifest.legacyPreferences.panels[0];
 assert.equal((await manager.panelStorage.execute(dashboard.key,panel.id,'set',{key:'note',value:'Keep my saved dashboard note'},async()=>{})).ok,true);
 const data=await manager.inventory();data.find(r=>r.key===pending.key).removing=true;data.find(r=>r.key===pending.key).enabled=false;await manager.save(data);await manager.save(data);
 const invalid='c'.repeat(64);await fsp.mkdir(path.join(manager.root,invalid));await fsp.writeFile(path.join(manager.root,invalid,'plugin.json'),'invalid payload');await fsp.mkdir(path.join(manager.root,'.install-Aa12Bb'));await fsp.writeFile(path.join(manager.root,'.install-Aa12Bb','keep'),'unfinished files');await fsp.writeFile(path.join(manager.root,'personal-note.txt'),'Unrelated data');const raw='[{"key":"truncated inventory';await fsp.writeFile(path.join(manager.root,'inventory.json'),raw);
 fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify({dashboard:dashboard.key,panel:panel.id,effect,pending:pending.key,invalid,raw,preferences:fs.readFileSync(path.join(manager.root,'.panel-storage',dashboard.key,panel.id+'.json'),'utf8')}));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port,vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  for(const reopen of [false,true]){
   electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-recovery',FVE_PLUGIN_RECOVERY_REOPEN:reopen?'1':'0',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
   const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},60000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
   const result=JSON.parse(fs.readFileSync(path.join(dir,reopen?'reopen-result.json':'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);
  }
  console.log('Inventory recovery/restart/explicit activation passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
