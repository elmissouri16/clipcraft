// Verify moved window resources and preloads without recording screen/camera.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');

module.exports = async (win, app, dir) => {
  fs.mkdirSync(dir,{recursive:true});
  const result={checks:[],errors:[]};
  const q=code=>win.webContents.executeJavaScript(code);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async run=>{for(let i=0;i<100;i++){if(await run())return;await wait(50);}throw new Error('Moved window resource did not become ready.');};
  const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
  let camera;
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});
  try {
    await until(()=>q('!!window.__fve && !!document.querySelector(".home-frame-card")'));
    check('renderer shell loads from the feature folders',await q('!!document.querySelector(".home-frame-card")'));
    check('moved font service remains accessible through the preload',Array.isArray(await q('window.api.fontsList()')));
    await q('window.api.screenBar(true)');
    const bar=()=>BrowserWindow.getAllWindows().find(window=>window!==win&&!window.isDestroyed()&&window.webContents.getURL().endsWith('/recbar.html'));
    await until(async()=>!!bar()&&await bar().webContents.executeJavaScript('!!window.recbar && !!document.getElementById("time")'));
    await q('window.api.screenBarState({seconds:65,paused:true})');
    await until(()=>bar().webContents.executeJavaScript('document.getElementById("time").textContent==="01:05"'));
    check('recording bar HTML, script and preload work from the recording folder',await bar().webContents.executeJavaScript('document.getElementById("pause").textContent==="Resume"'));
    await q('window.api.screenBar(false)');

    // No config message is sent: the camera script opens a device only after
    // receiving a configured deviceId. This tests assets/bridge without capture.
    const recording=path.resolve(__dirname,'../../electron/recording');
    camera=new BrowserWindow({show:false,width:240,height:240,webPreferences:{preload:path.join(recording,'cambubble-preload.cjs'),contextIsolation:true,nodeIntegration:false}});
    await camera.loadFile(path.join(recording,'cambubble.html'));
    check('camera window HTML, script and preload load together',await camera.webContents.executeJavaScript('!!window.cambubble && !!document.getElementById("c").getContext("2d")'));
    check('window resource check opens no camera stream',await camera.webContents.executeJavaScript('document.getElementById("v").srcObject===null'));
    check('no renderer errors',result.errors.length===0);
  } catch(error) {result.failure=error.stack;}
  finally {camera?.destroy();await q('window.api.screenBar(false)').catch(()=>{});}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.exit(result.failure?1:0);
};
