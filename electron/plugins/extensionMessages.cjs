// Host-rendered notifications. Extension code supplies text and opaque action IDs,
// never markup, application controls or a callback executable in the renderer.
const {randomUUID}=require('node:crypto');
const text=(value,max)=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
function messageInput(input){
 if(!input||!text(input.message,500)||!['info','warning','error'].includes(input.kind??'info'))throw Error('Invalid extension message');
 if(input.detail!==undefined&&!text(input.detail,2000))throw Error('Invalid extension message detail');
 const actions=input.actions??[];
 if(!Array.isArray(actions)||actions.length>3||Array.from({length:actions.length},(_,index)=>Object.hasOwn(actions,index)).includes(false)||actions.some(action=>!action||!text(action.id,80)||!text(action.title,80))||new Set(actions.map(action=>action.id)).size!==actions.length)throw Error('Use at most three distinct message actions');
 const timeoutMs=input.timeoutMs??120000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>240000)throw Error('Message timeout must be between one second and four minutes');
 return {message:input.message,detail:input.detail??'',kind:input.kind??'info',actions:actions.map(({id,title})=>({id,title})),timeoutMs};
}
class ExtensionMessages {
 constructor({isActive,getWindow}){Object.assign(this,{isActive,getWindow});this.pending=new Map();this.owners=new Map();this.rates=new WeakMap();this.revision=0;this.onChanged=()=>{};}
 list(owner=this.getWindow()){return {revision:this.revision,items:[...this.pending.values()].filter(record=>record.owner===owner).map(record=>record.data)};}
 changed(owner){this.revision++;this.onChanged(owner,this.list(owner));}
 watch(owner){
  if(this.owners.has(owner))return;
  const wc=owner.webContents,close=()=>this.closed(owner),navigate=(_event,_url,inPlace,main)=>{if(main&&!inPlace)close();};
  this.owners.set(owner,{wc,close,navigate});wc.on('destroyed',close);wc.on('render-process-gone',close);wc.on('did-start-navigation',navigate);
 }
 unwatch(owner){const record=this.owners.get(owner);if(!record)return;for(const [name,listener] of [['destroyed',record.close],['render-process-gone',record.close],['did-start-navigation',record.navigate]])record.wc.removeListener(name,listener);this.owners.delete(owner);}
 show(job,input,token){
  const value=messageInput(input);if(!this.isActive(job))throw Error('Extension stopped');
  if(typeof token!=='string'||!/^\d{1,16}$/.test(token))throw Error('Invalid message operation');
  const owner=this.getWindow();if(!owner||owner.isDestroyed()||owner.webContents.isDestroyed())throw Error('Application window unavailable');
  if(this.pending.size>=12||[...this.pending.values()].filter(record=>record.job===job).length>=3)throw Error('Too many pending extension messages');
  if([...this.pending.values()].some(record=>record.job===job&&record.token===token))throw Error('Duplicate message operation');
  const now=Date.now();let rate=this.rates.get(job);if(!rate||now-rate.start>=60000)this.rates.set(job,rate={start:now,count:0});if(rate.count>=30)throw Error('Extension message rate exceeded');rate.count++;
  return new Promise(resolve=>{
   const id=randomUUID(),data={id,extensionId:job.manifest.id,extensionName:job.manifest.name,...value};delete data.timeoutMs;
   const timer=setTimeout(()=>this.finish(id),value.timeoutMs);timer.unref?.();this.pending.set(id,{job,owner,token,data,resolve,timer});this.watch(owner);this.changed(owner);
  });
 }
 finish(id,action,owner){
  const record=this.pending.get(id);if(!record||owner&&record.owner!==owner)return false;
  if(action!==undefined&&(!this.isActive(record.job)||!record.data.actions.some(item=>item.id===action)))return false;
  this.pending.delete(id);clearTimeout(record.timer);record.resolve(action);
  if(![...this.pending.values()].some(item=>item.owner===record.owner))this.unwatch(record.owner);
  this.changed(record.owner);return true;
 }
 dismiss(job,token){for(const [id,record] of this.pending)if(record.job===job&&record.token===token)return this.finish(id);return false;}
 prune(){for(const [id,record] of this.pending)if(!this.isActive(record.job))this.finish(id);}
 closed(owner){for(const [id,record] of this.pending)if(record.owner===owner)this.finish(id);}
 dispose(){for(const id of this.pending.keys())this.finish(id);}
}
module.exports={ExtensionMessages,messageInput};
