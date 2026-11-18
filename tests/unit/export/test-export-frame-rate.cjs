// Exercise the real encoder/demuxer grid, including the raw RGBA text stream.
process.env.FVE_ENCODER='libx264';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {ffmpegPath,ffprobePath,runExport}=require('../../../electron/media/ffmpeg.cjs');
const {TextStream}=require('../../../electron/export/textstream.cjs');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-export-rate-')),width=64,height=36,rows=[];
 for(const color of ['blue','red'])execFileSync(ffmpegPath,['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=${width}x${height}`,'-frames:v','1',path.join(directory,color+'.png')]);
 const text=new TextStream(ffmpegPath,directory,width,height,12),pixels=Buffer.alloc(width*height*4);for(let y=8;y<16;y++)for(let x=8;x<24;x++)pixels.set([255,255,255,255],(y*width+x)*4);await text.add(pixels);await text.add({same:23});await text.finish();
 for(const [fps,overlay] of [[12,false],[24,false],[24,true],[25,true],[30,true],[50,true],[60,true]]){
  const label=fps+'-'+(overlay?'text':'plain'),file=path.join(directory,label+'.mp4'),project={width,height,fps:12,media:['blue','red'].map(id=>({id,type:'image',path:path.join(directory,id+'.png'),width,height})),videoClips:[{id:'first',mediaId:'blue',in:0,out:1},{id:'second',mediaId:'red',in:0,out:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[],...(overlay?{textOverlay:{file:text.file,count:24}}:{}),export:{codecFamily:'h264',mode:'crf',crf:22,encoderPreset:'ultrafast',audioKbps:96,outW:width,outH:height,outFps:fps}};
  await runExport(project,file,()=>{}).promise;
  const measured=JSON.parse(execFileSync(ffprobePath,['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,r_frame_rate,avg_frame_rate,duration:frame=best_effort_timestamp_time','-of','json',file],{encoding:'utf8'})),stream=measured.streams[0],fraction=value=>{const [a,b]=value.split('/').map(Number);return a/b;},timestamps=measured.frames.map(frame=>Number(frame.best_effort_timestamp_time));
  rows.push({label,requestedFps:fps,fps:fraction(stream.r_frame_rate),averageFps:fraction(stream.avg_frame_rate),width:stream.width,height:stream.height,duration:Number(stream.duration),frames:timestamps.length,timestamps});
 }
 const failures=rows.filter(row=>row.fps!==row.requestedFps||row.averageFps!==row.requestedFps||row.frames!==2*row.requestedFps||Math.abs(row.duration-2)>1e-5||row.width!==width||row.height!==height||row.timestamps.some((time,i)=>Math.abs(time-i/row.requestedFps)>1e-5));
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({ok:failures.length===0,environment:{platform:process.platform,arch:process.arch},rows},null,2));console.log(JSON.stringify({directory,rows:rows.map(({timestamps,...row})=>row)}));assert.deepEqual(failures,[],'encoded frames and timestamps must match the requested output grid');
})().catch(error=>{console.error(error);process.exitCode=1;});
