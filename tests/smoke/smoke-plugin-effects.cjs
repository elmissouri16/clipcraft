const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const result={checks:[],measurements:[],errors:[]};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const until=async s=>{for(let n=0;n<400;n++){if(await q(s))return;await wait(40);}throw Error('Timeout '+s);};
 const ff=require('../../electron/media/ffmpeg.cjs'),{dialog,BrowserWindow}=require('electron'),saveDialog=dialog.showSaveDialog,openDialog=dialog.showOpenDialog;
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const close=()=>q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>["Close","OK"].includes(b.textContent.trim()))?.click()');
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!message.includes('Fixture GPU rendering failure'))result.errors.push(message);});
 try {
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const definitions=await q('window.api.pluginEffects()'),effect=definitions.find(d=>d.pluginId==='clipcraft-examples.color-pulse');
  check('dev automatically loads example effect',!!effect);
  const fx=`plugin:${effect.contributionId}@${effect.digest}`;
  const source=path.join(dir,'pattern.png'),W=320,H=180;
  execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`testsrc2=s=${W}x${H}`,'-frames:v','1',source]);
  const base={id:'plugin-effect-proof',name:'Plugin effect proof',width:W,height:H,fps:24,ratio:'16:9',media:[{...await ff.probe(source),id:'m',path:source,name:'Pattern'}],videoClips:[{id:'v',mediaId:'m',in:0,out:1,speed:1,effects:[]}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  await q(`window.__fve.load(${JSON.stringify(base)});window.__fve.select({track:'video',id:'v'});window.__fve.tab('effects')`);
  await until('[...document.querySelectorAll(".tile-label")].some(e=>e.textContent==="Color pulse")');
  await q('[...document.querySelectorAll(".tile")].find(e=>e.textContent.includes("Color pulse")).click()');
  await until(`!!window.__fve.rawProject().videoClips[0].pluginEffects?.[${JSON.stringify(fx)}]`);
  check('library click pins dependency on selected clip',true);
  await q(`window.__fve.select({track:'effect',id:${JSON.stringify('video|v|'+fx)}})`);
  await until(`!!document.querySelector('.plugin-effect-controls input[aria-label="Amount value"]')`);
  await q(`(()=>{const e=document.querySelector('.plugin-effect-controls input[aria-label="Amount value"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.8');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(80);
  await q(`document.querySelector('.plugin-effect-controls input[aria-label="Amount value"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`window.__fve.rawProject().videoClips[0].pluginEffects[${JSON.stringify(fx)}].params.amount===0.8`);
  check('native inspector commits parameter edit',true);
  await q('window.__fve.dispatch({type:"undo"})');await wait(60);
  check('parameter edit supports Undo',await q(`window.__fve.rawProject().videoClips[0].pluginEffects[${JSON.stringify(fx)}].params.amount===0.6`));
  await q('window.__fve.dispatch({type:"redo"})');await wait(60);
  const project=await q('window.__fve.rawProject()'),saved=path.join(dir,'effect.clipcraft.json');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});
  await q('window.api.saveProject(JSON.stringify(window.__fve.rawProject()),null,{chat:null})');
  check('real save preserves pinned version and parameters',JSON.parse(fs.readFileSync(saved,'utf8')).videoClips[0].pluginEffects[fx].params.amount===.8);
  const reopened=await q(`window.api.openProjectPath(${JSON.stringify(saved)})`);check('real project service reopens effect file',!reopened.error);
  await q(`window.__fve.load(${JSON.stringify(JSON.parse(fs.readFileSync(saved,'utf8')))})`);
  const readPreview=async time=>{await q(`window.__fve.seek(${time})`);await wait(180);return q(`(()=>{const cv=[...document.querySelectorAll('.slot:not(.ov) canvas.keyed')].find(c=>c.style.display==='block'&&c.closest('.slot').style.visibility==='visible');return Array.from(cv.getContext('2d').getImageData(0,0,320,180).data);})()`);};
  const frames=[];for(const time of [.25,.75])frames.push({time,data:await readPreview(time)});
  check('animated effect visibly changes preview over time',frames[0].data.some((v,i)=>Math.abs(v-frames[1].data[i])>15));
  await q(`window.__fve.select({track:'effect',id:${JSON.stringify('video|v|'+fx)}})`);await wait(100);
  await q(`(()=>{const e=document.querySelector('.panel-search input');if(e){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Color pulse');e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);await wait(100);
  fs.writeFileSync(path.join(dir,'inspector.png'),(await win.capturePage()).toPNG());
  const exported=await q('window.__fve.exportNow()');check('plugin effect exports',exported.ok===true);
  const video=path.join(dir,'ui-export.mp4');
  for(const {time,data} of frames){
   const rgb=execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
   let error=0;for(let i=0;i<W*H*3;i++)error+=Math.abs(rgb[i]-data[Math.floor(i/3)*4+i%3]);error/=W*H*3;
   result.measurements.push({time,meanAbsoluteRgbError:error,tolerance:9});check(`preview/export parity at ${time}s`,error<9);
  }
  await close();
  // Updating the package keeps existing project rendering pinned until an explicit upgrade.
  const newer=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/plugins/color-pulse/plugin.json'),'utf8'));
  newer.version='1.1.0';newer.contributes.effects[0].name='Color pulse next';
  const updateFolder=path.join(dir,'effect-update');fs.mkdirSync(updateFolder);fs.writeFileSync(path.join(updateFolder,'plugin.json'),JSON.stringify(newer));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[updateFolder]});
  await q('window.api.pluginsInstall(true)');await wait(120);
  await q(`window.__fve.select({track:'effect',id:${JSON.stringify('video|v|'+fx)}})`);
  await until(`[...document.querySelectorAll('.plugin-effect-controls button')].some(b=>b.textContent==='Upgrade to installed version')`);
  const nextEffect=(await q('window.api.pluginEffects()')).find(d=>d.pluginId===effect.pluginId&&d.preferred);
  check('package update leaves saved render dependency unchanged',await q(`window.__fve.rawProject().videoClips[0].effects[0]===${JSON.stringify(fx)}`));
  await q(`[...document.querySelectorAll('.plugin-effect-controls button')].find(b=>b.textContent==='Upgrade to installed version').click()`);await wait(100);
  const nextId=`plugin:${nextEffect.contributionId}@${nextEffect.digest}`;
  check('explicit inspector upgrade switches version and keeps parameters',await q(`window.__fve.rawProject().videoClips[0].pluginEffects[${JSON.stringify(nextId)}]?.params.amount===0.8&&!!document.querySelector('.plugin-effect-controls')`));
  await q('window.__fve.dispatch({type:"undo"})');await wait(80);
  check('version upgrade is undoable',await q(`window.__fve.rawProject().videoClips[0].effects[0]===${JSON.stringify(fx)}`));
  // New hidden-frame renderer must receive definitions too (used by covers/agent inspection).
  const cover=await q(`window.api.exportCoverFrame(window.__fve.rawProject(),0.25)`);
  check('offscreen composition supports plugin effects',cover.ok===true);
  await q(`window.api.pluginsEnable(${JSON.stringify(nextEffect.digest)},false)`);await wait(100);
  const blocked=await q('window.__fve.exportNow()');check('disabled required plugin blocks export',!!blocked.error&&blocked.error.includes('Plugin effects need attention'));
  await close();
  await q(`window.__fve.select({track:'effect',id:${JSON.stringify('video|v|'+fx)}})`);await until('!!document.querySelector(".plugin-effect-controls [role=alert]")');
  check('missing effect is visible in inspector',true);
  await click('.plugin-effect-controls input[type=checkbox]');await wait(80);
  const bypass=await q('window.__fve.exportNow()');check('explicit instance disable allows export',bypass.ok===true);await close();
  // Restore and exercise an independent timed effect on the Effects track.
  await q(`window.api.pluginsEnable(${JSON.stringify(effect.digest)},true)`);await wait(100);
  await q(`window.__fve.load(${JSON.stringify(base)});window.__fve.dispatch({type:'addEffectClip',clipId:'free-plugin',fx:${JSON.stringify(fx)},at:0,duration:1});`);await wait(100);
  check('Effects-track insertion pins dependency',await q('!!window.__fve.rawProject().effectClips[0].pluginEffect?.digest'));
  check('Effects-track plugin exports',(await q('window.__fve.exportNow()')).ok===true);await close();
  await q(`window.__fve.dispatch({type:'update',track:'effect',id:'free-plugin',patch:{strength:0.77}})`);await wait(60);
  await q(`(async()=>{const m=await import('/src/features/effects/gl.js');window.__pluginOriginalEffects=m.FxGL.prototype.effects;m.FxGL.prototype.effects=function(){throw Error('Fixture GPU rendering failure');};})()`);
  const renderingFailure=await q('window.__fve.exportNow()');
  check('rendering failure is reported instead of successful bypass',renderingFailure.error?.includes('Fixture GPU rendering failure'));
  await q(`(async()=>{const m=await import('/src/features/effects/gl.js');m.FxGL.prototype.effects=window.__pluginOriginalEffects;delete window.__pluginOriginalEffects;})()`);await close();

  // A plugin surface must not gain any editor or native privileges.
  check('no renderer runtime errors',result.errors.length===0);
 }catch(error){result.error=error.stack;result.dom=await q('document.body.innerText.slice(-2500)');}
 finally{dialog.showSaveDialog=saveDialog;dialog.showOpenDialog=openDialog;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
