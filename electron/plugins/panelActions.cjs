const crypto=require('node:crypto');
const commands=import('../../shared/pluginCommands.mjs');
// Main owns action identities. Neither the page nor its worker can approve or commit edits.
class PanelActions{
 constructor(runtime){this.runtime=runtime;this.pending=new Map();}
 async run(job,args){
  if(!args||Object.keys(args).some(k=>!['commandId','input'].includes(k))||!job.panel.commands?.includes(args.commandId))throw Error('Command is not declared by this panel.');
  if(job.actionsDenied)return {status:'denied'};
  if(job.action||this.runtime.manager.commandRuntime?.active)return {status:'failed'};
  await this.runtime.verify(job);
  const bundle=await this.runtime.manager.commandBundle(job.key);
  if(job.closed)return {status:'canceled'};
  if(bundle.manifest.permissions.some(p=>!['project.read','editor.read','markers.write','clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p)))throw Error('Unsupported panel action permissions.');
  const command=bundle.manifest.contributes.commands.find(c=>c.id===args.commandId);
  if(!command)throw Error('Unknown panel command.');
  const input=(await commands).commandInput(command,args.input);
  // Recheck after asynchronous validation: simultaneous requests cannot reserve two actions.
  if(job.closed)return {status:'canceled'};
  if(job.action||this.runtime.manager.commandRuntime?.active)return {status:'failed'};
  const action={job,id:crypto.randomUUID(),runId:crypto.randomUUID(),command:{id:command.id,key:job.key,permissions:bundle.manifest.permissions},input};
  const result=new Promise(resolve=>{action.resolve=resolve;});job.action=action;this.pending.set(action.id,action);
  action.timer=setTimeout(()=>this.cancel(job),5000);action.timer.unref?.();
  this.runtime.notify(job,{type:'action',actionId:action.id});
  return result;
 }
 find(panelId,actionId){const action=this.pending.get(actionId);return action?.job.id===panelId?action:null;}
 claim(panelId,actionId){
  const action=this.find(panelId,actionId);if(!action||action.claimed||action.job.closed)return null;
  action.claimed=true;clearTimeout(action.timer);
  return {runId:action.runId,command:action.command,input:action.input};
 }
 bind(request){
  const ref=request.panelAction;
  if(!ref||Object.keys(ref).some(k=>!['panelId','actionId'].includes(k)))throw Error('Invalid panel action reference.');
  const action=this.find(ref.panelId,ref.actionId);
  if(!action||action.job.closed||!action.claimed||action.started||action.runId!==request.runId||action.command.key!==request.key||action.command.id!==request.commandId||JSON.stringify(action.input)!==JSON.stringify(request.input))throw Error('Panel action is no longer available.');
  action.started=true;
 }
 async authorize(panelId,actionId,runId){
  const action=this.find(panelId,actionId);
  if(!action||action.job.closed||!action.started||action.committing||action.runId!==runId)return false;
  try{await this.runtime.verify(action.job);}catch{this.cancel(action.job);return false;}
  if(this.find(panelId,actionId)!==action||action.job.closed||action.committing)return false;
  action.committing=true;return true;
 }
 progress(panelId,actionId,value){
  const action=this.find(panelId,actionId);if(!action||action.job.closed)return false;
  const phases=['permission','running','applying','completed','failed','canceled','denied'];
  if(!value||!phases.includes(value.phase))return false;
  const progress=Number.isFinite(value.progress)?Math.max(0,Math.min(1,value.progress)):0;
  action.job.view?.webContents.send('pluginPanel:progress',{phase:value.phase,progress});return true;
 }
 finish(panelId,actionId,value){
  const action=this.find(panelId,actionId);if(!action)return false;
  let result={status:['failed','denied','canceled'].includes(value?.phase)?value.phase:'failed'};
  if(value?.phase==='completed'&&action.committing&&action.command.permissions.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p))&&Number.isInteger(value.clipsChanged)&&value.clipsChanged>=0&&value.clipsChanged<=64)result={status:'completed',markers_added:0,clips_changed:value.clipsChanged};
  else if(value?.phase==='completed'&&action.committing&&!action.command.permissions.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p))&&Number.isInteger(value.markersAdded)&&value.markersAdded>=0&&value.markersAdded<=500)result={status:'completed',markers_added:value.markersAdded};
  if(result.status==='denied')action.job.actionsDenied=true;
  this.settle(action,result);return true;
 }
 settle(action,result){clearTimeout(action.timer);this.pending.delete(action.id);if(action.job.action===action)action.job.action=null;action.resolve(result);}
 cancel(job){
  const action=job.action;if(!action)return false;
  if(action.committing){
   // A reducer commit already authorized must report its actual result, not a false rollback.
   if(job.closed&&!action.cleanup){action.cleanup=true;action.timer=setTimeout(()=>this.settle(action,{status:'failed'}),5000);action.timer.unref?.();}
   return false;
  }
  this.runtime.manager.commandRuntime?.cancel(action.runId);
  this.runtime.notify(job,{type:'actionCancel',actionId:action.id});
  this.settle(action,{status:'canceled'});return true;
 }
}
module.exports={PanelActions};
