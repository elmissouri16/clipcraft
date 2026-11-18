// Host-owned generated-media validation, independent of any extension recipe.
const {spawn}=require('node:child_process'),{ffprobePath}=require('./ffmpeg.cjs');
function processFile(binary,args,signal=new AbortController().signal){
 if(signal.aborted)return Promise.reject(Object.assign(Error('Media inspection canceled'),{name:'AbortError'}));
 return new Promise((resolve,reject)=>{const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[];let bytes=0,error='',settled=false,exceeded=false;
  const abort=()=>child.kill('SIGKILL'),finish=(failure,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);failure?reject(failure):resolve(value);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){exceeded=true;error='Media inspection output exceeds 1 MiB';child.kill('SIGKILL');}else chunks.push(chunk);});child.stderr.on('data',chunk=>{error=(error+chunk).slice(-4000);});child.once('error',failure=>finish(failure));child.once('close',code=>finish(signal.aborted?Object.assign(Error('Media inspection canceled'),{name:'AbortError'}):exceeded?Error('Media inspection output exceeds 1 MiB'):code!==0?Error(error||'Media inspector exited with '+code):null,Buffer.concat(chunks).toString('utf8')));
 });
}
async function inspect(file,signal){
 const info=JSON.parse(await processFile(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-i',file,'-show_streams','-show_format','-of','json'],signal)),video=info.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audio=info.streams?.find(s=>s.codec_type==='audio');
 const image=['png_pipe','jpeg_pipe','webp_pipe','bmp_pipe','image2'].includes(info.format?.format_name),duration=image?0:Number(info.format?.duration);
 if(!info.streams?.length||info.streams.length>16||!image&&!Number.isFinite(duration)||duration<0||duration>86400||video&&(!Number.isInteger(video.width)||!Number.isInteger(video.height)||video.width<1||video.height<1||video.width>8192||video.height>8192)||!video&&!audio)throw Error('Unsupported or oversized picked media.');
 const allowed=['png_pipe','jpeg_pipe','webp_pipe','bmp_pipe','image2','mov,mp4,m4a,3gp,3g2,mj2','matroska,webm','avi','wav','mp3','aac','ogg','flac','aiff'];if(!allowed.includes(info.format?.format_name))throw Error('Unsupported media container.');
 return {type:image?'image':video?'video':'audio',duration,hasVideo:!!video,hasAudio:!!audio,width:video?.width||0,height:video?.height||0,fps:video?Number(video.avg_frame_rate?.split('/')[0])/Number(video.avg_frame_rate?.split('/')[1])||0:0,vcodec:video?.codec_name||'',acodec:audio?.codec_name||''};
}
module.exports={inspect,processFile};
