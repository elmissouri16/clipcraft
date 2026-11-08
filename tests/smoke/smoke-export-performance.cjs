const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});win.webContents.setBackgroundThrottling(false);
 const q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(code,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await q(code))return;await wait(40);}throw Error('Timed out: '+code);};
 const result={checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  const ff=require('../../electron/media/ffmpeg.cjs'),source=path.join(dir,'unsupported.mp4');
  execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=1280x720:r=24:d=2','-vf','format=yuv444p','-c:v','libx264','-preset','ultrafast','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',source]);
  const media={...await ff.probe(source),path:source,id:'m',name:'unsupported.mp4'};
  const base={id:'export-perf',name:'Export performance',ratio:'16:9',width:1280,height:720,fps:60,background:'#000000',media:[media],videoClips:[{id:'v',mediaId:'m',in:0,out:2,speed:1}],overlayClips:[],textClips:[],audioClips:[],effectClips:[],exportSettings:{preset:'custom',custom:{resCap:480,fps:24,codec:'h264',crf:18,encoderPreset:'veryfast'}}};
  const quality=async(label)=>{await q('document.querySelector(".quality-btn").click()');await until('!!document.querySelector("[aria-label=\\"Playback quality\\"]")');await q(`[...document.querySelectorAll('[role=menuitemradio]')].find(button=>button.textContent.includes(${JSON.stringify(label)})).click()`);await wait(100);};
  await quality('Low quality');await q('window.__fve.load('+JSON.stringify(base)+')');
  await until('(()=>{const m=window.__fve.rawProject().media[0];return m?.proxies?.low&&m.thumbCount&&m.poster&&!m.optimizing;})()');
  const low=await q('window.__fve.rawProject().media[0]');
  check('Low playback creates its selected copy before a separate Full fallback',!!low.proxies.low&&!low.proxy&&low.proxyRequired===true);
  check('Low proxy uses its requested resolution', (await ff.probe(low.proxies.low)).width===640);
  await quality('Full quality');await until('!!window.__fve.rawProject().media[0]?.proxy&&!window.__fve.rawProject().media[0]?.optimizing');
  const full=await q('window.__fve.rawProject().media[0]');check('Full switch builds compatibility while retaining Low',!!full.proxy&&full.proxies.low===low.proxies.low&&!full.proxyRequired);
  result.proxies=fs.readdirSync(path.join(dir,'media-cache-test')).filter(name=>/-q(low|high)\.mp4$/.test(name));
  check('proxy switch creates exactly one Low and one compatibility encode',result.proxies.length===2);
  await q('window.__fve.seek(1)');await until('(()=>{const v=[...document.querySelectorAll(".slot:not(.ov) video")].find(v=>v.dataset.src?.includes("qhigh"));return !!v&&v.readyState>=2&&Math.abs(v.currentTime-1)<.1;})()');
  check('Full proxy lands on the existing playhead',true);
  const point={...base,id:'text-coordinates',media:[],videoClips:[{id:'gap',gap:true,in:0,out:2,speed:1}],textClips:[{id:'text',text:'POSITION',start:0,duration:2,x:.75,y:.65,size:72,color:'#ffffff',animIn:{id:'none',dur:0},animOut:{id:'none',dur:0}}]};
  await q('window.__fve.load('+JSON.stringify(point)+')');await wait(100);await q('window.__fve.exportNow()');
  check('capped text export completes',await q('!!document.querySelector(".modal-icon.ok")'));
  const frame=execFileSync(ff.ffmpegPath,['-v','error','-ss','1','-i',path.join(dir,'ui-export.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);
  const info=await ff.probe(path.join(dir,'ui-export.mp4'));let x=0,y=0,n=0;
  for(let i=0;i<frame.length;i++)if(frame[i]>180){x+=i%info.width;y+=Math.floor(i/info.width);n++;}
  result.text={width:info.width,height:info.height,fps:info.fps,centroid:{x:x/n/info.width,y:y/n/info.height},pixels:n};
  check('early scaling preserves logical text placement',info.width===480&&info.height===270&&info.fps===24&&n>30&&Math.abs(result.text.centroid.x-.75)<.06&&Math.abs(result.text.centroid.y-.65)<.06);
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  await q('(()=>{window.__cacheReads=0;const p=OffscreenCanvasRenderingContext2D.prototype;window.__cacheRead=p.getImageData;p.getImageData=function(...args){window.__cacheReads++;return window.__cacheRead.apply(this,args);};})()');
  await q('window.__fve.exportNow()');
  check('unchanged text reuses its completed render without canvas readback',await q('!!document.querySelector(".modal-icon.ok")&&window.__cacheReads===0'));
  await q('void(OffscreenCanvasRenderingContext2D.prototype.getImageData=window.__cacheRead)');
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  const ranges={...base,id:'disjoint-ranges',videoClips:[{id:'v',mediaId:'m',in:0,out:2,speed:1},{id:'w',mediaId:'m',in:0,out:2,speed:1,transition:{type:'fx_wipeup',duration:.5,ease:'ease_in_out'}}],effectClips:[{id:'e1',fx:'fx_invert',start:.2,duration:.3},{id:'e2',fx:'fx_invert',start:1.6,duration:.3}]};
  const {FxJobs}=require('../../electron/export/fxjobs.cjs'),originalBegin=FxJobs.prototype.begin,originalRead=FxJobs.prototype.read,jobs=[];
  FxJobs.prototype.begin=function(...args){const job=originalBegin.apply(this,args);jobs.push({...job,kind:args[1].kind});return job;};
  FxJobs.prototype.read=async function(id,...args){const value=await originalRead.call(this,id,...args),job=jobs.find(job=>job.id===id);if(job){job.readFrames=(job.readFrames||0)+(value?.frames?.length??(value?1:0));job.decoderErrors=this.jobs.get(id)?.readers.map(reader=>reader.err);}return value;};
  try{await q('window.__fve.load('+JSON.stringify(ranges)+')');await wait(100);await q('window.__fve.exportNow()');}finally{FxJobs.prototype.begin=originalBegin;FxJobs.prototype.read=originalRead;result.jobs=jobs;}
  check('disjoint effect ranges with an animated transition export successfully',await q('!!document.querySelector(".modal-icon.ok")'));
  const movie=path.join(dir,'ranges.mp4');fs.copyFileSync(path.join(dir,'ui-export.mp4'),movie);const rangeInfo=await ff.probe(movie);
  result.jobs=jobs;check('transition uses bounded output frames and preserves total duration',jobs.some(job=>job.kind==='transition'&&job.frames===12)&&jobs.filter(job=>job.kind==='clip').every(job=>job.width===480&&job.height===270)&&Math.abs(rangeInfo.duration-3.5)<.1);
  const pixels=(file,time,scaled)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',file,...(scaled?['-vf','scale=480:270']:[]),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  result.rangePixels=[.3,.8,1.7,2.5].map(time=>{const local=time>=1.5?time-1.5:time,a=pixels(source,time>=2?local:time,true),b=pixels(movie,time,false);let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(b[i]-((time<.5||time>=1.6&&time<1.9)?255-a[i]:a[i]));return {time,error:error/a.length};});
  // 1.7 is inside a transition: its spatial mixture is checked by the shader
  // reference suite. Outside the overlap, both disjoint effect/gap paths must match.
  check('disjoint effect and unaffected spans retain source timing',result.rangePixels.filter(p=>p.time!==1.7).every(p=>p.error<15));
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  const repeat=[];let cacheReads=0;
  FxJobs.prototype.begin=function(...args){const job=originalBegin.apply(this,args);repeat.push({...job,kind:args[1].kind});return job;};
  FxJobs.prototype.read=function(...args){cacheReads++;return originalRead.apply(this,args);};
  try{await q('window.__fve.exportNow()');}finally{FxJobs.prototype.begin=originalBegin;FxJobs.prototype.read=originalRead;}
  result.repeatedJobs=repeat;
  check('unchanged effects and transitions reuse completed renders without frame IPC',await q('!!document.querySelector(".modal-icon.ok")')&&repeat.length===4&&repeat.every(job=>job.cached)&&cacheReads===0);
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  await q('window.__fve.dispatch({type:"update",track:"effect",id:"e1",patch:{strength:.5}})');await wait(80);
  const revised=[];
  FxJobs.prototype.begin=function(...args){const job=originalBegin.apply(this,args);revised.push({...job,kind:args[1].kind});return job;};
  try{await q('window.__fve.exportNow()');}finally{FxJobs.prototype.begin=originalBegin;}
  result.revisedJobs=revised;
  check('changing one effect invalidates its range and reuses unaffected ranges and transition',await q('!!document.querySelector(".modal-icon.ok")')&&revised.filter(job=>job.cached).length===3&&revised.filter(job=>!job.cached).length===1);
  const revisedPixels=pixels(path.join(dir,'ui-export.mp4'),.3,false);
  check('revised effect intensity reaches exported pixels',revisedPixels.reduce((sum,value)=>sum+Math.abs(value-128),0)/revisedPixels.length<10);
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  const lutProject={...base,id:'full-lut',videoClips:[{...base.videoClips[0],filter:'lut:slay-01-amber.cube'}]};let lutDigest=false;
  FxJobs.prototype.begin=function(...args){const signature=args[1].cacheKey&&JSON.parse(args[1].cacheKey);if(signature?.passes?.some(pass=>typeof pass.lut==='string'&&pass.lut.length===64))lutDigest=true;return originalBegin.apply(this,args);};
  try{await q('window.__fve.load('+JSON.stringify(lutProject)+')');await wait(100);await q('window.__fve.exportNow()');}finally{FxJobs.prototype.begin=originalBegin;}
  check('full-clip LUT export loads and fingerprints the actual LUT data',lutDigest&&await q('!!document.querySelector(".modal-icon.ok")'));
  const lutInfo=await ff.probe(path.join(dir,'ui-export.mp4'));check('full-clip shader output retains its requested dimensions, FPS and duration',lutInfo.width===480&&lutInfo.height===270&&lutInfo.fps===24&&Math.abs(lutInfo.duration-2)<.1);
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  const long={...point,id:'cancel-cached-span',videoClips:[{id:'gap',gap:true,in:0,out:7200,speed:1}]};
  await q('window.__fve.load('+JSON.stringify(long)+')');await wait(100);await q('void(window.__pendingExport=window.__fve.exportNow())');
  await until('[...document.querySelectorAll(".modal-backdrop button")].some(button=>button.textContent.trim()==="Cancel export")');
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="Cancel export").click()');
  await until('!document.querySelector(".modal-backdrop")');await q('window.__pendingExport');
  check('cached and blank spans yield promptly to Cancel',true);
  check('no renderer exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.ok=false;result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>null);fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,jobs:result.jobs,text:result.text,dir}));app.exit(result.ok?0:1);
};
