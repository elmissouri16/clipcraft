import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {JobContext} from '@clipcraft/plugin-sdk/extension';

export function stop(signal:AbortSignal){if(signal.aborted)throw Error('Local speech job canceled.');}
export async function fingerprint(file:string){const stat=await fsp.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Choose a regular file without a symbolic link.');return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');}
export async function hashFile(file:string,signal:AbortSignal){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file)){stop(signal);hash.update(chunk);}stop(signal);return hash.digest('hex');}
export async function capture(source:string,destination:string,limit:number,signal:AbortSignal){
 const before=await fingerprint(source),stat=await fsp.stat(source);if(stat.size<1||stat.size>limit)throw Error('Source exceeds its size limit.');let bytes=0;
 await pipeline(fs.createReadStream(source),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>limit?Error('Source exceeds its size limit.'):null,chunk);}}),fs.createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
 if(bytes!==stat.size||await fingerprint(source)!==before)throw Error('Source changed during capture.');stop(signal);
}
function approved(value:string){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='huggingface.co'||url.hostname.endsWith('.huggingface.co')||url.hostname.endsWith('.hf.co')))throw Error('Model redirect is outside the approved HTTPS catalog.');return url.href;}
export async function download(url:string,destination:string,size:number,sha256:string,job:JobContext){
 const controller=new AbortController(),signal=AbortSignal.any([job.signal,controller.signal]);let last=Date.now(),response:Response|undefined;
 const stall=setInterval(()=>{if(Date.now()-last>30000)controller.abort();},1000);
 try{
  for(let redirects=0;redirects<=5;redirects++){
   stop(signal);response=await fetch(approved(url),{redirect:'manual',signal});last=Date.now();
   if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();response=undefined;if(!location)throw Error('Model redirect has no destination.');url=new URL(location,url).href;continue;}break;
  }
  if(!response||response.status!==200||!response.body)throw Error('Model download did not return a file.');
  const length=response.headers.get('content-length');if(length!==null&&Number(length)!==size)throw Error('Model download size differs from its pin.');
  let bytes=0,lastProgress=0;const hash=crypto.createHash('sha256');
  await pipeline(Readable.fromWeb(response.body as never),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;last=Date.now();hash.update(chunk);if(last-lastProgress>200){lastProgress=last;job.progress(bytes/size,'Downloading the selected pinned model').catch(()=>{});}done(bytes>size?Error('Model exceeds its pinned size.'):null,chunk);}}),fs.createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
  if(bytes!==size||hash.digest('hex')!==sha256)throw Error('Model checksum differs from its pin.');stop(signal);
 }finally{clearInterval(stall);await response?.body?.cancel().catch(()=>{});}
}
