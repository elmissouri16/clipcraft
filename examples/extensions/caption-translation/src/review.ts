import type {ExtensionContext,JobContext,Disposable} from '@clipcraft/plugin-sdk/extension';
import crypto from 'node:crypto';
import type {Connection,Source} from './source';
export async function review(c:ExtensionContext,data:Source,translations:string[],language:string,connection:Connection,job:JobContext){
 const run=crypto.randomUUID(),view=await c.ui.registerView({id:'translation-review',title:'Review caption translation',entry:'assets/review.html'}),subscriptions:Disposable[]=[];
 let payload:unknown={type:'review',run,language,track:data.track,connection:connection.providerName,model:connection.model,cues:data.cues.map((cue,index)=>({...cue,translation:translations[index]}))};let finish:(value:boolean)=>void,fail:(error:Error)=>void,settled=false;
 const decision=new Promise<boolean>((resolve,reject)=>{finish=value=>{if(!settled){settled=true;resolve(value);}};fail=error=>{if(!settled){settled=true;reject(error);}};});decision.catch(()=>{});
 const abort=()=>fail(Error('Caption review canceled.'));job.signal.addEventListener('abort',abort,{once:true});if(job.signal.aborted)abort();
 try{
  subscriptions.push(view.onMessage(async(value:unknown)=>{const message=value as {type?:string;run?:string};if(settled||job.signal.aborted)return;if(message?.type==='ready')await view.postMessage(payload);else if(message?.run===run&&['apply','discard'].includes(message.type??''))finish(message.type==='apply');}));
  subscriptions.push(view.onDidClose(event=>event.error?fail(Error('Caption review could not remain open: '+event.error)):finish(false)));
  await view.reveal();return await decision;
 }finally{payload=null;job.signal.removeEventListener('abort',abort);for(const subscription of subscriptions)subscription.dispose();await view.dispose();}
}
