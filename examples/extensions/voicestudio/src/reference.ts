import type {ExtensionContext,InspectionScope} from '@clipcraft/plugin-sdk/extension';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export type ReferenceInput={reference_path?:string;reference_clip_id?:string;reference_media_id?:string;reference_offset_sec?:number;reference_duration_sec?:number};
const MAX_AUDIO=20*1024*1024,extensions=['wav','mp3','m4a','flac','ogg','aiff','aac','opus'];
const stop=(signal:AbortSignal)=>{if(signal.aborted)throw Error('Voice cloning canceled.');};
async function capture(file:string,signal:AbortSignal){
 const name=path.basename(file);if(!extensions.includes(path.extname(name).slice(1).toLowerCase()))throw Error('Choose a supported reference audio file.');
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||!before.size||before.size>MAX_AUDIO)throw Error('Choose a regular reference audio file of at most 20 MiB.');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const opened=await handle.stat();if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw Error('Reference audio changed while opening it.');
  const buffer=Buffer.alloc(Math.min(before.size+1,MAX_AUDIO+1));let size=0;
  while(size<buffer.length){stop(signal);const part=await handle.read(buffer,size,buffer.length-size,size);if(!part.bytesRead)break;size+=part.bytesRead;}
  const after=await handle.stat();if(!size||size>MAX_AUDIO||size!==before.size||after.size!==size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Reference audio changed or exceeds 20 MiB.');
  return {name,bytes:Buffer.from(buffer.subarray(0,size))};
 }finally{await handle.close();}
}
export async function referenceAudio(c:ExtensionContext,input:ReferenceInput,signal:AbortSignal){
 const keys=['reference_path','reference_clip_id','reference_media_id'] as const,chosen=keys.filter(key=>input?.[key]!==undefined);if(chosen.length!==1)throw Error('Provide exactly one reference_clip_id or reference_media_id from get_project, or reference_path for an external audio file.');
 const key=chosen[0],id=input[key];if(typeof id!=='string'||!id.length||id.length>(key==='reference_path'?4096:1024))throw Error('Invalid reference identifier.');
 const offset=input.reference_offset_sec??0,requested=input.reference_duration_sec;
 if(typeof offset!=='number'||!Number.isFinite(offset)||offset<0||offset>86400||requested!==undefined&&(typeof requested!=='number'||!Number.isFinite(requested)||requested<.1||requested>30))throw Error('Use reference_offset_sec >= 0 and reference_duration_sec from 0.1 to 30.');
 let file=id,start=offset,duration=requested??15,scope:InspectionScope|undefined,mediaId:string|undefined;
 if(key!=='reference_path'){
  if(key==='reference_clip_id'){
   const page=await c.workspace.inspect({section:'clips',sourceIds:[id],limit:2});scope={documentId:page.documentId,projectRevision:page.projectRevision};
   if(page.total!==1)throw Error(page.total?'Reference clip ID is ambiguous. Choose a unique timeline clip.':'Reference clip is missing. Refresh get_project.');
   const clip=page.items[0];if(clip.gap||!clip.mediaId||!['audio','video','overlay'].includes(clip.lane))throw Error('Reference clip has no audio source.');mediaId=clip.mediaId;
   const sourceIn=await c.workspace.readValue({...scope,ref:clip.properties.ref,path:['in']}),sourceOut=await c.workspace.readValue({...scope,ref:clip.properties.ref,path:['out']});
   if(sourceIn.kind!=='scalar'||typeof sourceIn.value!=='number'||sourceOut.kind!=='scalar'||typeof sourceOut.value!=='number'||!Number.isFinite(sourceIn.value)||!Number.isFinite(sourceOut.value)||sourceIn.value<0||sourceOut.value<=sourceIn.value||offset>=sourceOut.value-sourceIn.value)throw Error('Reference clip has an invalid or exhausted source range.');
   start=sourceIn.value+offset;duration=Math.min(requested??15,sourceOut.value-start);
  }
  const page=await c.workspace.inspect({section:'media',...(mediaId?{...scope,ids:[mediaId]}:{sourceIds:[id]}),limit:2});scope={documentId:page.documentId,projectRevision:page.projectRevision};
  if(page.total!==1)throw Error('Reference media is missing or ambiguous. Refresh get_project.');mediaId=page.items[0].id;
  const value=await c.workspace.readValue({...scope,ref:page.items[0].properties.ref,path:['path'],limit:4096});
  if(value.kind==='scalar'&&typeof value.value==='string')file=value.value;else if(value.kind==='string'&&value.next===null)file=value.text;else throw Error('Reference media has no usable local file path.');
 }
 if(!path.isAbsolute(file))throw Error('Reference media must resolve to an absolute local file.');stop(signal);
 const check=async()=>{stop(signal);if(scope&&mediaId)await c.workspace.inspect({...scope,section:'media',ids:[mediaId],limit:1});};
 if(key==='reference_path'&&input.reference_offset_sec===undefined&&requested===undefined)return {...await capture(file,signal),check,source:{kind:'file',start_sec:0}};
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||!before.size)throw Error('Reference source must be a regular local media file.');
 const directory=await fs.mkdtemp(path.join(c.extension.storagePath,'reference-'));
 try{
  const output=path.join(directory,'reference.wav'),host=await c.host.read(),child=await c.processes.spawn({file:host.tools.ffmpeg,args:['-nostdin','-v','error','-n','-ss',String(start),'-i',file,'-t',String(duration),'-map','0:a:0','-vn','-ac','1','-ar','24000','-c:a','pcm_s16le','-fs',String(MAX_AUDIO),output],signal,timeoutMs:90000,maxOutputBytes:65536}),result=await child.result;
  if(result.code!==0)throw Error('Could not extract reference audio from the selected source. '+result.stderr.slice(-500));
  const after=await fs.lstat(file);if(!after.isFile()||after.isSymbolicLink()||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Reference source changed during extraction.');
  await check();return {...await capture(output,signal),check,source:{kind:key==='reference_clip_id'?'clip':key==='reference_media_id'?'media':'file',id:key==='reference_path'?undefined:id,start_sec:start,duration_sec:duration}};
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
