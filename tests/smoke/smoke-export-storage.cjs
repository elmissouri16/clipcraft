const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const ff=require('../../electron/media/ffmpeg.cjs'),{FxJobs,encoder}=require('../../electron/export/fxjobs.cjs');
 const result={checks:[],errors:[]},q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<300;i++){if(await q(code))return;await wait(40);}throw Error('Timeout: '+code);};
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const original=FxJobs.prototype.createEncoder;
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  // Read-only source image from the failing project; all project state and
  // output live in this isolated smoke profile.
  let clip,media,reportedProject;
  if(process.env.FVE_EXPORT_STORAGE_PROJECT){
   const input=JSON.parse(fs.readFileSync(process.env.FVE_EXPORT_STORAGE_PROJECT,'utf8')),saved=input.project||input;
   reportedProject=saved;clip=saved.videoClips[0];media=saved.media.find(m=>m.id===clip.mediaId);result.source='Read-only image from the reported project';
  }else{
   const source=path.join(dir,'source.png');require('node:child_process').execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=1920x1080','-frames:v','1',source]);
   media={id:'m',path:source,type:'image',width:1920,height:1080};clip={id:'v',mediaId:'m',in:0,speed:1,effects:['vignette','fx_grainfine']};result.source='Generated test pattern';
  }
  const fixture={id:'export-storage-regression',name:'Effect storage check',width:1920,height:1080,fps:24,ratio:'16:9',media:[media],
   videoClips:[{...clip,out:4}],overlayClips:[],audioClips:[],textClips:[{id:'caption',text:'Export storage check',start:0,duration:4,y:.8}],
   effectClips:[{id:'shake',fx:'fx_shake1',start:1,duration:.35},{id:'rgb',fx:'fx_rgb2',start:2,duration:.3}],exportSettings:{preset:'low'}};
  await q(`window.__fve.load(${JSON.stringify(fixture)})`);
  FxJobs.prototype.createEncoder=function(file,w,h,fps){return encoder(file,w,h,fps,()=>spawn(process.execPath,['-e',"process.stdin.once('data',()=>process.stderr.write('No space left on device',()=>process.exit(1)));"],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','ignore','pipe']}));};
  await q('window.__fve.exportNow()');
  check('export failure exposes the actual disk-space problem',await q('document.querySelector(".modal-backdrop")?.textContent.includes("Not enough disk space")'));
  const failedLog=fs.readFileSync(path.join(dir,'logs','crash.log'),'utf8');check('effect failure is retained for diagnosis',failedLog.includes('effect export failed')&&failedLog.includes('Not enough disk space'));
  fs.writeFileSync(path.join(dir,'disk-failure.png'),(await win.capturePage()).toPNG());
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="Close").click()');
  FxJobs.prototype.createEncoder=original;
  await q('window.__fve.exportNow()');
  check('retry exports the actual image, grain, vignette, shake, RGB effect and caption',await q('!!document.querySelector(".modal-icon.ok")'));
  const file=path.join(dir,'ui-export.mp4'),metadata=await ff.probe(file);
  result.output={file,bytes:fs.statSync(file).size,width:metadata.width,height:metadata.height,duration:metadata.duration,fps:metadata.fps};
  check('encoded dimensions and duration match the requested export',metadata.width===720&&metadata.height===406&&Math.abs(metadata.duration-4)<.05);
  require('node:child_process').execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-f','null','-']);check('the completed video decodes without errors',true);
  fs.writeFileSync(path.join(dir,'success.png'),(await win.capturePage()).toPNG());
  if(process.env.FVE_EXPORT_STORAGE_FULL==='1'){
   assert.ok(reportedProject,'full verification requires the explicit project input');
   const shortFile=path.join(dir,'short-export.mp4');fs.copyFileSync(file,shortFile);result.output.file=shortFile;
   await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK").click()');
   await q(`window.__fve.load(${JSON.stringify({...reportedProject,id:'full-export-storage-regression',craftAI:undefined,exportSettings:{preset:'low'}})})`);
   fs.writeFileSync(path.join(dir,'progress.json'),JSON.stringify({stage:'Exporting full saved timeline',startedAt:Date.now()}));
   await q('window.__fve.exportNow()');
   const okay=await q('!!document.querySelector(".modal-icon.ok")');
   if(!okay)result.fullFailure=await q('document.querySelector(".modal-backdrop")?.innerText');
   check('the entire reported timeline exports with all original effects and captions',okay);
   const full=await ff.probe(file);result.fullOutput={file,bytes:fs.statSync(file).size,width:full.width,height:full.height,duration:full.duration,fps:full.fps};
   require('node:child_process').execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-f','null','-']);
   check('the entire exported video decodes without errors',true);
  }
  check('renderer has no runtime errors',!result.errors.length);
 }catch(error){result.error=error.stack;result.dom=await q('document.body.innerText.slice(-1600)');}
 finally{FxJobs.prototype.createEncoder=original;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
