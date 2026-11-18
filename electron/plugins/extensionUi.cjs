const {randomUUID}=require('node:crypto');
// Generic native UI contributions. Services implement application integrations;
// executable packages have one Node runtime regardless of what they integrate.
const ID=/^[a-z][\w.-]{0,159}$/;
const text=(value,max=160)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const LOCATIONS=new Set(['toolbar','inspector','context','export','settings.voice','settings.plugins']);
function field(input){
 if(!input||!ID.test(input.key)||!text(input.label)||!['string','secret','number','boolean','select'].includes(input.type))throw Error('Invalid native setting field');
 const result={key:input.key,label:input.label,type:input.type};
 if(input.description!==undefined){if(!text(input.description,1000))throw Error('Invalid setting description');result.description=input.description;}
 if(input.type==='select'){
  if(!Array.isArray(input.options)||!input.options.length||input.options.length>100||input.options.some(o=>!text(o.label)||!text(o.value)))throw Error('Invalid native setting options');
  result.options=input.options.map(({label,value})=>({label,value}));
  if(new Set(result.options.map(option=>option.value)).size!==result.options.length)throw Error('Duplicate native setting option');
  if(input.default===undefined)result.default=result.options[0].value;
 }
 if(input.type==='number')for(const key of ['min','max','step'])if(input[key]!==undefined){if(!Number.isFinite(input[key])||key==='step'&&input[key]<=0)throw Error('Invalid setting range');result[key]=input[key];}
 if(result.min!==undefined&&result.max!==undefined&&result.min>result.max)throw Error('Invalid setting range');
 if(input.type==='secret'&&input.default!==undefined)throw Error('Secret settings cannot have plaintext defaults');
 if(input.default!==undefined)result.default=validateValue(result,input.default);
 return result;
}
function validateValue(field,value){
 if(field.type==='boolean'){if(typeof value!=='boolean')throw Error('Setting requires a boolean');}
 else if(field.type==='number'){if(!Number.isFinite(value)||field.min!==undefined&&value<field.min||field.max!==undefined&&value>field.max)throw Error('Setting is outside its range');if(field.step!==undefined){const steps=(value-(field.min??0))/field.step;if(Math.abs(steps-Math.round(steps))>Math.min(1e-7,Number.EPSILON*Math.max(1,Math.abs(steps))*8))throw Error('Setting does not match its step');}}
 else if(typeof value!=='string'||value.length>4096||value.includes('\0')||field.type==='select'&&!field.options.some(o=>o.value===value))throw Error('Invalid setting value');
 return value;
}
function actionOptions(input){
 const result={enabled:input.enabled===undefined?true:input.enabled,order:input.order===undefined?100:input.order,disabledReason:input.disabledReason===undefined?'':input.disabledReason,icon:input.icon??null};
 if(typeof result.enabled!=='boolean'||!Number.isFinite(result.order)||Math.abs(result.order)>10000||typeof result.disabledReason!=='string'||result.disabledReason.length>1000||/[\u0000-\u001f]/.test(result.disabledReason))throw Error('Invalid native action state');
 if(result.icon!==null){const icon=result.icon;if(!icon||Object.keys(icon).some(key=>!['paths','fill'].includes(key))||!Array.isArray(icon.paths)||!icon.paths.length||icon.paths.length>8||Array.from(icon.paths).some(path=>typeof path!=='string'||!path.trim()||path.length>512||! /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(path))||icon.fill!==undefined&&!['none','currentColor'].includes(icon.fill))throw Error('Action icons require bounded SVG paths in a 24 by 24 view box');result.icon={paths:[...icon.paths],fill:icon.fill??'none'};}
 return result;
}
class ExtensionUi {
 constructor(runtime){this.runtime=runtime;this.entries=new Map();this.observers=new Set();this.onChanged=()=>{};}
 live(entry){return this.runtime.active.get(entry.job.key)===entry.job&&['activating','running'].includes(entry.job.state);}
 register(job,kind,input){
  if(!input||!ID.test(input.id)||!text(input.title))throw Error('UI contributions need an id and title');
  const id=job.manifest.id+'.'+input.id,key=kind+':'+id;if(this.entries.has(key))throw Error('UI contribution already registered');
  let data={id,title:input.title,kind,extensionName:job.manifest.name||job.manifest.id,extensionId:job.manifest.id,key:job.key,generation:job.generation};
  if(kind==='shortcut'){
   const binding=require('../../shared/pluginShortcuts.cjs').shortcut(input);if([...this.entries.values()].filter(entry=>entry.job===job&&entry.data.kind==='shortcut').length>=64)throw Error('Use at most 64 runtime shortcuts');
   data={...data,command:job.manifest.id+'.'+binding.command,keys:binding.keys,scope:binding.scope,location:'shortcuts'};
  }else if(kind==='view'){
   if(typeof input.entry!=='string'||input.entry.length>240||! /^(dist|assets)\/[a-zA-Z0-9_./-]+\.html$/.test(input.entry)||input.entry.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid extension view entry');
   if([...this.entries.values()].filter(entry=>entry.job===job&&entry.data.kind==='view').length>=8)throw Error('Use at most eight views per extension');
   data={...data,entry:input.entry,location:'views'};
  }else if(kind==='integration'){
   if(!['ai.engines','voice.engines'].includes(input.point)||!ID.test(input.service))throw Error('Unsupported UI integration point or service');
   if(input.order!==undefined&&(!Number.isFinite(input.order)||input.order<0||input.order>1000))throw Error('Invalid UI integration order');
   if(input.aliases!==undefined){if(!Array.isArray(input.aliases)||input.aliases.length>10||input.aliases.some(id=>!ID.test(id)))throw Error('Invalid integration aliases');data.aliases=[...input.aliases];}
   Object.assign(data,{point:input.point,service:job.manifest.id+'.'+input.service,order:input.order??100});
  }else if(kind==='inspector'){
   if([...this.entries.values()].filter(entry=>entry.job===job&&entry.data.kind==='inspector').length>=8)throw Error('Use at most eight inspector groups per extension');
   data={...data,location:'inspector',fields:input.fields,lanes:input.lanes,order:input.order??100,instance:randomUUID()};
  }else{
   if(!LOCATIONS.has(input.location)||kind==='settings'&&!input.location.startsWith('settings.'))throw Error('Unsupported native UI location');
   data.location=input.location;
   if(kind==='settings'){
    if(!Array.isArray(input.fields)||input.fields.length>32)throw Error('Use at most 32 native setting fields');
    if(input.validate!==undefined){if(!ID.test(input.validate))throw Error('Invalid settings validation command');data.validate=job.manifest.id+'.'+input.validate;}
    data.fields=input.fields.map(field);if(new Set(data.fields.map(f=>f.key)).size!==data.fields.length)throw Error('Duplicate setting key');
   }else if(kind==='action'){
    if(!ID.test(input.command))throw Error('Invalid action command');data.command=job.manifest.id+'.'+input.command;data.instance=randomUUID();Object.assign(data,actionOptions(input));
   }else throw Error('Unsupported native UI contribution');
  }
  this.entries.set(key,{job,data});this.changed();return {id,...(data.instance?{instance:data.instance}:{})};
 }
 remove(job,kind,local){const key=kind+':'+job.manifest.id+'.'+local;if(this.entries.get(key)?.job===job){this.entries.delete(key);if(kind==='view')this.runtime.views?.close(job.manifest.id+'.'+local);this.changed();}return true;}
 stopped(job){for(const [key,value] of this.entries)if(value.job===job)this.entries.delete(key);this.changed();}
 observe(listener){this.observers.add(listener);return()=>this.observers.delete(listener);}
 changed(){const list=this.list();this.onChanged(list);for(const listener of this.observers)try{listener(list);}catch{}}
 list(){return [...this.entries.values()].filter(entry=>this.live(entry)).map(entry=>entry.data).sort((a,b)=>(a.order??100)-(b.order??100));}
 // The default a registered settings field declares, so the extension reads what the form shows.
 defaultValue(job,key){for(const entry of this.entries.values())if(entry.job===job&&entry.data.kind==='settings'){const field=entry.data.fields.find(f=>f.key===key&&f.type!=='secret');if(field&&field.default!==undefined)return field.default;}return undefined;}
 async shortcuts(){
  const rows=await (this.runtime.manager.extensionRows?.()||this.runtime.manager.list()),trust=await this.runtime.trustData(),catalog=new Map(),available=new Set();
  for(const row of rows.filter(row=>row.manifest?.main)){
   const job=this.runtime.active.get(row.key),reason=!row.enabled?'disabled':!trust[row.key]?'untrusted':this.runtime.suspended.has(row.key)||job?.state==='stopping'?'stopped':null;
   if(!reason)available.add(row.key);
   for(const input of row.manifest.contributes.shortcuts||[]){const id=row.manifest.id+'.'+input.id;catalog.set(id,{id:'extension:'+id,key:row.key,extensionId:row.manifest.id,extensionName:row.manifest.name,title:input.name,command:row.manifest.id+'.'+input.command,keys:input.keys,scope:input.scope,enabled:!reason,reason});}
  }
  for(const {job,data} of this.entries.values())if(data.kind==='shortcut'&&available.has(job.key)&&job.state==='running'&&this.live({job}))catalog.set(data.id,{...data,id:'extension:'+data.id,extensionName:job.manifest.name,enabled:true,reason:null});
  if(catalog.size>1024)throw Error('Extension shortcut catalog exceeds 1024 bindings');
  return [...catalog.values()].sort((a,b)=>a.extensionId.localeCompare(b.extensionId)||a.id.localeCompare(b.id));
 }
 async executeShortcut(id){
  const entry=(await this.shortcuts()).find(entry=>entry.id===id&&entry.enabled);if(!entry)throw Error('Extension shortcut is unavailable');
  if(!await this.runtime.start(entry.key,{automatic:true}))throw Error('Extension shortcut stopped');
  const current=(await this.shortcuts()).find(current=>current.id===id&&current.enabled&&current.key===entry.key&&current.command===entry.command);
  if(!current||this.runtime.active.get(entry.key)?.state!=='running')throw Error('Extension shortcut changed or stopped');
  return this.runtime.execute(current.command,{});
 }
 entry(kind,id,job){const entry=this.entries.get(kind+':'+id);if(!entry||!this.live(entry)||job&&entry.job!==job)throw Error('UI contribution is unavailable');return entry;}
 async settings(id){
  const {job,data}=this.entry('settings',id),values={};
  for(const f of data.fields){const value=await this.runtime.storage(job,f.type==='secret'?'secrets.get':'configuration.get',f.key);values[f.key]=f.type==='secret'?{saved:!!value}:value??f.default??(f.type==='boolean'?false:f.type==='number'?0:'');}
  this.entry('settings',id,job);return values;
 }
 async update(id,key,value){
  const {job,data}=this.entry('settings',id),f=data.fields.find(f=>f.key===key);if(!f)throw Error('Unknown setting field');validateValue(f,value);
  job.nativeSettingsPending=(job.nativeSettingsPending||0)+1;job.nativeSettingsRevision=(job.nativeSettingsRevision||0)+1;this.changed();
  try{
   if(data.validate){const result=await this.runtime.execute(data.validate,{key,value});this.entry('settings',id,job);if(result&&Object.hasOwn(result,'value'))value=validateValue(f,result.value);}
   await this.runtime.storage(job,f.type==='secret'?(value===''?'secrets.delete':'secrets.store'):'configuration.update',{key,value},undefined,'user');return true;
  }finally{job.nativeSettingsPending--;job.nativeSettingsRevision++;this.changed();}
 }

 async registerInspector(job,input){
  if(!input||!Array.isArray(input.fields)||!input.fields.length||input.fields.length>32)throw Error('Use 1 to 32 inspector fields');
  if(Object.keys(input).some(key=>!['id','title','fields','lanes','order'].includes(key)))throw Error('Invalid inspector registration');
  const {inspectorField}=await import('../../shared/extensionInspector.mjs'),fields=Array.from(input.fields,inspectorField);
  if(new Set(fields.map(field=>field.key)).size!==fields.length)throw Error('Duplicate inspector field key');
  const lanes=input.lanes??['video','overlay','audio','text'];if(!Array.isArray(lanes)||!lanes.length||Array.from(lanes).some(lane=>!['video','overlay','audio','text'].includes(lane))||new Set(lanes).size!==lanes.length)throw Error('Invalid inspector lanes');
  if(input.order!==undefined&&(!Number.isFinite(input.order)||Math.abs(input.order)>10000))throw Error('Invalid inspector order');
  if(this.runtime.active.get(job.key)!==job||!['running','activating'].includes(job.state))throw Error('Extension stopped while registering inspector');
  return this.register(job,'inspector',{...input,fields,lanes:[...lanes]});
 }
 updateAction(job,input){const entry=this.entry('action',job.manifest.id+'.'+input?.id,job);if(entry.data.instance!==input?.instance)throw Error('Action registration changed');if(!input||Object.keys(input).some(key=>!['id','instance','title','enabled','disabledReason','order','icon'].includes(key)))throw Error('Invalid action update');const supplied=Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined)),patch=actionOptions({...entry.data,...supplied});if(input.title!==undefined){if(!text(input.title))throw Error('Invalid action title');patch.title=input.title;}entry.data={...entry.data,...patch};this.changed();return true;}
 verifyInspector(job,guard){const entry=this.entries.get('inspector:'+guard?.id);return !!entry&&entry.job===job&&this.live(entry)&&entry.data.instance===guard.instance;}
 async inspectorSet(id,input){
  const entry=this.entry('inspector',id),{job,data}=entry;
  if(!input||Object.keys(input).some(key=>!['field','value','token'].includes(key))||typeof input.token!=='string'||!/^[a-f0-9-]{36}$/.test(input.token))throw Error('Invalid inspector write');
  const field=data.fields.find(field=>field.key===input.field);if(!field)throw Error('Unknown inspector field');
  const {inspectorValue}=await import('../../shared/extensionInspector.mjs');inspectorValue(field,input.value);
  if(this.entry('inspector',id)!==entry)throw Error('Inspector registration changed');
  return this.runtime.invoke({key:job.key,generation:job.generation,extensionId:job.manifest.id,method:'ui.inspectorSet',args:{...input,field,lanes:data.lanes},inspector:{id,instance:data.instance}});
 }
 async execute(id,input={},instance){const entry=this.entry('action',id);if(instance!==undefined&&instance!==entry.data.instance)throw Error('Action registration changed');if(!entry.data.enabled)throw Error(entry.data.disabledReason||'Extension action is disabled');return this.runtime.execute(entry.data.command,input);}

}
module.exports={ExtensionUi,validateValue};
