// Hardware is probed rather than assumed; CI without it exercises the same
// software fallback. The real codec, timing and decoded pixels are checked.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ff=require('../../../electron/media/ffmpeg.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-hardware-export-'));
 const saved=process.env.FVE_ENCODER;delete process.env.FVE_ENCODER;
 const source=path.join(dir,'source.mp4');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=2','-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv',source]);
 const p={width:640,height:360,fps:30,background:'#000000',media:[{...(await ff.probe(source)),id:'m',path:source}],videoClips:[{id:'v',mediaId:'m',in:0,out:2,speed:1}],overlayClips:[],audioClips:[],textClips:[]};
 const frame=(file,time)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
 const evidence=[];
 try{
  for(const family of ['h264','h265']){
   const encoder=await ff.pickEncoder(family),file=path.join(dir,family+'.mp4');let start=performance.now();
   await ff.runExport({...p,export:{codecFamily:family,crf:20,outW:640,outH:360,outFps:30}},file,()=>{}).promise;
   const elapsed=performance.now()-start,info=await ff.probe(file);
   assert.equal(info.vcodec,family==='h265'?'hevc':'h264');assert.ok(Math.abs(info.duration-2)<.1);
   const errors=[.5,1.5].map(time=>{const a=frame(source,time),b=frame(file,time);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;});
   evidence.push({family,encoder,elapsed_ms:elapsed,duration:info.duration,width:info.width,height:info.height,mean_absolute_rgb_error:errors});
   fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
   assert.ok(errors.every(error=>error<8),'decoded pixels preserve source colors/content: '+path.join(dir,'evidence.json'));
  }
  if(process.platform==='darwin'){
   process.env.FVE_ENCODER='h264_nvenc';const file=path.join(dir,'fallback.mp4');let reset=false;
   await ff.runExport(p,file,value=>{if(value===0)reset=true;}).promise;
   assert.equal((await ff.probe(file)).vcodec,'h264');assert.ok(reset,'unavailable hardware encoder explicitly retries software');
  }
 }finally{if(saved===undefined)delete process.env.FVE_ENCODER;else process.env.FVE_ENCODER=saved;}
 fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log('hardware/software export codec, timing, colors and fallback passed; evidence: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
