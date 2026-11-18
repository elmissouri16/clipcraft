// Native file pickers for trusted extensions. Stopping revokes the reply; the
// OS picker itself remains owned by its window until dismissed by the user.
const path=require('node:path');
const abortError=()=>Object.assign(Error('Extension file dialog canceled'),{name:'AbortError'});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function options(kind,input,name){
 if(!plain(input)||Object.keys(input).some(key=>!['token','title','buttonLabel','defaultPath','filters',...(kind==='open'?['kind','multiple']:[])].includes(key))||typeof input.token!=='string'||!/^\d{1,16}$/.test(input.token))throw Error('Invalid extension file dialog');
 const result={title:name};
 for(const [key,max] of [['title',160],['buttonLabel',80]])if(input[key]!==undefined){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max||/[\u0000-\u001f\u007f]/.test(input[key]))throw Error('Invalid file dialog text');result[key]=key==='title'?name+' — '+input[key]:input[key];}
 if(input.defaultPath!==undefined){if(typeof input.defaultPath!=='string'||!path.isAbsolute(input.defaultPath)||input.defaultPath.length>32768||input.defaultPath.includes('\0'))throw Error('File dialog defaultPath must be absolute');result.defaultPath=input.defaultPath;}
 if(input.filters!==undefined){
  if(!Array.isArray(input.filters)||input.filters.length>16)throw Error('Use at most 16 file filters');
  result.filters=input.filters.map(filter=>{if(!plain(filter)||Object.keys(filter).some(key=>!['name','extensions'].includes(key))||typeof filter.name!=='string'||!filter.name.trim()||filter.name.length>80||/[\u0000-\u001f\u007f]/.test(filter.name)||!Array.isArray(filter.extensions)||!filter.extensions.length||filter.extensions.length>32||filter.extensions.some(value=>typeof value!=='string'||! /^(?:[a-z0-9]{1,24}|\*)$/i.test(value)))throw Error('Invalid file filter');return {name:filter.name,extensions:[...new Set(filter.extensions)]};});
 }
 if(kind==='open'){
  if(input.kind!==undefined&&!['file','directory'].includes(input.kind)||input.multiple!==undefined&&typeof input.multiple!=='boolean')throw Error('Invalid open dialog selection');
  result.properties=[input.kind==='directory'?'openDirectory':'openFile',...(input.multiple?['multiSelections']:[])];
 }
 return result;
}
function paths(value){
 if(!Array.isArray(value)||value.length>128||value.some(file=>typeof file!=='string'||!path.isAbsolute(file)||file.length>32768||file.includes('\0'))||value.reduce((sum,file)=>sum+Buffer.byteLength(file),0)>1024*1024)throw Error('Native dialog returned invalid paths');
 return value;
}
class ExtensionDialogs{
 constructor({dialog,getWindow,isActive}){Object.assign(this,{dialog,getWindow,isActive});}
 show(job,kind,input,{signal}={}){
  if(!['open','save'].includes(kind))return Promise.reject(Error('Invalid dialog kind'));
  let settings;try{settings=options(kind,input,job.manifest.name);}catch(error){return Promise.reject(error);}
  if(!this.isActive(job)||signal?.aborted)return Promise.reject(abortError());
  if(this.current)return Promise.reject(Error('Another extension file dialog is open. Dismiss it before opening another.'));
  const owner=this.getWindow();if(!owner||owner.isDestroyed())return Promise.reject(Error('Editor window is unavailable'));
  let resolve,reject;const answer=new Promise((yes,no)=>{resolve=yes;reject=no;}),record={job,token:input.token,settled:false};this.current=record;
  const finish=(error,value)=>{if(record.settled)return;record.settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);},abort=()=>finish(abortError());record.abort=abort;
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{if(record.settled||signal?.aborted||!this.isActive(job))throw abortError();return kind==='open'?this.dialog.showOpenDialog(owner,settings):this.dialog.showSaveDialog(owner,settings);}).then(value=>{
   if(!this.isActive(job)||signal?.aborted){abort();return;}
   if(value?.canceled){finish(null,undefined);return;}
   const selected=paths(kind==='open'?value?.filePaths:[value?.filePath]);if(kind==='open'&&!input.multiple&&selected.length>1)throw Error('Native dialog returned too many paths');finish(null,kind==='open'?selected:selected[0]);
  }).catch(error=>finish(error)).finally(()=>{if(this.current===record)this.current=null;});
  return answer;
 }
 cancel(job,token){const record=this.current;if(!record||record.job!==job||record.token!==token)return false;record.abort();return true;}
 stopped(job){if(this.current?.job===job)this.current.abort();}
}
module.exports={ExtensionDialogs,dialogOptions:options};
