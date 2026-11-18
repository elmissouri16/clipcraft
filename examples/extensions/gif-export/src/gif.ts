import type {ExtensionContext,JobContext,NativeSettingField,PublishedFile} from '@clipcraft/plugin-sdk/extension';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
export type GifInput={start_sec?:number;end_sec?:number;fps?:number|string;max_size?:number|string};
export type GifResult=PublishedFile&{width:number;height:number;fps:number;frames:number;duration_sec:number};
let workRoot:string|undefined,busy=false;
export async function configure(c:ExtensionContext,extra:NativeSettingField[]=[]){
 workRoot=path.join(c.extension.storagePath,'gif-work');await fs.rm(workRoot,{recursive:true,force:true});
 await c.ui.registerSettings({id:'gif',title:'GIF export',location:'settings.plugins',fields:[
  {key:'start_sec',label:'Start in seconds',type:'number',min:0,max:1000000,step:.1,default:0},
  {key:'end_sec',label:'End in seconds (zero uses five seconds or project end)',type:'number',min:0,max:1000000,step:.1,default:0},
  {key:'fps',label:'Frame rate',type:'select',default:'10',options:[5,10,20].map(n=>({value:String(n),label:n+' fps'}))},
  {key:'max_size',label:'Longest edge',type:'select',default:'480',options:[320,480,720,960].map(n=>({value:String(n),label:n+' px'}))},...extra
 ]});
}
export async function renderGif(c:ExtensionContext,input:GifInput,job:JobContext):Promise<GifResult|undefined>{
 if(busy)throw Error('A GIF export from this extension is already running.');busy=true;let directory:string|undefined;
 try{
  const document=await c.workspace.read(),setting=async(key:keyof GifInput,fallback:unknown)=>input?.[key]??await c.configuration.get(key)??fallback;
  const start=await setting('start_sec',0),requestedEnd=await setting('end_sec',0),fps=Number(String(await setting('fps',10)).replace(/^fps-/,'')),cap=Number(String(await setting('max_size',480)).replace(/^size-/,''));
  if(typeof start!=='number'||!Number.isFinite(start)||typeof requestedEnd!=='number'||!Number.isFinite(requestedEnd)||![5,10,20].includes(fps)||![320,480,720,960].includes(cap))throw Error('Choose valid GIF range, frame rate and size settings.');
  const end=requestedEnd===0?Math.min(document.export_duration_sec,start+5):requestedEnd,seconds=end-start,frames=Math.ceil(seconds*fps-1e-7);
  if(start<0||end>document.export_duration_sec+1e-7||seconds<=0||seconds>15||frames<1||frames>300)throw Error('Choose a range inside the video timeline, at most fifteen seconds and 300 frames.');
  const destination=await c.ui.showSaveDialog({title:'Save a new GIF',defaultPath:path.join(os.homedir(),'clipcraft-export.gif'),filters:[{name:'Animated GIF',extensions:['gif']}]},{signal:job.signal});if(!destination)return;
  if(path.extname(destination).toLowerCase()!=='.gif')throw Error('Choose a .gif filename.');try{await fs.lstat(destination);throw Error('That file exists. Choose a new filename.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  directory=path.join(workRoot!,crypto.randomUUID());await fs.mkdir(directory,{recursive:true});await job.progress(.05,'Rendering the selected timeline range');
  const rendered=await c.exports.render({documentId:document.documentId,name:'GIF source',showCompletion:false,file_path:path.join(directory,'source.mp4'),range:{start_sec:start,end_sec:end},quality:'high',resolution:cap<=480?480:cap<=720?720:1080,encoder_preset:'ultrafast'},{signal:job.signal,onProgress:value=>{job.progress(.05+value.progress*.55,'Rendering GIF source').catch(()=>{});}});
  const scale=Math.min(1,cap/Math.max(rendered.metadata.width,rendered.metadata.height)),width=Math.max(2,Math.round(rendered.metadata.width*scale)),height=Math.max(2,Math.round(rendered.metadata.height*scale)),file=path.join(directory,'output.gif'),host=await c.host.read();
  await job.progress(.65,'Encoding the GIF');const filter=`[0:v]tpad=stop_mode=clone:stop_duration=1,fps=${fps},scale=${width}:${height}:flags=lanczos,trim=end_frame=${frames},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
  const encoding=await c.processes.spawn({file:host.tools.ffmpeg,args:['-nostdin','-v','error','-n','-i',rendered.file,'-filter_complex',filter,'-frames:v',String(frames),'-an','-loop','0','-fs',String(256*1024*1024),file],signal:job.signal,timeoutMs:300000,maxOutputBytes:65536}),encoded=await encoding.result;if(encoded.code!==0)throw Error(encoded.stderr||'GIF encoding failed.');
  await job.progress(.9,'Verifying GIF frames');const probe=await c.processes.spawn({file:host.tools.ffprobe,args:['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames:format=duration','-of','json',file],signal:job.signal,timeoutMs:30000,maxOutputBytes:65536}),checked=await probe.result;if(checked.code!==0)throw Error('GIF verification failed.');
  const metadata=JSON.parse(checked.stdout),stream=metadata.streams?.[0],size=(await fs.stat(file)).size;if(metadata.streams?.length!==1||stream.codec_name!=='gif'||stream.width!==width||stream.height!==height||Number(stream.nb_read_frames)!==frames||!Number.isFinite(Number(metadata.format?.duration))||size<1||size>256*1024*1024)throw Error('GIF output failed geometry, frame or size verification.');
  const published=await c.files.publish({path:file,destination},{signal:job.signal});await job.progress(1,'GIF saved').catch(()=>{});return {...published,width,height,fps,frames,duration_sec:frames/fps};
 }finally{busy=false;if(directory)await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});}
}
export async function deactivate(){if(workRoot)await fs.rm(workRoot,{recursive:true,force:true});}
