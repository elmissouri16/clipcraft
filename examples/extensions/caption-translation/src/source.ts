import type {ExtensionContext,CaptionCueInput,InspectionScope,JobContext} from '@clipcraft/plugin-sdk/extension';
export type Connection={connection:string;providerName:string;model:string;location:string};
export type Source={scope:InspectionScope;duration:number;cues:CaptionCueInput[];track?:number};
export function stop(signal:AbortSignal){if(signal.aborted)throw Error('Caption workflow canceled.');}
export async function watch(c:ExtensionContext,scope:InspectionScope,controller:AbortController){
 const subscriptions=[c.events.on('project.changed',event=>{if(event.documentId!==scope.documentId||event.projectRevision>scope.projectRevision)controller.abort();}),c.events.on('project.closed',()=>controller.abort()),c.events.on('project.opened',event=>{if(event.documentId!==scope.documentId)controller.abort();})];let disposed=false;
 const dispose=async()=>{if(disposed)return;disposed=true;await Promise.all(subscriptions.map(item=>item.dispose()));};
 try{await Promise.all(subscriptions.map(item=>item.ready));await unchanged(c,scope);return {dispose};}catch(error){await dispose();throw error;}
}
export async function unchanged(c:ExtensionContext,scope:InspectionScope){await c.workspace.inspect({...scope,section:'project',limit:1});}
export async function source(c:ExtensionContext,track?:number):Promise<Source>{
 if(track!==undefined&&(!Number.isInteger(track)||track<1||track>128))throw Error('Choose a source Text track from 1 to 128.');
 const tracks=await c.workspace.inspect({section:'tracks',lane:'text',limit:128}),scope={documentId:tracks.documentId,projectRevision:tracks.projectRevision},document=await c.workspace.read();if(document.documentId!==scope.documentId)throw Error('The project changed.');
 const selected=tracks.items.filter(row=>track===undefined||row.layer===track-1);if(!selected.length)throw Error('The chosen Text track does not exist.');const cues:CaptionCueInput[]=[];
 for(const row of selected){let cursor:number|undefined;
  do{const page=await c.captions.read({trackId:row.id,cursor,limit:1000});if(page.documentId!==scope.documentId||cues.length+page.total>(track===undefined?1000:100))throw Error('Use at most 1000 chapter cues or 100 translation cues.');
   cues.push(...page.cues.map(cue=>({start_sec:cue.start_sec,end_sec:cue.end_sec,text:cue.text.replace(/[\u0000-\u001f\u007f]/g,' ').trim()})));cursor=page.next??undefined;
  }while(cursor!==undefined);
 }
 cues.sort((a,b)=>a.start_sec-b.start_sec);if(!cues.length)throw Error('Add timeline captions before running this command.');let characters=0;
 for(const [index,cue] of cues.entries())if(!cue.text||!Number.isFinite(cue.start_sec)||!Number.isFinite(cue.end_sec)||cue.start_sec<0||cue.end_sec<=cue.start_sec||cue.end_sec>document.duration_sec||(characters+=cue.text.length)>(track===undefined?24000:12000)||track!==undefined&&index>0&&cue.start_sec<cues[index-1].end_sec-1e-6)throw Error('Caption text or timing exceeds this workflow’s bounds. Translation needs one nonoverlapping track.');
 await unchanged(c,scope);return {scope,duration:document.duration_sec,cues,...(track===undefined?{}:{track})};
}
export async function consent(c:ExtensionContext,data:Source,purpose:string,job:JobContext){
 const connection=await c.services.call<Connection>('clipcraft.ai','describe',{});await unchanged(c,data.scope);stop(job.signal);
 const action=await c.ui.showMessage({message:'Share caption text for '+purpose+'?',detail:`${data.cues.length} cues, ${data.cues.reduce((n,cue)=>n+cue.text.length,0)} text characters${data.track===undefined?' across the timeline':' from Text track '+data.track}. Connection: ${connection.providerName}. Model: ${connection.model}. Destination: ${connection.location}. Only the captured caption text and timing are sent. No media is uploaded. Review the result before applying it.`,actions:[{id:'send',title:'Send caption text'},{id:'cancel',title:'Cancel'}]},{signal:job.signal});
 if(action!=='send')return;await unchanged(c,data.scope);stop(job.signal);return connection;
}
export async function complete(c:ExtensionContext,connection:Connection,system:string,payload:unknown,maxTokens:number){const result=await c.services.call<{text:string}>('clipcraft.ai','complete',{connection:connection.connection,system,messages:[{role:'user',content:JSON.stringify(payload)}],maxTokens,timeoutMs:60000});return result.text;}
export function exact(value:unknown,fields:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw Error('The model returned unsupported response fields.');}
export function plain(value:unknown,limit:number):value is string{return typeof value==='string'&&value.trim().length>0&&value.length<=limit&&!/[\u0000-\u001f\u007f]/.test(value);}
