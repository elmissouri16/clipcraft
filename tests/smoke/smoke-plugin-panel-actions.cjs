const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const quiet=process.env.FVE_SMOKE_QUIET==='1';let shown=0;win.on('show',()=>shown++);
 const {dialog}=require('electron'),settings=require('../../electron/system/settings.cjs');
 const originalOpen=dialog.showOpenDialog,originalConsent=dialog.showMessageBox,result={ok:false,checks:[],errors:[],consents:[]};let approval=true,hold=false,pendingConsent;
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(s,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(s))return;await wait(30);}throw Error('Timeout '+s);};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);},click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const child=()=>win.contentView.children.find(v=>v.webContents?.getURL().startsWith('clipcraft-panel:'));
 let view;const pq=s=>view.webContents.executeJavaScript(s);
 const panelUntil=async(s)=>{for(let i=0;i<400;i++){if(await pq(s))return;await wait(25);}throw Error('Panel timeout '+s);};
 const trusted=async selector=>{
  if(!quiet){win.show();win.focus();}view.webContents.focus();
  const rect=await pq(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  view.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect});view.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect});
 };
 dialog.showMessageBox=async(_parent,options)=>{result.consents.push(options);if(hold&&options.message==='Fixture action')return new Promise(resolve=>{pendingConsent=resolve;});return {response:approval?0:1};};
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});win.setSize(1440,1100);win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});
 const project={id:'panel-action-proof',name:'Panel action project',width:320,height:180,fps:24,ratio:'16:9',media:[],videoClips:[{id:'gap',gap:true,in:0,out:10}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],markers:[]};
 const load=async(p=project)=>{await q(`window.__fve.load(${JSON.stringify(p)})`);await wait(100);};
 const open=async name=>{
  if(!await q('!!document.querySelector(".plugin-panel-dock")'))await click('.plugin-panels-toggle');
  await click('button[aria-label="Choose a panel"]');await until(`[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`);
  await q(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);await click('.plugin-panel-controls .btn-primary');
  await until('!!document.querySelector("[data-panel-phase=open]")');view=child();assert.ok(view);await wait(80);
 };
 const stop=async()=>{await q('[...document.querySelectorAll(".plugin-panel-controls button")].find(b=>b.textContent==="Stop panel").click()');await wait(100);};
 let fixtureIndex=0;
 const fixture=async(code)=>{
  const folder=path.join(dir,'actions-fixture-'+(++fixtureIndex));fs.mkdirSync(folder);const name='Actions fixture '+fixtureIndex;
  const manifest={id:'clipcraft-tests.panel-action-'+fixtureIndex,name,publisher:'ClipCraft fixtures',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:['project.read','markers.write'],contributes:{commands:[{id:'test',name:'Fixture action',parameters:[]}],panels:[{id:'test',name,entry:'panel.html',script:'panel.js',commands:['test'],permissions:['project.read']}]}};
  fs.writeFileSync(path.join(folder,'plugin.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(folder,'commands.js'),code);
  fs.writeFileSync(path.join(folder,'panel.html'),'<!doctype html><html><head><script src="panel.js" defer></script></head><body><h1>Action fixture</h1><button id="run">Run action</button><button id="cancel">Cancel action</button><p id="result"></p></body></html>');
  fs.writeFileSync(path.join(folder,'panel.js'),`window.progress=[];window.clipcraftPanel.commands.onProgress(p=>window.progress.push(p));window.run=async()=>{try{window.outcome=await window.clipcraftPanel.commands.run(window.nextCommand||'test',window.nextInput||{});}catch(e){window.outcome={error:e.message};}document.querySelector('#result').textContent=JSON.stringify(window.outcome);};document.querySelector('#run').addEventListener('click',()=>{window.outcome=null;window.run();});document.querySelector('#cancel').addEventListener('click',()=>window.clipcraftPanel.commands.cancel());`);
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});const rows=await q('window.api.pluginsInstall(true)');return rows.find(r=>r.manifest?.id===manifest.id);
 };
 const slow=`export async function run(ctx){await ctx.markers.add([{time:1,label:'Staged marker'}]);await ctx.progress(.4,'Waiting');await new Promise(r=>setTimeout(r,1200));return {message:'999 markers added'};}`;
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');await load();
  await open('Project dashboard');await panelUntil('!!document.querySelector("#add-chapters")');
  const info=await pq('window.clipcraftPanel.getInfo()');check('panel sees only its declared action and typed parameters',result.consents[0].detail.includes('Declared actions: Add chapter markers')&&info.commands.length===1&&info.commands[0].id==='add-chapter-markers'&&info.commands[0].parameters[0].max===20&&!JSON.stringify(info).includes('token'));
  const approvals=result.consents.length;
  const untrusted=await pq('window.clipcraftPanel.commands.run("add-chapter-markers",{count:5}).catch(e=>({error:e.message}))');check('automatic calls cannot request native command approval',untrusted.error.includes('Click')&&result.consents.length===approvals);
  await pq('document.querySelector("#add-chapters").click();void 0');await wait(100);check('synthetic clicks cannot authorize actions',result.consents.length===approvals&&await q('window.__fve.rawProject().markers.length===0'));
  await trusted('#add-chapters');await panelUntil('document.querySelector("#action-status").textContent==="Added 5 chapter markers."');
  check('trusted action runs real worker and commits actual chapter markers',await q('JSON.stringify(window.__fve.rawProject().markers.map(m=>m.time))==="[0,2,4,6,8]"'));
  check('per-run native prompt defaults to Cancel and names package permissions',result.consents.at(-1).defaultId===1&&result.consents.at(-1).detail.includes('1.2.0')&&result.consents.at(-1).detail.includes('markers'));
  check('panel action produces exactly one Undo entry',await q('window.__fve.history().past.length===1'));
  await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('one Undo removes all panel markers',await q('window.__fve.rawProject().markers.length===0'));
  await q('window.__fve.dispatch({type:"redo"})');await wait(80);check('one Redo restores the panel edit',await q('window.__fve.rawProject().markers.length===5'));
  await trusted('#add-chapters');await panelUntil('document.querySelector("#action-status").textContent==="Added 0 chapter markers."');check('duplicate proposals report actual zero and add no Undo entry',await q('window.__fve.history().past.length===1')&&result.consents.length===approvals+2);
  // Capture real child pixels separately; macOS host capture omits native subviews.
  if(!quiet){win.show();win.focus();}await wait(350);fs.writeFileSync(path.join(dir,'panel-action-dock.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  try{fs.writeFileSync(path.join(dir,'panel-action-content.png'),(await view.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}catch(error){result.captureNote=error.message;}
  approval=false;await trusted('#add-chapters');await panelUntil('document.querySelector("#action-status").textContent.includes("Approval declined")');
  check('declining approval preserves markers and disables further attempts',await pq('document.querySelector("#add-chapters").disabled')&&await q('window.__fve.history().past.length===1'));approval=true;await stop();await load();
  let row=await fixture(slow);await open(row.manifest.name);await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await trusted('#cancel');await panelUntil('window.outcome?.status==="canceled"');await wait(1300);
  check('panel Cancel discards staged edits and late worker completion',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  check('panel receives bounded owned progress without host data',await pq('window.progress.some(p=>p.phase==="running")&&window.progress.every(p=>Object.keys(p).sort().join(",")==="phase,progress")'));
  await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await stop();await wait(1300);check('closing panel cancels its staged action',await q('window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  await open(row.manifest.name);await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual change"}})');await panelUntil('window.outcome?.status==="failed"');check('concurrent manual edit refuses the action result',await q('window.__fve.rawProject().markers.length===0&&window.__fve.rawProject().name==="Manual change"'));await stop();await load();
  await open(row.manifest.name);await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await load({...project,id:'replacement'});await wait(1300);check('project replacement cancels staged action without reopening',!child()&&await q('window.__fve.rawProject().id==="replacement"&&window.__fve.rawProject().markers.length===0&&window.__fve.history().past.length===0'));
  await open(row.manifest.name);await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},false)`);await wait(1300);check('package revocation closes panel and discards work',!child()&&await q('window.__fve.rawProject().markers.length===0'));await q(`window.api.pluginsEnable(${JSON.stringify(row.key)},true)`);
  await open(row.manifest.name);hold=true;await trusted('#run');for(let i=0;i<200&&!pendingConsent;i++)await wait(10);assert.ok(pendingConsent);await stop();hold=false;pendingConsent({response:0});pendingConsent=null;await wait(200);check('late native approval after panel closure cannot run or commit',!child()&&await q('window.__fve.rawProject().markers.length===0'));
  await open(row.manifest.name);hold=true;await trusted('#run');for(let i=0;i<200&&!pendingConsent;i++)await wait(10);assert.ok(pendingConsent);await load({...project,id:'approval-replacement'});hold=false;pendingConsent({response:0});pendingConsent=null;await wait(200);check('project replacement cancels outstanding approval',!child()&&await q('window.__fve.rawProject().markers.length===0'));
  await open(row.manifest.name);await trusted('#run');await until('!!document.querySelector("[data-panel-action-phase=running]")');await click('button[aria-label="Settings"]');await until('!!document.querySelector(".settings2")');await click('button[aria-label="Close settings"]');await panelUntil('window.outcome?.status==="completed"');check('Settings lifecycle leaves a panel-owned action running',await pq('window.outcome.markers_added===1')&&await q('window.__fve.rawProject().markers.length===1'));check('plugin success text cannot forge the actual result count',await pq('JSON.stringify(window.outcome)==="{\\"status\\":\\"completed\\",\\"markers_added\\":1}"'));await stop();await load();
  await open(row.manifest.name);await q('window.__fve.dispatch({type:"beginGesture"})');await trusted('#run');await panelUntil('window.outcome?.status==="failed"');check('active user gesture prevents panel edits',await q('window.__fve.rawProject().markers.length===0'));await q('window.__fve.dispatch({type:"endGesture"})');
  await q('window.__fve.dispatch({type:"beginAgentEdit",token:"panel-test-agent"})');await trusted('#run');await panelUntil('window.outcome?.status==="failed"');check('agent edit ownership prevents panel edits',await q('window.__fve.rawProject().markers.length===0'));await stop();await load();
  await open(row.manifest.name);const request={runId:'unrelated-manual',key:row.key,commandId:'test',input:{},snapshot:{duration_sec:10,fps:24,markers:[],markers_total:0}};
  await q(`window.__manualResult=null;window.api.pluginsRunCommand(${JSON.stringify(request)}).then(r=>{window.__manualResult=r});void 0`);await wait(150);await stop();await until('!!window.__manualResult');check('closing an idle panel never cancels an unrelated command',await q('window.__manualResult.status==="completed"&&window.__fve.rawProject().markers.length===0'));
  await open(row.manifest.name);await pq('window.nextInput={unexpected:1}');await trusted('#run');await wait(150);check('malformed input fails closed without edits',!child()&&await q('window.__fve.rawProject().markers.length===0'));
  await open(row.manifest.name);await pq('window.nextCommand="other-package-command"');await trusted('#run');await wait(150);check('undeclared cross-package command fails closed',!child()&&await q('window.__fve.rawProject().markers.length===0'));
  if(quiet)check('quiet test never shows the editor',shown===0&&!win.isVisible());
  check('editor has no runtime exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.error=error.stack;console.error(error);try{result.dom=await q('document.body.innerText.slice(-2500)');if(view&&!view.webContents.isDestroyed())result.panel=await pq('document.body.innerText');}catch{}}
 finally{dialog.showMessageBox=originalConsent;dialog.showOpenDialog=originalOpen;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
