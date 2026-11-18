import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
type Input={operation?:string;size?:number;start_sec?:number;duration_sec?:number};
const operations=['import-image','resize-image','extract-audio','trim-video'];
export async function activate(c:ExtensionContext){
 await c.ui.registerSettings({id:'processing',title:'Local media tools',location:'settings.plugins',fields:[
  {key:'operation',label:'Operation',type:'select',default:'import-image',options:[{value:'import-image',label:'Import image'},{value:'resize-image',label:'Resize image'},{value:'extract-audio',label:'Extract audio'},{value:'trim-video',label:'Trim video'}]},
  {key:'size',label:'Maximum image dimension',type:'number',min:64,max:4096,step:1,default:1080},
  {key:'start_sec',label:'Start in seconds',type:'number',min:0,max:86400,step:.1,default:0},
  {key:'duration_sec',label:'Duration in seconds',type:'number',min:.1,max:60,step:.1,default:5}
 ]});
 c.events.on('media.previewClosed',async event=>{if(event.extensionId===c.extension.id)await c.media.release({id:event.id});});
 await c.commands.register<Input>('process',async input=>c.jobs.run('Process local media',async({signal,progress})=>{
  await c.workspace.read();const setting=async(key:keyof Input,fallback:unknown)=>input?.[key]??await c.configuration.get(key)??fallback;
  const operation=await setting('operation','import-image'),size=await setting('size',1080),start=await setting('start_sec',0),duration=await setting('duration_sec',5);
  if(typeof operation!=='string'||!operations.includes(operation)||typeof size!=='number'||!Number.isInteger(size)||size<64||size>4096||typeof start!=='number'||!Number.isFinite(start)||start<0||start>86400||typeof duration!=='number'||!Number.isFinite(duration)||duration<.1||duration>60)throw Error('Choose valid processing settings.');
  const selected=await c.ui.showOpenDialog({title:'Choose a local media source',filters:[{name:operation.includes('image')?'Images':'Audio and video',extensions:operation.includes('image')?['png','jpg','jpeg','webp','bmp']:['mp4','mov','mkv','webm','mp3','wav','m4a','flac']}]},{signal});
  if(!selected?.[0])return {message:'No source selected.'};const source=selected[0],stat=await fs.lstat(source);if(!stat.isFile()||!stat.size||stat.size>512*1024*1024)throw Error('Choose a regular media file under 512 MiB.');
  let artifact,directory:string|undefined;
  try{
   let output=source;await progress(.1,'Reading the source');
   if(operation!=='import-image'){
    directory=path.join(c.extension.storagePath,'jobs',crypto.randomUUID());await fs.mkdir(directory,{recursive:true});output=path.join(directory,operation==='resize-image'?'image.png':operation==='extract-audio'?'audio.wav':'clip.mp4');const host=await c.host.read();
    const args=['-nostdin','-v','error','-n',...(operation==='resize-image'?[]:['-ss',String(start)]),'-i',source,...(operation==='resize-image'?['-vf',`scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`,'-frames:v','1']:operation==='extract-audio'?['-t',String(duration),'-vn','-c:a','pcm_s16le']:['-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac']),'-fs','536870912',output];
    await progress(.3,'Processing the selected file');const process=await c.processes.spawn({file:host.tools.ffmpeg,args,signal,timeoutMs:300000,maxOutputBytes:65536}),result=await process.result;if(result.code!==0)throw Error(result.stderr||'Media processing failed.');
   }
   if(signal.aborted)throw Error('Media job canceled');await progress(.85,'Verifying the result');artifact=await c.media.import({path:output,name:operation==='import-image'?path.basename(source):path.basename(output)});if(signal.aborted)throw Error('Media job canceled');
   await c.media.preview({id:artifact.id});await progress(1,'Preview ready');return {message:'Preview ready. Use Add to insert the verified result.',artifact};
  }catch(error){if(artifact)await c.media.release({id:artifact.id});throw error;}finally{if(directory)await fs.rm(directory,{recursive:true,force:true});}
 }));
}
