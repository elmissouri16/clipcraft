const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(code,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await q(code))return;await wait(25);}throw Error('Timeout '+code);};
 const result={checks:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const ff=require('../../electron/media/ffmpeg.cjs'),{FxJobs}=require('../../electron/export/fxjobs.cjs'),read=FxJobs.prototype.read;
 const {powerSaveBlocker}=require('electron'),start=powerSaveBlocker.start.bind(powerSaveBlocker),stop=powerSaveBlocker.stop.bind(powerSaveBlocker),set=win.setProgressBar.bind(win);let blockers=[],dock=[];
 powerSaveBlocker.start=type=>{const id=start(type);blockers.push(id);return id;};powerSaveBlocker.stop=id=>stop(id);win.setProgressBar=value=>{dock.push(value);return set(value);};
 // Real rendering and encoding, with a small deterministic delay to make
 // progress/cancel states observable on fast development machines.
 FxJobs.prototype.read=async function(...args){await wait(20);return read.apply(this,args);};
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  const source=path.join(dir,'source.png');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360','-frames:v','1',source]);
  const media={...await ff.probe(source),id:'m',path:source,name:'Pattern'};
  const p={id:'export-ux',name:'Export UX',width:640,height:360,fps:30,ratio:'16:9',posterAt:.2,background:'#000000',media:[media],videoClips:[{id:'v',mediaId:'m',in:0,out:12,speed:1,effects:['grain']}],overlayClips:[],audioClips:[],textClips:[{id:'t',text:'Export ETA',start:0,duration:12,x:.5,y:.8}],effectClips:[]};
  await q('window.__fve.load('+JSON.stringify(p)+')');await wait(200);
  // The Export dialog's cover is the COMPOSITED frame at the poster time (export:coverFrame), not
  // a frame of the main-track source: open the dialog, wait for the render, close it again.
  await q('document.querySelector(".btn-export").click()');await until('!!document.querySelector(".x-cover img[data-cover=composite]")',30000);
  result.coverPreview=await q('document.querySelector(".x-cover img[data-cover=composite]").getAttribute("src")');
  const coverFile=decodeURIComponent(result.coverPreview.replace(/^file:\/+/,'/'));
  check('the cover preview is a rendered timeline frame in the media cache',/-cover\.jpg$/.test(coverFile)&&fs.existsSync(coverFile)&&fs.statSync(coverFile).size>1000);
  check('the rendered cover becomes the project card picture',await q('/poster-export-ux\\.jpg/.test(window.__fve.rawProject().posterImage||"")'));
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="Cancel").click()');await until('!document.querySelector(".modal-backdrop")');
  const file=path.join(dir,'ui-export.mp4'),sentinel=Buffer.from('previous export stays safe');fs.writeFileSync(file,sentinel);
  const canceled=q('window.__fve.exportNow()');
  await until('document.querySelector(".x-enc-stage")?.textContent.includes("Rendering effects")');
  const cancelStart=Date.now();await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="Cancel export").click()');
  await until('!document.querySelector(".modal-backdrop")',10000);await canceled;
  result.cancelMs=Date.now()-cancelStart;check('Cancel stops effect preprocessing without an error modal',result.cancelMs<5000);check('Cancel preserves an existing destination file',fs.readFileSync(file).equals(sentinel));
  const run=q('window.__fve.exportNow()');await until('!!document.querySelector(".x-export-timing")');
  check('progress has an accessible value',await q('document.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")!==null'));
  await until('document.querySelector(".x-export-eta")?.textContent.includes("remaining")&&!document.querySelector(".x-export-eta")?.textContent.includes("Estimating")');
  result.timing=await q('document.querySelector(".x-export-timing").textContent');
  check('ETA and elapsed time are visible',/remaining/.test(result.timing)&&/Elapsed/.test(result.timing));
  check('keyboard focus remains within the export dialog',await q('(()=>{const d=document.querySelector(".modal-backdrop"),b=[...d.querySelectorAll("button:not(:disabled)")];const last=b.at(-1);last.focus();last.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));return d.contains(document.activeElement)&&document.activeElement!==last;})()'));
  await q('document.querySelector(".x-specs .x-details-toggle").click()');check('technical details can be expanded',await q('document.querySelector(".x-specs .x-details-toggle").getAttribute("aria-expanded")==="true"'));await q('document.querySelector(".x-specs .x-details-toggle").click()');
  fs.writeFileSync(path.join(dir,'progress.png'),(await win.capturePage()).toPNG());
  check('export suppresses background throttling',win.webContents.getBackgroundThrottling()===false);win.minimize();await wait(200);win.restore();
  await run;check('export completes after minimizing',await q('!!document.querySelector(".modal-icon.ok")'));check('completed export reports its elapsed time',await q('document.querySelector(".export-dialog-note")?.textContent.includes("Completed in")'));
  await until('true');await wait(100);
  check('Dock receives export progress and clears afterward',dock.some(p=>p>0&&p<1)&&dock.at(-1)===-1);
  check('sleep prevention is released after completion',blockers.length>0&&blockers.every(id=>!powerSaveBlocker.isStarted(id)));
  check('normal background throttling is restored',win.webContents.getBackgroundThrottling()===true);
  result.output=await ff.probe(file);check('the saved video is valid',result.output.hasVideo&&Math.abs(result.output.duration-12)<.1);
  const streams=JSON.parse(execFileSync(ff.ffprobePath,['-v','quiet','-show_streams','-of','json',file],{encoding:'utf8'})).streams;
  check('the cover is embedded without altering the main video',streams.some(s=>s.disposition?.attached_pic===1));
  // The embedded cover is the exported frame at the poster time (text overlay and grain included),
  // so it matches that frame closely; a frame of the bare source would not.
  const {spawnSync}=require('node:child_process');
  const coverJpg=path.join(dir,'cover.jpg'),frameAt=path.join(dir,'frame-at-poster.png');
  execFileSync(ff.ffmpegPath,['-v','error','-y','-i',file,'-map','0:v:1','-c','copy','-frames:v','1','-f','image2',coverJpg]); // the embedded JPEG bytes
  execFileSync(ff.ffmpegPath,['-v','error','-y','-ss',String(p.posterAt),'-i',file,'-map','0:v:0','-frames:v','1',frameAt]);
  const psnrOf=(a,b)=>{const err=spawnSync(ff.ffmpegPath,['-hide_banner','-i',a,'-i',b,'-filter_complex','[0:v][1:v]psnr','-f','null','-']).stderr.toString();const m=/average:(inf|[\d.]+)/.exec(err);return m?(m[1]==='inf'?99:parseFloat(m[1])):NaN;};
  result.coverPsnr={exportedFrame:psnrOf(coverJpg,frameAt),source:psnrOf(coverJpg,source)};
  // 35 dB: the JPEG of the exported frame decoded as JPEG viewers decode it (BT.601 convention). A cover
  // written with the video's BT.709 values measured 22.9 dB here — a visible shift of saturated colours.
  check('the embedded cover is the exported frame at the poster time, in JPEG colour conventions',result.coverPsnr.exportedFrame>=35&&result.coverPsnr.exportedFrame>result.coverPsnr.source);
  check('no unfinished output is left in the destination',!fs.readdirSync(dir).some(n=>n.startsWith('.clipcraft-export-')||n.startsWith('.clipcraft-cover-')));
  result.dockUpdates=dock.length;result.blockers=blockers.length;
  fs.writeFileSync(path.join(dir,'done.png'),(await win.capturePage()).toPNG());
 }catch(error){result.error=error.stack;}
 finally{FxJobs.prototype.read=read;powerSaveBlocker.start=start;powerSaveBlocker.stop=stop;win.setProgressBar=set;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
