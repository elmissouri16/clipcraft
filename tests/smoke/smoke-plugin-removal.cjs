const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),{PluginManager}=require('../../electron/plugins/manager.cjs'),reopen=process.env.FVE_PLUGIN_REMOVAL_REOPEN==='1';
 const original={open:dialog.showOpenDialog,consent:dialog.showMessageBox,rm:fsp.rm},result={ok:false,reopen,checks:[],errors:[],windowsShown:0};
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),click=require('./pluginSettingsUi.cjs')(win).click;
 const until=async(s,ms=15000)=>{for(const end=Date.now()+ms;Date.now()<end;){if(await q(s))return;await wait(25);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);},root=path.join(dir,'plugins');
 const watch=w=>w.on('show',()=>result.windowsShown++);BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_e,w)=>watch(w));
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(dir,'dashboard.tgz')]});dialog.showMessageBox=async()=>({response:0});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);
 const settings=async()=>{await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section="plugins"]');await until('!!document.querySelector("[data-install-plugin]:not(:disabled)")');};
 const select=async text=>{await until(`[...document.querySelectorAll('.plugin-row')].some(e=>e.textContent.includes(${JSON.stringify(text)}))`);await require('./pluginSettingsUi.cjs')(win).show('installed');await q(`[...document.querySelectorAll('.plugin-row')].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`);};
 let fixture,baseline;
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const project={id:'removal-proof',name:'Removal proof',width:320,height:180,fps:24,media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],markers:[{id:'keep',time:2,label:'Keep project settings'}]};
  await q(`window.__fve.load(${JSON.stringify(project)})`);await wait(80);baseline=await q('JSON.stringify(window.__fve.rawProject())');await settings();
  if(!reopen){
   await click('[data-install-plugin]');await select('Project dashboard');const [row]=await q('window.api.pluginsList()'),panel=row.manifest.legacyPreferences.panels[0];fixture={key:row.key,panelId:panel.id};fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(fixture));
   const manager=new PluginManager(root,app.getVersion());assert.equal((await manager.panelStorage.execute(row.key,panel.id,'set',{key:'note',value:'Remove saved panel data'},async()=>{})).ok,true);
   check('actual installed panel preferences exist before removal',fs.existsSync(path.join(root,'.panel-storage',row.key,panel.id+'.json')));
   let failures=0;fsp.rm=async(file,options)=>{if(file===path.join(root,row.key)){failures++;throw Object.assign(Error('Payload is temporarily busy. Retry removal.'),{code:'EBUSY'});}return original.rm(file,options);};
   await click('[data-remove-plugin]');await click('[data-confirm-remove-plugin]');await until('!!document.querySelector("[data-removal-pending]")&&!document.querySelector("[data-remove-plugin]").disabled');
   result.inventory=await q('window.api.pluginsList()');check('failure publishes visible disabled pending removal',failures===1&&result.inventory[0].removing===true&&result.inventory[0].enabled===false&&result.inventory[0].manifest===undefined);
   check('cleanup failure preserves the original actionable error',await q('document.querySelector(".plugin-settings .error-text")?.textContent.includes("Payload is temporarily busy")'));
   check('pending removal offers one retry control without a duplicate confirmation',await q('document.querySelector("[data-remove-plugin]").textContent==="Retry removal"&&!document.querySelector("[data-confirm-remove-plugin]")&&!document.querySelector("[data-clear-panel-data]")&&!document.querySelector(".plugin-command")'));
   check('retired panel never opens during removal',!win.contentView.children.some(v=>v.webContents?.getURL().startsWith('clipcraft-panel:')));
   check('preferences are deleted but the retryable payload remains',!fs.existsSync(path.join(root,'.panel-storage',row.key))&&fs.existsSync(path.join(root,row.key)));
   check('no extension process belongs to the pending version',(await q('window.api.pluginsExtensionStatus()')).length===0);
   fs.writeFileSync(path.join(root,'user-note.txt'),'keep');fsp.rm=original.rm;
   fs.writeFileSync(path.join(dir,'pending-removal.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  }else{
   fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixture.json')));await select(fixture.key.slice(0,12));await until('!!document.querySelector("[data-removal-pending]")');
   const [row]=await q('window.api.pluginsList()');check('fresh process preserves pending removal and disabled activation',row.key===fixture.key&&row.removing===true&&row.enabled===false);
   check('restart does not automatically execute or reinstall the pending package',row.manifest===undefined&&(await q('window.api.pluginsExtensionStatus()')).length===0);
   const denied=await q(`window.api.pluginsEnable(${JSON.stringify(fixture.key)},true).then(()=>null,e=>e.message)`);check('native activation refuses pending removal',denied?.includes('removal is pending'));
   await click('[data-remove-plugin]');await until('document.querySelectorAll(".plugin-row").length===0');
   check('explicit Settings retry completes and removes the inventory entry',(await q('window.api.pluginsList()')).length===0);
   check('retry deletes all remaining package and preference files',!fs.existsSync(path.join(root,fixture.key))&&!fs.existsSync(path.join(root,'.panel-storage',fixture.key)));
   check('retry preserves unrelated user files',fs.readFileSync(path.join(root,'user-note.txt'),'utf8')==='keep');
   await click('[data-install-plugin]');await select('Project dashboard');const [installed]=await q('window.api.pluginsList()');const data=JSON.parse(fs.readFileSync(path.join(root,'inventory.json')));check('later clean reinstall succeeds after removal completes',installed.key===fixture.key&&installed.enabled===false&&data[0].removing===undefined);check('reinstall does not restore deleted panel preferences',!fs.existsSync(path.join(root,'.panel-storage',fixture.key)));
  }
  check('removal operations preserve the whole project and Undo state',await q(`JSON.stringify(window.__fve.rawProject())===${JSON.stringify(baseline)}&&window.__fve.history().past.length===0`));check('every test window stays hidden',result.windowsShown===0&&!win.isVisible());check('editor has no runtime exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;try{result.dom=await q('document.body.innerText.slice(-3500)');}catch{}}
 finally{dialog.showOpenDialog=original.open;dialog.showMessageBox=original.consent;fsp.rm=original.rm;}
 fs.writeFileSync(path.join(dir,reopen?'reopen-result.json':'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
