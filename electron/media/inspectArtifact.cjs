// Host-owned generated-media validation, independent of any extension recipe.
const {spawn}=require('../system/childProcesses.cjs'),{ffprobePath}=require('./ffmpeg.cjs');
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
 // A picture must actually decode: its header alone reports a size, and an undecodable looped
 // still would keep the export encoder retrying forever.
 if(image){const counted=JSON.parse(await processFile(ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-count_frames','-i',file,'-show_streams','-of','json'],signal).catch(()=>'{}'));if(!(Number(counted.streams?.find(s=>s.codec_type==='video')?.nb_read_frames)>=1))throw Error('This picture is damaged or is not a readable image.');}
 // Same reading as the editor's own probe (ffmpeg.cjs): the display rotation turns the size, the
 // frame rate is rounded, and HDR/colour/channel facts travel with the item so preview and export
 // treat extension media exactly like media the user imported.
 const rotation=video?Math.round(Number((video.side_data_list||[]).find(d=>d.rotation!==undefined)?.rotation??video.tags?.rotate??0)):0,turned=Math.abs(rotation)%180===90;
 const rate=video?String(video.avg_frame_rate||video.r_frame_rate||'0/1').split('/'):[];
 return {type:image?'image':video?'video':'audio',duration,hasVideo:!!video,hasAudio:!!audio,width:video?(turned?video.height:video.width):0,height:video?(turned?video.width:video.height):0,fps:video?Math.round((parseFloat(rate[0])||0)/(parseFloat(rate[1])||1)):0,vcodec:video?.codec_name||'',acodec:audio?.codec_name||'',
  rotation,hdr:!!video&&['arib-std-b67','smpte2084'].includes(video.color_transfer),pixFmt:video?.pix_fmt||'',profile:video?.profile||'',colorSpace:video?.color_space||'',channels:audio?.channels||0};
}
module.exports={inspect,processFile};
