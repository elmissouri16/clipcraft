// A bounded native probe before a packaged audio asset reaches the preview player.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
async function inspectPackSound(file){
 const {stdout}=await run(require('../media/ffmpeg.cjs').ffprobePath,['-v','error','-protocol_whitelist','file,pipe','-probesize','1048576','-analyzeduration','5000000','-show_entries','stream=codec_type,codec_name:stream_disposition=attached_pic:format=duration','-of','json',file],{timeout:15000,maxBuffer:1024*1024,windowsHide:true});
 const data=JSON.parse(stdout),streams=data.streams||[],audio=streams.filter(s=>s.codec_type==='audio'),duration=Number(data.format?.duration);
 if(audio.length!==1||streams.some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic)||!['pcm_u8','pcm_s16le','pcm_s24le','pcm_s32le','mp3','vorbis','opus'].includes(audio[0].codec_name)||!Number.isFinite(duration)||duration<=0)throw Error('Pack sound must contain one supported, nonempty audio stream.');
 return {duration,codec:audio[0].codec_name};
}
module.exports={inspectPackSound};
