const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const safeKey=v=>typeof v==='string'&&/^[a-z][\w.-]{0,159}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
export function configurationValue(value){
 const ancestors=new Set();let nodes=0;
 const walk=(v,depth=0)=>{if(++nodes>8192||depth>32)throw Error('Configuration nesting or item limit exceeded');if(v===null||['string','boolean'].includes(typeof v))return;if(typeof v==='number'&&Number.isFinite(v))return;if(!v||typeof v!=='object'||!Array.isArray(v)&&!plain(v)||ancestors.has(v))throw Error('Configuration requires finite JSON data');ancestors.add(v);for(const item of Object.values(v))walk(item,depth+1);ancestors.delete(v);};
 walk(value);const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>65536)throw Error('Configuration value exceeds 64 KiB');return JSON.parse(text);
}
export function validateExtensionSettings(settings){
 if(settings===undefined)return;
 if(!plain(settings)||Object.keys(settings).length>128)throw Error('Invalid project extension settings');
 for(const [id,values]of Object.entries(settings)){if(!safeKey(id)||!plain(values)||Object.keys(values).length>256)throw Error('Invalid project extension settings namespace');for(const [key,value]of Object.entries(values)){if(!safeKey(key))throw Error('Invalid project configuration key');configurationValue(value);}}
 if(new TextEncoder().encode(JSON.stringify(settings)).length>1024*1024)throw Error('Project extension settings exceed 1 MiB');
}
export function projectConfiguration(project,documentId,extensionId,method,input){
 if(!plain(input)||Object.keys(input).some(key=>!['scope','documentId','key',...(method==='configuration.update'?['value']:[])].includes(key))||input.scope!=='project'||input.documentId!==documentId||!safeKey(input.key)||!safeKey(extensionId))throw Error('Project configuration context is stale or invalid');
 const settings=project.extensionSettings||{},bucket=Object.hasOwn(settings,extensionId)?settings[extensionId]:{},existing=Object.hasOwn(bucket,input.key)?bucket[input.key]:undefined;
 if(method==='configuration.get')return {value:existing===undefined?undefined:configurationValue(existing)};
 if(method!=='configuration.update')throw Error('Unsupported project configuration operation');
 const value=input.value===undefined?undefined:configurationValue(input.value);if(JSON.stringify(value)===JSON.stringify(existing))return {value:true};
 const next={...bucket};if(value===undefined)delete next[input.key];else next[input.key]=value;
 const all={...settings};if(Object.keys(next).length)all[extensionId]=next;else delete all[extensionId];validateExtensionSettings(all);
 return {value:true,action:{type:'setExtensionSettings',settings:all}};
}
