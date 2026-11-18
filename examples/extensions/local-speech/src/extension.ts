import type {ExtensionContext,JobContext} from '@clipcraft/plugin-sdk/extension';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {models,type ModelId} from './models';
import {capture,download,fingerprint,hashFile,stop} from './files';
type Tool={path:string;sha256:string;fingerprint:string;platform:string;arch:string};
let root:string,busy=false;
const languages=['auto','en','fr','es','ar','de','it','pt','nl','ja','ko','zh','hi','tr'];
async function selected(c:ExtensionContext){const id=await c.configuration.get<string>('model')??'base';if(!Object.hasOwn(models,id))throw Error('Choose a supported model.');return {id:id as ModelId,model:models[id as ModelId]};}
async function command(c:ExtensionContext,file:string,args:string[],job:JobContext,timeoutMs=300000){const process=await c.processes.spawn({file,args,signal:job.signal,timeoutMs,maxOutputBytes:65536}),result=await process.result;if(result.code!==0)throw Error('The local tool failed. Check that the executable supports this model.');return result;}
async function configureTool(c:ExtensionContext,job:JobContext){
 const selected=await c.ui.showOpenDialog({title:'Choose a compatible whisper-cli executable'},{signal:job.signal});if(!selected?.[0])return {message:'No executable selected.'};
 const file=await fsp.realpath(selected[0]),before=await fingerprint(file),size=(await fsp.stat(file)).size;if(size<1||size>128*1024*1024)throw Error('Choose a regular executable below 128 MiB.');
 const sha256=await hashFile(file,job.signal);
 const action=await c.ui.showMessage({message:'Allow this local speech executable?',detail:`Path: ${file}. SHA-256: ${sha256}. This extension will run its help probe and use it for local transcription.`,actions:[{id:'allow',title:'Use executable'},{id:'cancel',title:'Cancel'}]},{signal:job.signal});if(action!=='allow')return {message:'Executable was not changed.'};
 if(await fingerprint(file)!==before||await hashFile(file,job.signal)!==sha256)throw Error('Executable changed after review.');
 const probe=await command(c,file,['--help'],job,10000);if(!/usage:[^\n]*whisper/i.test(probe.stdout+'\n'+probe.stderr)||await fingerprint(file)!==before||await hashFile(file,job.signal)!==sha256)throw Error('Choose an unchanged, compatible whisper-cli executable.');
 const host=await c.host.read();await c.configuration.update({key:'tool',value:{path:file,sha256,fingerprint:before,platform:host.platform,arch:host.arch}});return {message:'Local speech executable configured.',sha256};
}
async function setupModel(c:ExtensionContext,job:JobContext,network:boolean){
 const {id,model}=await selected(c),destination=path.join(root,model.file),part=path.join(root,'.part-'+crypto.randomUUID());
 const action=await c.ui.showMessage({message:network?'Download this speech model?':'Import this speech model?',detail:`Model: ${id}. Bytes: ${model.size}. SHA-256: ${model.sha256}. ${network?'The extension will download only this pinned file from Hugging Face over HTTPS.':'Choose a local file matching this exact size and checksum.'}`,actions:[{id:'continue',title:network?'Download model':'Choose model'},{id:'cancel',title:'Cancel'}]},{signal:job.signal});if(action!=='continue')return {message:'Model setup canceled.'};
 try{
  if(network)await download('url' in model?model.url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'+model.file,part,model.size,model.sha256,job);
  else{const picked=await c.ui.showOpenDialog({title:'Choose '+model.file,filters:[{name:'Pinned model',extensions:['bin']}]},{signal:job.signal});if(!picked?.[0])return {message:'No model selected.'};await capture(picked[0],part,model.size,job.signal);if((await fsp.stat(part)).size!==model.size||await hashFile(part,job.signal)!==model.sha256)throw Error('Imported model differs from its pinned checksum or size.');}
  stop(job.signal);fs.renameSync(part,destination);await job.progress(1,'Model ready').catch(()=>{});return {message:'Selected model verified and ready.',model:id,sha256:model.sha256};
 }finally{await fsp.rm(part,{force:true}).catch(()=>{});}
}
function timestamp(seconds:number){const value=Math.round(seconds*1000),h=Math.floor(value/3600000),m=Math.floor(value/60000)%60,s=Math.floor(value/1000)%60;return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+','+String(value%1000).padStart(3,'0');}
async function transcribe(c:ExtensionContext,job:JobContext){
 const tool=await c.configuration.get<Tool>('tool'),host=await c.host.read(),{id,model}=await selected(c),modelFile=path.join(root,model.file);
 if(!tool||tool.platform!==host.platform||tool.arch!==host.arch||await fingerprint(tool.path)!==tool.fingerprint||await hashFile(tool.path,job.signal)!==tool.sha256)throw Error('Configure the local executable first.');
 const modelStamp=await fingerprint(modelFile);if((await fsp.stat(modelFile)).size!==model.size||await hashFile(modelFile,job.signal)!==model.sha256||await fingerprint(modelFile)!==modelStamp)throw Error('Import or download the verified selected model first.');
 const start=await c.configuration.get<number>('start_sec')??0,duration=await c.configuration.get<number>('duration_sec')??30,language=await c.configuration.get<string>('language')??'auto';
 if(!Number.isFinite(start)||start<0||start>86400||!Number.isFinite(duration)||duration<.1||duration>120||!languages.includes(language))throw Error('Choose a valid transcription range and language.');
 const picked=await c.ui.showOpenDialog({title:'Choose audio or video for local transcription',filters:[{name:'Audio and video',extensions:['wav','mp3','ogg','m4a','mp4','mov','webm','flac']}]},{signal:job.signal});if(!picked?.[0])return {message:'No media selected.'};
 const directory=await fsp.mkdtemp(path.join(root,'.part-job-')),source=path.join(directory,'source'+path.extname(picked[0]).toLowerCase()),wav=path.join(directory,'audio.wav'),output=path.join(directory,'transcript');let monitor:ReturnType<typeof setInterval>|undefined;
 const controller=new AbortController(),signal=AbortSignal.any([job.signal,controller.signal]),scoped={...job,signal};
 try{
  await capture(picked[0],source,512*1024*1024,signal);
  const probe=await command(c,host.tools.ffprobe,['-v','error','-show_entries','stream=codec_type:format=duration','-of','json',source],scoped,30000),metadata=JSON.parse(probe.stdout);
  if(!metadata.streams?.some((stream:{codec_type:string})=>stream.codec_type==='audio')||!Number.isFinite(Number(metadata.format?.duration))||start+duration>Number(metadata.format.duration)+.05)throw Error('Choose a range within the selected audio source.');
  const action=await c.ui.showMessage({message:'Transcribe this media locally?',detail:`File: ${path.basename(picked[0])}. Range: ${start}–${start+duration} seconds. Model: ${id}. The extension runs bundled FFmpeg and your selected whisper-cli. Review the transcript before saving a new SRT. No audio or transcript is uploaded.`,actions:[{id:'run',title:'Transcribe locally'},{id:'cancel',title:'Cancel'}]},{signal});if(action!=='run')return {message:'Transcription canceled.'};
  const verify=async()=>{stop(signal);if(await fingerprint(tool.path)!==tool.fingerprint||await fingerprint(modelFile)!==modelStamp)throw Error('Executable or model changed.');};
  await verify();await job.progress(.1,'Preparing local audio');const sourceOptions=['.mp4','.mov','.m4v','.m4a'].includes(path.extname(source))?['-enable_drefs','0','-use_absolute_path','0']:[];
  await command(c,host.tools.ffmpeg,['-v','error','-nostdin','-n','-threads','2','-protocol_whitelist','file,pipe',...sourceOptions,'-ss',String(start),'-i',source,'-t',String(duration),'-map','0:a:0','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],scoped);
  await verify();await job.progress(.3,'Transcribing on this computer');let checking=false;
  monitor=setInterval(async()=>{if(checking)return;checking=true;try{await verify();const stat=await fsp.stat(output+'.json').catch(()=>undefined);if(stat&&stat.size>2*1024*1024)throw Error('Transcript exceeds its size limit.');}catch{controller.abort();}finally{checking=false;}},100);
  await command(c,tool.path,['-m',modelFile,'-f',wav,'-of',output,'-l',language,'-oj','-np','-t','4','-ml','80','-sow'],scoped,600000);await verify();
  const jsonFile=output+'.json';if((await fsp.stat(jsonFile)).size>2*1024*1024)throw Error('Transcript exceeds 2 MiB.');const segments=JSON.parse(await fsp.readFile(jsonFile,'utf8')).transcription;
  if(!Array.isArray(segments)||segments.length>1000)throw Error('Invalid or excessive local transcript.');let characters=0;
  const cues=segments.map(segment=>{const from=segment.offsets?.from/1000,to=segment.offsets?.to/1000,text=typeof segment.text==='string'?segment.text.trim():'';characters+=text.length;if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||from>=duration||to<=from||to>duration+.25||!text||text.length>2000||characters>64000||/[\u0000-\u0008\u000b-\u001f]/.test(text))throw Error('Invalid local caption cue.');return {from,to:Math.min(to,duration),text};});
  if(!cues.length)return {message:'No speech was detected.',model:id,cues:0,saved:false};
  await job.progress(.9,'Review the transcript');
  const review=await c.ui.showMessage({message:`Review ${cues.length} local caption cues`,detail:cues.map(cue=>cue.text.replace(/\s+/g,' ')).join(' ').slice(0,1800),actions:[{id:'save',title:'Save SRT'},{id:'discard',title:'Discard'}]},{signal});if(review!=='save')return {message:'Transcript discarded.',model:id,cues:cues.length,saved:false};
  const destination=await c.ui.showSaveDialog({title:'Save a new local transcript',defaultPath:path.join(os.homedir(),'local-transcript.srt'),filters:[{name:'SubRip captions',extensions:['srt']}]},{signal});if(!destination)return {message:'No transcript saved.',saved:false};if(path.extname(destination).toLowerCase()!=='.srt')throw Error('Choose a .srt filename.');
  const content=cues.map((cue,index)=>`${index+1}\n${timestamp(cue.from)} --> ${timestamp(cue.to)}\n${cue.text.replace(/\r\n?/g,'\n')}\n`).join('\n'),srt=path.join(directory,'result.srt');await fsp.writeFile(srt,content,{flag:'wx',mode:0o600});await verify();
  const file=await c.files.publish({path:srt,destination},{signal});await job.progress(1,'Transcript saved').catch(()=>{});return {message:'Local transcript saved.',model:id,cues:cues.length,characters,saved:true,file};
 }finally{if(monitor)clearInterval(monitor);controller.abort();await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{});}
}
export async function activate(c:ExtensionContext){
 root=path.join(c.extension.storagePath,'local-speech');await fsp.mkdir(root,{recursive:true});for(const file of await fsp.readdir(root))if(file.startsWith('.part-'))await fsp.rm(path.join(root,file),{recursive:true,force:true});
 await c.ui.registerSettings({id:'speech',title:'Local speech transcript',location:'settings.plugins',fields:[{key:'model',label:'Pinned model',type:'select',default:'base',options:Object.keys(models).map(value=>({value,label:value}))},{key:'language',label:'Language',type:'select',default:'auto',options:languages.map(value=>({value,label:value}))},{key:'start_sec',label:'Start in seconds',type:'number',min:0,max:86400,step:.1,default:0},{key:'duration_sec',label:'Duration in seconds',type:'number',min:.1,max:120,step:.1,default:30}]});
 for(const [id,title,work] of [
  ['configure-tool','Configure local executable',configureTool],['import-model','Import pinned model',(c:ExtensionContext,j:JobContext)=>setupModel(c,j,false)],['download-model','Download pinned model',(c:ExtensionContext,j:JobContext)=>setupModel(c,j,true)],['transcribe','Local transcription',transcribe],
  ['remove-model','Remove selected model',async(c:ExtensionContext,j:JobContext)=>{const {id,model}=await selected(c),action=await c.ui.showMessage({message:'Remove this extension’s cached model?',detail:`Only ${model.file} in this extension’s storage will be removed. Core transcription and other extensions are unchanged.`,actions:[{id:'remove',title:'Remove model'},{id:'cancel',title:'Cancel'}]},{signal:j.signal});if(action!=='remove')return {message:'Model retained.'};stop(j.signal);fs.rmSync(path.join(root,model.file),{force:true});return {message:'Model removed.',model:id};}]
 ] as const)await c.commands.register(id,(_input,control)=>{if(busy)throw Error('A local speech setup or transcription is already running.');busy=true;return c.jobs.run(title,job=>work(c,job),{signal:control.signal,timeoutMs:id==='download-model'||id==='import-model'?1800000:600000}).finally(()=>{busy=false;});});
 await c.commands.register('status',async()=>({tool:await c.configuration.get<Tool>('tool')??null,models:await Promise.all(Object.entries(models).map(async([id,model])=>({id,bytes:model.size,sha256:model.sha256,present:(await fsp.stat(path.join(root,model.file)).catch(()=>undefined))?.size===model.size}))),busy}));
}
