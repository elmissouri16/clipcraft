const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),settings=require('../../electron/system/settings.cjs');
 const originals={consent:dialog.showMessageBox,open:dialog.showOpenDialog},result={ok:false,checks:[],errors:[],consents:[],windowsShown:0};
 const watch=window=>window.on('show',()=>result.windowsShown++);BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_event,window)=>watch(window));
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(s,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(s))return;await wait(25);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);},click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const child=()=>win.contentView.children.find(v=>v.webContents?.getURL().startsWith('clipcraft-panel:'));let view;
 const pq=s=>view.webContents.executeJavaScript(s),panelUntil=async s=>{for(let i=0;i<400;i++){if(await pq(s))return;await wait(25);}throw Error('Panel timeout '+s);};
 dialog.showMessageBox=async(_parent,options)=>{result.consents.push(options);return {response:0};};
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});win.setSize(1440,1100);win.webContents.setBackgroundThrottling(false);
 const project={id:'storage-project',name:'Storage project',width:320,height:180,fps:24,ratio:'16:9',media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],markers:[]};
 const load=async p=>{await q(`window.__fve.load(${JSON.stringify(p||project)})`);await wait(100);};
 const open=async(name='Project dashboard')=>{
  if(!await q('!!document.querySelector(".plugin-panel-dock")'))await click('.plugin-panels-toggle');
  await click('button[aria-label="Choose a panel"]');await until(`[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.includes(${JSON.stringify(name+' ·')}))`);
  await q(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes(${JSON.stringify(name+' ·')})).click()`);await click('.plugin-panel-controls .btn-primary');await until('!!document.querySelector("[data-panel-phase=open]")');view=child();assert.ok(view);await wait(60);
 };
 const stop=async()=>{await q('[...document.querySelectorAll(".plugin-panel-controls button")].find(b=>b.textContent==="Stop panel").click()');await wait(80);};
 const preferences=async()=>{await panelUntil('!document.querySelector("#save-preferences").disabled');return pq('({note:document.querySelector("#note").value,count:Number(document.querySelector("#chapter-count").value)})');};
 const selectSettings=async key=>{
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section="plugins"]');
  await until(`[...document.querySelectorAll('.plugin-row')].some(e=>e.textContent.includes(${JSON.stringify(key)}))`);
  await q(`[...document.querySelectorAll('.plugin-row')].find(e=>e.textContent.includes(${JSON.stringify(key)})).click()`);
 };
 let fixtureNumber=0;
 const fixture=async({id,name,version='1.0.0',permissions=['storage.local']})=>{
  const folder=path.join(dir,'storage-fixture-'+(++fixtureNumber));fs.mkdirSync(folder);
  const m={id,name,publisher:'ClipCraft fixture',version,apiVersion:1,permissions:[],contributes:{panels:[{id:'test',name,entry:'panel.html',script:'panel.js',permissions}]}};
  fs.writeFileSync(path.join(folder,'plugin.json'),JSON.stringify(m));fs.writeFileSync(path.join(folder,'panel.html'),'<!doctype html><html><head><script src="panel.js" defer></script></head><body><h1>Storage fixture</h1><p id="result"></p></body></html>');fs.writeFileSync(path.join(folder,'panel.js'),'window.loaded=true;');
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});const rows=await q('window.api.pluginsInstall(true)');return rows.find(r=>r.manifest?.id===id&&r.manifest.version===version);
 };
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');await load();
  await open();const initial=await preferences();
  if(process.env.FVE_PANEL_STORAGE_REOPEN==='1'){
   check('saved note and chapter count survive a real Electron restart',initial.note==='Saved between sessions 🪄'&&initial.count===7);
   check('restart does not run a command or add Undo history',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
   check('opening after restart still asks for storage consent',result.consents[0].detail.includes('64 KiB')&&result.consents[0].defaultId===1);
  }else{
   check('new version starts with empty preferences',initial.note===''&&initial.count===5);
   check('per-open native consent names local storage and exact version',result.consents[0].detail.includes('64 KiB')&&result.consents[0].detail.includes('1.2.0')&&result.consents[0].detail.includes('not encrypted'));
   const info=await pq('window.clipcraftPanel.getInfo()');check('storage grant is panel-only without filesystem or editor access',info.permissions.includes('storage.local')&&await pq('typeof window.api==="undefined"&&typeof require==="undefined"&&Object.keys(window.clipcraftPanel.storage).sort().join(",")==="clear,get,keys,remove,set"'));
   await pq('document.querySelector("#note").value="Saved between sessions 🪄";document.querySelector("#note").dispatchEvent(new Event("input"));document.querySelector("#chapter-count").value="7";document.querySelector("#chapter-count").dispatchEvent(new Event("input"));document.querySelector("#save-preferences").click();void 0');
   await panelUntil('document.querySelector("#preferences-status").textContent==="Preferences saved."');
   check('dashboard saves actual typed preferences through preload and main IPC',(await pq('window.clipcraftPanel.storage.get("preferences")')).count===7);
   check('storage makes no project edit or Undo entry',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
   await stop();await open();const reopened=await preferences();check('closing and reopening restores saved controls',reopened.note==='Saved between sessions 🪄'&&reopened.count===7);
   await load({...project,id:'different-project'});check('project replacement closes the grant',!child());await open();check('local preferences survive a project change',(await preferences()).note==='Saved between sessions 🪄');
   const failure=await pq('window.clipcraftPanel.storage.set("preferences","x".repeat(16384)).then(()=>false,e=>e.message)');check('oversized data reports a recoverable quota error',typeof failure==='string'&&failure.includes('16 KiB')&&!!child());check('failed save preserves previously committed preferences',(await pq('window.clipcraftPanel.storage.get("preferences")')).count===7);
   await pq('window.clipcraftPanel.storage.set("roundtrip",{list:[true,null,3],text:"JSON"})');check('storage returns bounded JSON and enumerates keys',await pq('(async()=>{const value=await window.clipcraftPanel.storage.get("roundtrip");return value.list[2]===3&&(await window.clipcraftPanel.storage.keys()).includes("roundtrip")})()'));await pq('window.clipcraftPanel.storage.remove("roundtrip")');check('removing one key leaves preferences intact',await pq('(async()=>await window.clipcraftPanel.storage.get("roundtrip")===null&&(await window.clipcraftPanel.storage.get("preferences")).count===7)()'));
   // Native captures stay hidden. A platform capture failure is reported, never triggers show/focus.
   try{fs.writeFileSync(path.join(dir,'storage-dock.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());fs.writeFileSync(path.join(dir,'storage-panel.png'),(await view.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}catch(error){result.captureNote=error.message;}
  }
  if(process.env.FVE_PANEL_STORAGE_REOPEN==='1'){
   const rows=await q('window.api.pluginPanels()'),dashboard=rows.find(r=>r.pluginId==='clipcraft-examples.project-dashboard');
   await q(`window.api.pluginsEnable(${JSON.stringify(dashboard.key)},false)`);check('disabling revokes the live storage renderer',!child());await q(`window.api.pluginsEnable(${JSON.stringify(dashboard.key)},true)`);await open();check('disable and re-enable preserve stored preferences',(await preferences()).count===7);
   await selectSettings('Project dashboard 1.2.0');await click('[data-clear-panel-data]');check('Settings requires confirmation before clearing',await q('!!document.querySelector("[data-confirm-clear-panel-data]")')&&(await pq('window.clipcraftPanel.storage.get("preferences")')).count===7);await click('[data-confirm-clear-panel-data]');await until('!!document.querySelector("[data-panel-data-cleared]")');check('Settings clear closes the panel and reports success',!child());await click('button[aria-label="Close settings"]');await open();const cleared=await preferences();check('cleared dashboard opens with defaults',cleared.note===''&&cleared.count===5);await stop();
   const a=await fixture({id:'clipcraft-tests.storage-a',name:'Storage A'});await open('Storage A');await pq('window.clipcraftPanel.storage.set("shared-name","A private note")');await stop();
   const b=await fixture({id:'clipcraft-tests.storage-b',name:'Storage B'});await open('Storage B');check('another plugin cannot read a matching storage key',await pq('window.clipcraftPanel.storage.get("shared-name")')===null);await pq('window.clipcraftPanel.storage.set("shared-name","B private note")');await stop();
   const upgrade=await fixture({id:'clipcraft-tests.storage-a',name:'Storage A upgraded',version:'1.1.0'});await open('Storage A upgraded');check('a new package version gets an empty namespace',await pq('window.clipcraftPanel.storage.get("shared-name")')===null);await stop();await q(`window.api.pluginsEnable(${JSON.stringify(a.key)},true)`);await open('Storage A');check('returning to the exact old version restores its preferences',await pq('window.clipcraftPanel.storage.get("shared-name")')==='A private note');await stop();
   await q(`window.api.pluginsClearPanelStorage(${JSON.stringify(a.key)})`);await open('Storage B');check('clearing one version leaves another plugin’s data intact',await pq('window.clipcraftPanel.storage.get("shared-name")')==='B private note');await q(`window.api.pluginsRemove(${JSON.stringify(b.key)})`);check('removing a version also deletes its stored data',!fs.existsSync(path.join(dir,'plugins','.panel-storage',b.key))&&!child());
   const denied=await fixture({id:'clipcraft-tests.no-storage',name:'No storage',permissions:[]});await open('No storage');await pq('void window.clipcraftPanel.storage.get("shared-name").catch(()=>{});');await until('document.querySelector(".plugin-panel-controls").textContent.includes("Permission denied: storage.local")');check('undeclared storage requests fail closed',!child());
   check('all storage lifecycle actions leave project and Undo unchanged',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  }
  check('quiet E2E never shows any editor or worker window',result.windowsShown===0&&!win.isVisible());check('editor has no runtime exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;console.error(error);try{result.dom=await q('document.body.innerText.slice(-2300)');if(view&&!view.webContents.isDestroyed())result.panel=await pq('document.body.innerText');}catch{}}
 finally{dialog.showMessageBox=originals.consent;dialog.showOpenDialog=originals.open;}
 fs.writeFileSync(path.join(dir,process.env.FVE_PANEL_STORAGE_REOPEN==='1'?'reopen-result.json':'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
