const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const {dialog,BrowserWindow}=require('electron'),settings=require('../../electron/system/settings.cjs');
 const originalOpen=dialog.showOpenDialog,originalConsent=dialog.showMessageBox,result={ok:false,checks:[],errors:[],consents:[],windowsShown:0},bundle=JSON.parse(fs.readFileSync(path.join(dir,'bundle.json')));
 const watch=w=>w.on('show',()=>result.windowsShown++);BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_event,w)=>watch(w));
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const until=async(s,ms=20000)=>{for(let end=Date.now()+ms;Date.now()<end;){if(await q(s))return;await wait(25);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const child=()=>win.contentView.children.find(v=>v.webContents?.getURL().startsWith('clipcraft-panel:'));let view;
 const pq=s=>view.webContents.executeJavaScript(s),panelUntil=async s=>{for(let i=0;i<400;i++){if(await pq(s))return;await wait(25);}throw Error('Panel timeout '+s);};
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[bundle.archive]});dialog.showMessageBox=async(_parent,options)=>{result.consents.push(options);return {response:0};};
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});settings.setFirstRun({tourSeen:true,packPromptSeen:true});win.setSize(1440,1000);win.webContents.setBackgroundThrottling(false);
 const open=async()=>{await click('.plugin-panel-controls .btn-primary');await until('!!document.querySelector("[data-panel-phase=open]")');view=child();await panelUntil('document.querySelector("#status").textContent==="Panel ready."');};
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const project={id:'sdk-proof',name:'SDK proof',width:320,height:180,fps:24,media:[],videoClips:[{id:'gap',gap:true,in:0,out:8}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],markers:[]};await q(`window.__fve.load(${JSON.stringify(project)})`);
  await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('[data-section="plugins"]');await until('!!document.querySelector(".plugin-settings .settings-actions > button:not(:disabled)")');await click('.plugin-settings .settings-actions > button');
  await until('[...document.querySelectorAll(".plugin-row")].some(e=>e.textContent.includes("SDK harness"))');
  const inventory=await q('window.api.pluginsList()');check('generated archive installs through the normal Settings UI',inventory.some(row=>row.key===bundle.key&&row.enabled));check('installation executes no plugin code',!child()&&await q('window.__fve.history().past.length===0'));
  await click('button[aria-label="Close settings"]');await click('.plugin-panels-toggle');await click('button[aria-label="Choose a panel"]');await until('[...document.querySelectorAll("[role=option]")].some(e=>e.textContent.includes("SDK harness"))');await q('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.includes("SDK harness")).click()');await open();
  check('bundled SDK connects inside the real isolated panel',await pq('document.querySelector("#title").textContent==="SDK harness"&&typeof window.api==="undefined"'));
  check('opening still requires native panel approval',result.consents.length===1&&result.consents[0].defaultId===1);
  await pq('document.querySelector("#run").click();void 0');await panelUntil('document.querySelector("#status").textContent.includes("HOST_REJECTED")');check('SDK error wrapper preserves the trusted-click boundary',result.consents.length===1);
  for(let i=0;i<80;i++){const b=view.getBounds();if(view.getVisible()&&b.width>100&&b.height>100)break;await wait(25);}
  view.webContents.focus();await wait(100);const r=await pq('(()=>{const e=document.querySelector("#run");e.scrollIntoView();const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');result.input={coordinates:r,bounds:view.getBounds(),visible:view.getVisible()};view.webContents.sendInputEvent({type:'mouseMove',...r});view.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...r});view.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...r});
  await panelUntil('document.querySelector("#status").textContent==="Completed. Added 0 markers."');
  check('SDK command router executes in the real worker and returns host-verified result',result.consents.length===2&&await q('!!document.querySelector("[data-panel-action-phase=completed]")'));
  check('command approval remains per run and defaults to Cancel',result.consents[1].defaultId===1&&result.consents[1].message==='Run command');
  check('minimal scaffold adds no project edits or Undo steps',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  await pq('window.dispatchEvent(new PageTransitionEvent("pagehide"));document.querySelector("#run").click();void 0');await panelUntil('document.querySelector("#status").textContent.includes("DISPOSED")');check('generated panel lifecycle disposes its SDK client without another host request',result.consents.length===2);
  await q('[...document.querySelectorAll(".plugin-panel-controls button")].find(b=>b.textContent==="Stop panel").click()');await wait(80);await open();check('reopening creates a fresh SDK client and sandbox',await pq('document.querySelector("#status").textContent==="Panel ready."'));
  check('quiet SDK E2E never shows editor or worker windows',result.windowsShown===0&&!win.isVisible());check('editor has no runtime exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;console.error(error);try{result.dom=await q('document.body.innerText.slice(-2500)');if(view&&!view.webContents.isDestroyed())result.panel=await pq('document.body.innerText');}catch{}}
 finally{dialog.showOpenDialog=originalOpen;dialog.showMessageBox=originalConsent;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
