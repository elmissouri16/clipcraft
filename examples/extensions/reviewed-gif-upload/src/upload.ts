import type {ExtensionContext,JobContext} from '@clipcraft/plugin-sdk/extension';
import type {GifResult} from './gif';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export type UploadReceipt={state:'confirmed'|'uncertain'|'not-sent';reason:string;status?:number;bytes:number;sha256:string};
const canceled=(signal:AbortSignal)=>{if(signal.aborted)throw Error('Upload canceled.');};
export async function reviewUpload(c:ExtensionContext,file:GifResult,job:JobContext):Promise<UploadReceipt>{
 let directory:string|undefined,started=false,bytes=0,status:number|undefined;
 const receipt=(state:UploadReceipt['state'],reason:string):UploadReceipt=>({state,reason,...(status===undefined?{}:{status}),bytes,sha256:file.sha256});
 try{
  const address=await c.configuration.get<string>('uploadUrl');
  if(!address)return receipt('not-sent','no-upload-address');
  const url=new URL(address);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Choose an HTTPS address without embedded credentials or a fragment.');
  canceled(job.signal);
  directory=await fsp.mkdtemp(path.join(c.extension.storagePath,'upload-'));
  const snapshot=path.join(directory,'reviewed.gif'),hash=crypto.createHash('sha256');let captured=0;
  const stat=await fsp.lstat(file.path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||file.bytes>256*1024*1024)throw Error('The saved GIF changed before review.');
  await pipeline(fs.createReadStream(file.path),new Transform({transform(chunk,_encoding,done){captured+=chunk.length;hash.update(chunk);done(captured>file.bytes?Error('The saved GIF changed.'):null,chunk);}}),fs.createWriteStream(snapshot,{flags:'wx',mode:0o600}),{signal:job.signal});
  if(captured!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('The saved GIF changed before review.');
  const action=await c.ui.showMessage({message:'Upload this saved GIF?',detail:`One HTTPS PUT to ${url.origin}${url.pathname}. File: ${path.basename(file.path)}. Bytes: ${file.bytes}. SHA-256: ${file.sha256}. The address query and authorization token are hidden. Redirects and retries are disabled. Cancellation after sending can leave a copy at the service.`,actions:[{id:'upload',title:'Upload once'},{id:'keep',title:'Keep local only'}]},{signal:job.signal});
  if(action!=='upload')return receipt('not-sent','review-declined');
  const token=await c.secrets.get('uploadToken');canceled(job.signal);
  if(token&&/[\r\n]/.test(token))throw Error('Invalid authorization token.');
  await job.progress(.1,'Uploading the reviewed GIF once');
  await new Promise<void>((resolve,reject)=>{
   let settled=false;const sentHash=crypto.createHash('sha256');
   const request=https.request(url,{method:'PUT',agent:false,signal:job.signal,headers:{'Content-Type':'image/gif','Content-Length':file.bytes,...(token?{Authorization:'Bearer '+token}:{})}});
   const timer=setTimeout(()=>request.destroy(Error('Upload deadline exceeded.')),30000);
   const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){request.destroy();reject(error);}else resolve();};
   request.once('socket',socket=>socket.once('secureConnect',()=>{started=true;}));
   request.once('error',finish);
   const response=new Promise<void>((done,fail)=>request.once('response',incoming=>{
    status=incoming.statusCode;let received=0;
    incoming.on('data',(chunk:Buffer)=>{received+=chunk.length;if(received>65536)incoming.destroy(Error('Upload response exceeded its limit.'));});
    incoming.once('error',fail);incoming.once('aborted',()=>fail(Error('Upload response interrupted.')));incoming.once('end',done);
   }));
   const body=pipeline(fs.createReadStream(snapshot),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;sentHash.update(chunk);done(bytes>file.bytes?Error('Upload source changed.'):null,chunk);}}),request,{signal:job.signal});
   Promise.all([body,response]).then(()=>{if(bytes!==file.bytes||sentHash.digest('hex')!==file.sha256)throw Error('Upload body verification failed.');if(!status||status<200||status>=300)throw Error('Upload was not acknowledged.');finish();},finish).catch(finish);
  });
  await job.progress(1,'Upload acknowledged').catch(()=>{});
  return receipt('confirmed','http-success');
 }catch{
  return receipt(started?'uncertain':'not-sent',job.signal.aborted?'canceled':started?'no-success-acknowledgment':'preflight-or-connection-failed');
 }finally{if(directory)await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{});}
}
