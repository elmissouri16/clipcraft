const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async code => {for(let i=0;i<250;i++){if(await q(code))return;await wait(40);}throw Error('Timeout: '+code);};
  const result = {checks:[],errors:[]}, check = (name, ok) => {assert.ok(ok,name);result.checks.push(name);};
  const reload = async () => {await new Promise(r => {win.webContents.once('did-finish-load',r);win.webContents.reload();});await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');};
  const project = (id,name) => ({id,name,ratio:'16:9',width:640,height:360,fps:30,media:[],videoClips:[],overlayClips:[],audioClips:[],textClips:[{id:'title',text:'Keep my work',start:0,duration:5}]});
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    const saved = project('recovery-saved','Autosaved work');
    await q(`window.api.slotWrite(${JSON.stringify({id:saved.id,title:saved.name,projectJson:JSON.stringify(saved),updatedAt:Date.now()})})`);
    await q(`localStorage.setItem('clipcraft.recovery',${JSON.stringify(JSON.stringify({project:saved,savedAt:Date.now(),file:null,unsaved:true}))})`);
    await reload();await until('!!document.querySelector(".home-card")');await wait(200);
    check('autosaved project has a Home card without a duplicate warning',await q('!document.querySelector(".home-recover")&&document.querySelector(".home-card-name").textContent==="Autosaved work"'));
    await q('document.querySelector(".home-card-open").click()');await until('!!document.querySelector(".topbar")');
    check('opening autosaved work restores its content without an editor banner',await q('window.__fve.rawProject().textClips[0].text==="Keep my work"&&!document.querySelector(".recovered-note")'));
    const legacy = project('legacy-recovery','Legacy recovery');
    await q(`localStorage.setItem('clipcraft.recovery',${JSON.stringify(JSON.stringify({project:legacy,savedAt:Date.now(),file:null,unsaved:true}))})`);
    await reload();await until('!!document.querySelector(".home-recover")');
    check('legacy recovery stays available on Home with accurate wording',await q('document.querySelector(".home-recover").textContent.includes("Recover a previous session")&&!document.querySelector(".home-recover").textContent.includes("not saved")'));
    await q('document.querySelector(".home-recover .btn-primary").click()');await until('!!document.querySelector(".topbar")');
    check('legacy recovery still restores the project',await q('window.__fve.rawProject().name==="Legacy recovery"&&window.__fve.rawProject().textClips[0].text==="Keep my work"&&!document.querySelector(".recovered-note")'));
    await until('window.api.slotRead("legacy-recovery").then(s=>s?.project?.name==="Legacy recovery")');
    await reload();await until('document.querySelectorAll(".home-card").length===2');await wait(200);
    check('restored work autosaves and does not prompt again after restart',await q('!document.querySelector(".home-recover")'));
    check('no renderer errors',!result.errors.length);
    fs.writeFileSync(path.join(dir,'home.png'),(await win.capturePage()).toPNG());
  }catch(error){result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
