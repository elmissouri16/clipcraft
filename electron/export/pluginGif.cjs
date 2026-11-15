const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {ffmpegPath,ffprobePath}=require('../media/ffmpeg.cjs');
const {fileFingerprint}=require('../media/mediaAnalysis.cjs');
const abortError=()=>Object.assign(Error('GIF export canceled.'),{name:'AbortError'});
const check=signal=>{if(signal.aborted)throw signal.reason instanceof Error?signal.reason:abortError();};
function destination(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.gif')throw Error('Choose a new .gif filename.');
 const parent=fs.realpathSync(path.dirname(file)),out=path.join(parent,path.basename(file));
 try{fs.lstatSync(out);throw Error('That file already exists. Choose a new GIF filename.');}catch(error){if(error.code!=='ENOENT')throw error;}
 return out;
}
function processFile(binary,args,signal){
 check(signal);
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',error='';
  const abort=()=>child.kill('SIGKILL');signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  child.stdout.on('data',data=>{out+=data;if(out.length>1024*1024){error='GIF verification output exceeded its limit.';child.kill('SIGKILL');}});
  child.stderr.on('data',data=>{error=(error+data).slice(-4000);});
  child.on('error',reject);
  child.on('close',code=>{signal.removeEventListener('abort',abort);if(signal.aborted){try{check(signal);}catch(reason){reject(reason);}}else if(code!==0)reject(Error(error||`GIF encoder exited with ${code}.`));else resolve(out);});
 });
}
function createGifExporter({dialog,getWindow,createFrames,isExportBusy=()=>false}){
 let active=false;
 return {
  get busy(){return active;},
  async run({project,plan,signal,onProgress=()=>{},verify=async()=>{}}){
   if(active||isExportBusy())throw Error('Another export is already running.');active=true;
   let frameDir,outputDir,renderer,timer,monitor;
   const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   const local=controller.signal;
   try{
    check(local);onProgress(0,'Choose a new GIF destination…');
    const selection=await dialog.showSaveDialog(getWindow(),{title:'Export GIF',defaultPath:'clipcraft-export.gif',filters:[{name:'Animated GIF',extensions:['gif']}]});
    check(local);if(selection.canceled)return null;
    const file=destination(selection.filePath);
    const {GIF_LIMITS}=await import('../../shared/pluginGif.mjs');
    timer=setTimeout(()=>controller.abort(Error('GIF export exceeded its ten-minute limit.')),10*60*1000);
    // Fingerprint only sources used by visible picture clips. Missing media fails closed.
    const used=new Set([...(project.videoClips||[]),...(project.overlayClips||[])].filter(c=>!c.gap).map(c=>c.mediaId));
    const pictures=[...(project.videoClips||[]),...(project.overlayClips||[])].filter(c=>!c.gap);
    if(pictures.some(c=>c.graphicDraft))throw Error('Finish editing live graphics before GIF export.');
    if(pictures.some(c=>!project.media?.some(m=>m.id===c.mediaId&&['image','video'].includes(m.type))))throw Error('A visible picture source is missing or unsupported.');
    const sources=(project.media||[]).filter(m=>used.has(m.id)).map(m=>[m.path,fileFingerprint(m.path)]);
    const verifySources=()=>{for(const [source,fingerprint] of sources)if(fileFingerprint(source)!==fingerprint)throw Error('A source file changed during GIF export.');};
    frameDir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-gif-'));
    outputDir=fs.mkdtempSync(path.join(path.dirname(file),'.clipcraft-gif-'));
    const part=path.join(outputDir,'output.gif'),palette=path.join(frameDir,'palette.png'),sequence=path.join(frameDir,'%06d.png');
    renderer=createFrames({project,plan,signal:local});let bytes=0;
    for(let i=0;i<plan.frame_count;i++){
     check(local);const png=await renderer.frame(i);check(local);bytes+=png.length;
     if(bytes>GIF_LIMITS.frameBytes)throw Error('GIF temporary frames exceeded 512 MiB. Choose a smaller size or range.');
     fs.writeFileSync(path.join(frameDir,`${String(i).padStart(6,'0')}.png`),png,{flag:'wx'});
     onProgress((i+1)/plan.frame_count*0.7,`Rendering GIF frame ${i+1} of ${plan.frame_count}`);
    }
    renderer.close();renderer=null;verifySources();
    const common=['-hide_banner','-v','error','-nostdin','-n','-threads','2','-filter_threads','1','-filter_complex_threads','1'];
    const input=['-framerate',String(plan.fps),'-start_number','0','-i',sequence];
    onProgress(0.72,'Building GIF palette…');
    await processFile(ffmpegPath,[...common,...input,'-vf','palettegen=reserve_transparent=0','-frames:v','1',palette],local);
    onProgress(0.8,'Encoding GIF…');
    monitor=setInterval(()=>{try{if(fs.statSync(part).size>GIF_LIMITS.outputBytes)controller.abort(Error('GIF output exceeded 256 MiB. Choose a smaller range or size.'));}catch{}},100);
    await processFile(ffmpegPath,[...common,...input,'-i',palette,'-lavfi','paletteuse=dither=sierra2_4a','-frames:v',String(plan.frame_count),'-an','-loop','0','-final_delay',String(100/plan.fps),part],local);
    clearInterval(monitor);monitor=null;
    const stat=fs.statSync(part);if(stat.size<=0||stat.size>GIF_LIMITS.outputBytes)throw Error('GIF output exceeded its size limit.');
    onProgress(0.92,'Verifying the complete GIF…');
    const metadata=JSON.parse(await processFile(ffprobePath,['-v','error','-ignore_loop','1','-i',part,'-count_frames','-show_streams','-show_format','-of','json'],local));
    const video=metadata.streams?.find(s=>s.codec_type==='video');
    if(metadata.format?.format_name!=='gif'||metadata.streams.length!==1||video?.codec_name!=='gif'||video.width!==plan.width||video.height!==plan.height||Number(video.nb_read_frames)!==plan.frame_count||Math.abs(Number(metadata.format.duration)-plan.duration_sec)>0.011)throw Error('The GIF did not match the requested dimensions, frame count or duration.');
    await processFile(ffmpegPath,['-v','error','-nostdin','-xerror','-ignore_loop','1','-i',part,'-map','0:v:0','-f','null','-'],local);
    await verify();check(local);verifySources();
    // Same-filesystem exclusive publication: destination races preserve the older file.
    fs.linkSync(part,file);
    return {type:'image',format:'gif',path:file,bytes:stat.size,...plan};
   }finally{
    clearTimeout(timer);clearInterval(monitor);signal.removeEventListener('abort',abort);controller.abort();active=false;
    for(const cleanup of [()=>renderer?.close(),()=>frameDir&&fs.rmSync(frameDir,{recursive:true,force:true}),()=>outputDir&&fs.rmSync(outputDir,{recursive:true,force:true})]){try{cleanup();}catch{console.warn('[plugins] GIF temporary resource cleanup failed.');}}
   }
  },
 };
}
module.exports={createGifExporter,destination,processFile};
