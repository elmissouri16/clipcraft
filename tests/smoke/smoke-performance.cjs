// Identical workload for the saved baseline and current checkout. All projects,
// exports and measurements are isolated under FVE_SMOKE.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});win.webContents.setBackgroundThrottling(false);
 const q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(code,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(code))return;await wait(50);}throw new Error('Timed out: '+code);};
 const settings=require('../../electron/system/settings.cjs');settings.setFirstRun({tourSeen:true,packPromptSeen:true});
 const result={checks:[],errors:[],metrics:{}},check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
  await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  result.gpu=await q(`(async()=>{
   const {FxGL}=await import('/src/features/effects/gl.js');const fx=new FxGL(),w=64,h=32,data=new Uint8Array(w*h*4);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data.set([x*4,y*8,(x+y)*2,128+(x%100)],i);}
   const gl=fx.gl,original=gl.readPixels.bind(gl);let reads=0;gl.readPixels=(...a)=>{reads++;return original(...a);};
   const passes=['S(X+1,Y)','S(X,H-1-Y)','S(X,Y)*0.8+10','S(W-1-X,Y)'].map(expr=>({expr,T:.5}));
   const start=performance.now();for(let i=0;i<60;i++)fx.effects({data},w,h,passes);gl.finish();const elapsed=performance.now()-start;
   const intermediateReads=reads;const pixels=Array.from(fx.read(w,h));
   return {elapsed_ms:elapsed,intermediate_readbacks:intermediateReads,frames:60,width:w,height:h,pixels};
  })()`);
  check('GPU output includes nonuniform source and alpha',new Set(result.gpu.pixels).size>50);
  const base={id:'perf',name:'Performance workload',ratio:'16:9',width:640,height:360,fps:30,background:'#000000',media:[],videoClips:[{id:'gap',gap:true,in:0,out:60,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  const many={...base,id:'many',textClips:Array.from({length:800},(_,i)=>({id:'cap'+i,text:'Caption '+i,font:'arial',start:i*.075,duration:.07,layer:0}))};
  await q(`window.__fve.load(${JSON.stringify(many)})`);await wait(350);
  result.metrics.timeline_mounted_clips=await q('document.querySelectorAll(".timeline .clip, .timeline-panel .clip").length||document.querySelectorAll("[data-sel-track=text]").length');
  result.metrics.playback=await q(`new Promise(resolve=>{
   let changes=0,frames=0,maxGap=0,last=performance.now();const samples=[];
   const observer=new MutationObserver(()=>changes++);observer.observe(document.querySelector('.transport .tc'),{subtree:true,characterData:true,childList:true});
   let raf;const tick=now=>{frames++;samples.push(now-last);maxGap=Math.max(maxGap,now-last);last=now;raf=requestAnimationFrame(tick);};
   window.__fve.play();raf=requestAnimationFrame(tick);const start=performance.now();setTimeout(()=>{
    cancelAnimationFrame(raf);window.__fve.pause();observer.disconnect();samples.sort((a,b)=>a-b);resolve({elapsed_ms:performance.now()-start,frames,transport_updates:changes,max_frame_gap_ms:maxGap,p95_frame_gap_ms:samples[Math.floor(samples.length*.95)]});
   },3000);
  })`);
  check('playback clock advances',await q('window.__fve.rawProject().textClips.length===800&&window.__fve.history().past.length===0&&Number(document.querySelector(".transport .tc b").textContent.split(":")[1])>2'));
  result.metrics.store=await q(`(async()=>{
   const {emptyProject,historyReducer}=await import('/src/state/store.js');const {createToolRunner}=await import('/src/features/agent/tools.js');
   const p={...emptyProject(),videoClips:[{id:'gap',gap:true,in:0,out:1200,speed:1}],textClips:Array.from({length:1200},(_,i)=>({id:'t'+i,text:'Word '+i,start:i,duration:.8,layer:0}))};
   let s={past:[],present:p,future:[]};const actions=Array.from({length:30},(_,i)=>({type:'update',track:'text',id:'t600',patch:{color:i%2?'#ffffff':'#ff0000'}}));
   let start=performance.now();for(const a of actions)s=historyReducer(s,a);const manual=performance.now()-start;
   s={past:[],present:p,future:[]};const runner=createToolRunner({getProject:()=>s.present,dispatch:a=>{s=historyReducer(s,a);},settle:async()=>{},api:{}});
   start=performance.now();for(let i=0;i<30;i++){const r=await runner.run('edit_text',{clip_id:'t600',color:i%2?'#ffffff':'#ff0000'});if(r.error)throw new Error(r.error);}
   return {clips:1200,edits:30,manual_ms:manual,agent_ms:performance.now()-start};
  })()`);
  const text={...base,id:'static-text',videoClips:[{id:'gap',gap:true,in:0,out:6,speed:1}],textClips:[{id:'title',text:'STATIC PERFORMANCE',font:'arial',start:0,duration:6,size:42,color:'#ffffff'}]};
  await q(`window.__fve.load(${JSON.stringify(text)})`);await wait(200);
  await q(`(()=>{window.__perfReads=0;const p=OffscreenCanvasRenderingContext2D.prototype;window.__perfOriginalRead=p.getImageData;p.getImageData=function(...a){window.__perfReads++;return window.__perfOriginalRead.apply(this,a);};})()`);
  const ff=require('../../electron/media/ffmpeg.cjs');
  const streamTypes=[require('../../electron/export/textstream.cjs').TextStream];
  if(fs.existsSync(path.join(__dirname,'../../electron/export/sparseText.cjs')))streamTypes.push(require('../../electron/export/sparseText.cjs').SparseTextStream);
  let encodedText;
  const streamOriginals=streamTypes.map(Stream=>({Stream,finish:Stream.prototype.finish}));
  for(const {Stream,finish} of streamOriginals)Stream.prototype.finish=async function(...args){
   const value=await finish.apply(this,args),info=JSON.parse(execFileSync(ff.ffprobePath,['-v','error','-show_streams','-of','json',this.file]));
   encodedText={encoded_frames:Number(info.streams[0].nb_frames),timeline_frames:this.count,stream:Stream.name};return value;
  };
  let start=Date.now();
  try{await q('window.__fve.exportNow()');await until('!!document.querySelector(".modal-icon.ok, .modal-icon.error")');}
  finally{for(const {Stream,finish} of streamOriginals)Stream.prototype.finish=finish;}
  check('static text exports successfully',await q('!!document.querySelector(".modal-icon.ok")'));
  result.metrics.static_text={elapsed_ms:Date.now()-start,readbacks:await q('window.__perfReads'),...encodedText};
  await q('void(OffscreenCanvasRenderingContext2D.prototype.getImageData=window.__perfOriginalRead)');
  fs.copyFileSync(path.join(dir,'ui-export.mp4'),path.join(dir,'static-text.mp4'));
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(button=>button.textContent.trim()==="OK")?.click()');
  const source=path.join(dir,'source.mp4');
  execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=9','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=9','-shortest','-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',source]);
  const media={...await ff.probe(source),id:'m',name:'source.mp4',path:source};
  const project={...base,id:'range-effect',width:1280,height:720,fps:60,media:[media],videoClips:[{id:'v',mediaId:'m',in:3,out:9,speed:1}],textClips:[],
    effectClips:[{id:'negative',fx:'fx_invert',start:2,duration:1}],exportSettings:{preset:'custom',custom:{resCap:480,fps:24,codec:'h264',crf:20,encoderPreset:'veryfast'}}};
  const {FxJobs}=require('../../electron/export/fxjobs.cjs'),original={begin:FxJobs.prototype.begin,read:FxJobs.prototype.read,write:FxJobs.prototype.write};
  const jobs=[];let reads=0,writes=0;
  FxJobs.prototype.begin=function(...args){const job=original.begin.apply(this,args);jobs.push({...job});return job;};
  FxJobs.prototype.read=function(...args){reads++;return original.read.apply(this,args);};
  FxJobs.prototype.write=function(...args){writes++;return original.write.apply(this,args);};
  let elapsed;
  try{
   await q(`window.__fve.load(${JSON.stringify(project)})`);await wait(150);start=Date.now();await q('window.__fve.exportNow()');elapsed=Date.now()-start;
   check('range effect exports successfully',await q('!!document.querySelector(".modal-icon.ok")'));
  }finally{Object.assign(FxJobs.prototype,original);}
  const movie=path.join(dir,'range-effect.mp4');fs.copyFileSync(path.join(dir,'ui-export.mp4'),movie);const info=await ff.probe(movie);
  check('output cap and FPS preserve duration and audio',info.width===480&&info.height===270&&info.fps===24&&Math.abs(info.duration-6)<.1&&info.hasAudio);
  const pixels=(file,time,scale)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',file,...(scale?['-vf','scale=480:270']:[]),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
  const errors=[.5,2.5,5.5].map(time=>{const a=pixels(source,time+3,true),b=pixels(movie,time,false);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(b[i]-(time===2.5?255-a[i]:a[i]));return {time,mean_absolute_rgb_error:sum/a.length};});
  check('effect only changes its requested range and keeps source timing',errors.every(e=>e.mean_absolute_rgb_error<25));
  result.metrics.effect_export={elapsed_ms:elapsed,jobs,read_ipc:reads,write_ipc:writes,output:{width:info.width,height:info.height,fps:info.fps,duration:info.duration},pixel_errors:errors};
  check('no renderer exceptions',result.errors.length===0);result.ok=true;
  fs.writeFileSync(path.join(dir,'editor.png'),(await win.capturePage()).toPNG());
 }catch(error){result.ok=false;result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({ok:result.ok,checks:result.checks,metrics:result.metrics,error:result.error,dir}));app.exit(result.ok?0:1);
};
