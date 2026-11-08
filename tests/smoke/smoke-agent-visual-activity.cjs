// Real editor/export/player; only reasoning and image inference are fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const local=require('../../electron/agents/localAgents.cjs'),settings=require('../../electron/system/settings.cjs'),ff=require('../../electron/media/ffmpeg.cjs');
 const {FxJobs}=require('../../electron/export/fxjobs.cjs'),{execFileSync}=require('node:child_process'),{ipcMain}=require('electron');
 const original={run:local.runEditorNative,status:local.status,image:local.generateImage,write:FxJobs.prototype.write};
 const result={checks:[],errors:[]},q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<500;i++){if(await q(code))return;await wait(30);}throw Error('Timeout: '+code);};
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const click=selector=>q(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const shot=async name=>{await wait(350);fs.writeFileSync(path.join(dir,name),(await win.capturePage()).toPNG());};
 let sources=[];
 if(process.env.FVE_VISUAL_ACTIVITY_PROJECT){const input=JSON.parse(fs.readFileSync(process.env.FVE_VISUAL_ACTIVITY_PROJECT,'utf8')),p=input.project||input;sources=p.videoClips.slice(0,3).map(c=>p.media.find(m=>m.id===c.mediaId));}
 if(sources.length<3)for(let i=sources.length;i<3;i++){
  const file=path.join(dir,`scene-${i}.png`);execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`testsrc2=s=320x180:r=12:d=1`,'-frames:v','1',file]);sources.push({path:file,type:'image',width:320,height:180});
 }
 const wav=path.join(dir,'speech.wav');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=8',wav]);
 const fixture=id=>({id,name:'Visual editing story',width:320,height:180,ratio:'16:9',fps:12,
  media:[{...sources[0],id:'m1',name:'Opening scene'},{...sources[1],id:'m2',name:'Second scene'},{id:'speech',type:'audio',path:wav,duration:8,hasAudio:true}],
  videoClips:[{id:'v1',mediaId:'m1',in:0,out:4,effects:['fx_grainfine']},{id:'v2',mediaId:'m2',in:0,out:4,effects:['fx_grainfine']}],overlayClips:[],
  audioClips:[{id:'a',mediaId:'speech',in:0,out:8,start:0,volume:.1}],textClips:[{id:'c',caption:true,text:'Opening caption',start:.5,duration:2,y:.8}],effectClips:[]});
 let cancelRun=false,exportFile=path.join(dir,'finished-story.mp4'),openPath,revealedPath;
 local.status=async()=>({ok:true,authenticated:true,version:'visual-activity-fixture'});
 local.generateImage=async(_cfg,req)=>{fs.mkdirSync(req.outputDir,{recursive:true});const file=path.join(req.outputDir,'new-scene.png');fs.copyFileSync(sources[2].path,file);return {path:file,source:'fixture',prompt:req.prompt};};
 FxJobs.prototype.write=async function(...args){await wait(180);return original.write.apply(this,args);};
 ipcMain.removeHandler('shell:open');ipcMain.handle('shell:open',(_e,file)=>{openPath=file;});
 ipcMain.removeHandler('shell:show');ipcMain.handle('shell:show',(_e,file)=>{revealedPath=file;});
 local.runEditorNative=async(_cfg,options)=>{
  const call=async(name,args={})=>{const data=JSON.parse((await options.onTool(name,args)).content[0].text);if(data.error)throw Error(data.error);return data;};
  if(!cancelRun){
   await call('generate_image',{prompt:'A misty stone archway, soft evening light and quiet cinematic atmosphere.',as:'overlay',start_sec:4,duration_sec:2});
   await until('[...document.querySelectorAll("[data-tool-icon=generate_image]")].some(e=>e.closest("li").querySelector(".pilot-media-tile img")?.naturalWidth>0)');
   check('generated images show actual loaded thumbnails',await q('!!document.querySelector("[data-tool-icon=generate_image]").closest("li").querySelector(".pilot-media-tile img")'));
   await call('cut_range',{start_sec:1,end_sec:2});
   await until('!!document.querySelector(".pilot-change")');
   check('cut receipts identify the exact removed interval and affected tracks',await q('(()=>{const c=document.querySelector(".pilot-change");return c.textContent.includes("Removed 1s")&&c.textContent.includes("00:01.0")&&c.textContent.includes("00:02.0")&&c.textContent.includes("audio")&&c.textContent.includes("caption");})()'));
   await q('document.querySelector(".pilot-change-clips").open=true;document.querySelector(".pilot-change").scrollIntoView({block:"center"});void 0');
   await shot('cut-receipt.png');
  }
  const exporting=call('export_video',{file_path:exportFile,quality:'low',encoder_preset:'ultrafast'});
  exporting.catch(()=>{});
  if(cancelRun){await exporting;throw Error('Canceled export unexpectedly completed');}
  await until('!!document.querySelector(".pilot-inline-export progress")');
  check('native export progress is inside the active chat step',await q('!!document.querySelector(".pilot-inline-export progress")&&!document.querySelector(".modal-backdrop[aria-labelledby=export-title]")'));
  await q('document.querySelector(".pilot-list").scrollTop=0');await wait(250);
  check('live progress does not steal the reading position',await q('document.querySelector(".pilot-list").scrollTop<5&&!!document.querySelector(".pilot-latest button")'));
  await click('.pilot-latest button');await click('button[aria-label="Close assistant"]');
  check('closed chat shows background export progress',await q('document.querySelector(".pilot-fab").textContent.includes("Export")'));
  await click('.pilot-fab');await until('!!document.querySelector(".pilot-inline-export")');
  await shot('inline-export.png');
  const output=await exporting;
  check('the exported file is verified and delivered',output.ok&&output.metadata.duration_sec===7);
  let ready=false;for(let i=0;i<12&&!ready;i++)ready=(await call('complete_edit')).ready;assert.ok(ready);
  return {text:'The scene was added, the second was removed, and your video is ready.'};
 };
 win.webContents.setBackgroundThrottling(false);win.setSize(1440,1000);settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'codex-sdk'});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await q(`window.__fve.load(${JSON.stringify(fixture('visual-activity'))})`);await click('.pilot-fab');
  await q('window.__exportModalSeen=false;window.__exportObserver=new MutationObserver(()=>{if(document.querySelector(".modal-backdrop[aria-labelledby=export-title]"))window.__exportModalSeen=true;});window.__exportObserver.observe(document.body,{subtree:true,childList:true});void 0');
  const send=async()=>{await q('(()=>{const e=document.querySelector(".pilot-input textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"Add a scene, remove one second, then export the video.");e.dispatchEvent(new Event("input",{bubbles:true}));})()');await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');};
  await send();await until('!document.querySelector("button[aria-label=Stop]")&&!!document.querySelector(".pilot-output video")');
  check('no export dialog appears during agent rendering, delivery or review',await q('!window.__exportModalSeen&&!document.querySelector(".pilot-error")'));
  await until('document.querySelector(".pilot-output video").readyState>=1');
  // One listening level: the chat player follows the preview volume, and the other way round.
  const slider='(async()=>{if(!document.querySelector("input[aria-label=\'Preview volume level\']")){document.querySelector("button[aria-label=\'Preview volume\']").click();await new Promise(r=>setTimeout(r,100));}return document.querySelector("input[aria-label=\'Preview volume level\']");})()';
  await q(`(async()=>{const e=await ${slider};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"35");e.dispatchEvent(new Event("input",{bubbles:true}));})()`);await wait(100);
  const followed=await q('(()=>{const v=document.querySelector(".pilot-output video");return {volume:v.volume,muted:v.muted};})()');result.chatVolume=followed;
  check('the chat video plays at the preview volume',Math.abs(followed.volume-.35)<.01&&!followed.muted);
  await q('(()=>{const v=document.querySelector(".pilot-output video");v.volume=.6;})()');await wait(100);
  const back=await q(`(async()=>Number((await ${slider}).value))()`);result.previewVolumeAfterChat=back;
  check('changing the chat video volume changes the preview volume',back===60);
  await q(`(async()=>{const e=await ${slider};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"100");e.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("button[aria-label='Preview volume']").click();})()`);await wait(100);
  const playback=await q('(async()=>{const v=document.querySelector(".pilot-output video");v.muted=true;await v.play();return v.videoWidth;})()');check('the delivered video plays directly in chat',playback===320);
  await until('document.querySelector(".pilot-output video").currentTime>.1');await q('document.querySelector(".pilot-output video").pause()');
  await q('document.querySelector(".pilot-output").scrollIntoView({block:"center"});void 0');await shot('video-ready.png');
  await click('.pilot-output-actions button:first-child');await click('.pilot-output-actions button:last-child');
  const delivered=fs.realpathSync(exportFile);
  for(let i=0;i<100&&(openPath!==delivered||revealedPath!==delivered);i++)await wait(10);
  result.fileActions={opened:openPath,revealed:revealedPath,expected:delivered};check('file actions use the verified output path',openPath===delivered&&revealedPath===delivered);
  await click('button[aria-label="Close assistant"]');await click('.pilot-fab');check('reopening retains media thumbnails and the output card',await q('!!document.querySelector(".pilot-media-tile img")&&!!document.querySelector(".pilot-output video")'));
  result.output={file:exportFile,...await ff.probe(exportFile)};
  cancelRun=true;exportFile=path.join(dir,'canceled-story.mp4');await q(`window.__fve.load(${JSON.stringify(fixture('cancel-inline'))})`);await click('.pilot-fab');await send();await until('!!document.querySelector(".pilot-export-cancel")');await click('.pilot-export-cancel');
  await until('!document.querySelector("button[aria-label=Stop]")');check('inline cancel stops the request without a partial video or modal',!fs.existsSync(exportFile)&&await q('!window.__exportModalSeen&&!document.querySelector(".modal-backdrop[aria-labelledby=export-title]")'));
  await q('window.__exportObserver.disconnect();void 0');await click('.btn-export');await until('!!document.querySelector(".modal-backdrop[aria-labelledby=export-title]")');
  check('manual exports retain the normal export dialog',true);await click('.modal-backdrop button[aria-label=Close]');
  check('renderer has no runtime errors',!result.errors.length);
 }catch(error){result.error=error.stack;result.dom=await q('document.body.innerText.slice(-2400)');await shot('failure.png');}
 finally{local.runEditorNative=original.run;local.status=original.status;local.generateImage=original.image;FxJobs.prototype.write=original.write;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
