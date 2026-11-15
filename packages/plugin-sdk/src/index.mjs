import {validateManifest} from '../../../shared/pluginManifest.mjs';
export const SDK_VERSION='0.7.0';
export const HOST_API_VERSION=1;
export class PluginError extends Error{
 constructor(code,message,options){super(message,options);this.name='PluginError';this.code=code;}
}
const fail=(code,message)=>{throw new PluginError(code,message);};
export function definePlugin(manifest){try{validateManifest(manifest);return structuredClone(manifest);}catch(error){throw new PluginError('MANIFEST_INVALID',error.message,{cause:error});}}
export function defineCommand(handler){
 if(typeof handler==='function')return handler;
 if(!handler||typeof handler!=='object'||Array.isArray(handler)||!Object.keys(handler).length||Object.entries(handler).some(([id,fn])=>!/^[a-z][a-z0-9-]{0,63}$/.test(id)||typeof fn!=='function'))fail('INVALID_ARGUMENT','Define a command function or a nonempty map of command functions.');
 const routes=Object.freeze({...handler});
 return (context,input)=>{const id=context?.command?.id;if(!Object.hasOwn(routes,id))fail('UNKNOWN_COMMAND',`No handler for command ${String(id).slice(0,64)}.`);return routes[id](context,input);};
}
export async function connectPanel({host=globalThis.clipcraftPanel,signal}={}){
 if(signal?.aborted)fail('DISPOSED','Panel client was disposed.');
 if(!host||typeof host.getInfo!=='function')fail('HOST_UNAVAILABLE','Open this document as an approved ClipCraft plugin panel.');
 const invoke=async fn=>{try{return await fn();}catch(error){if(error instanceof PluginError)throw error;throw new PluginError('HOST_REJECTED',String(error?.message||'The host rejected this operation.'),{cause:error});}};
 const info=await invoke(()=>host.getInfo());
 if(info?.apiVersion!==HOST_API_VERSION||!Array.isArray(info.permissions)||!Array.isArray(info.commands))fail('API_MISMATCH','This SDK requires the ClipCraft panel API 1 contract.');
 if(signal?.aborted)fail('DISPOSED','Panel client was disposed.');
 let disposed=false,running=false;const subscriptions=new Set();
 const live=()=>{if(disposed)fail('DISPOSED','Panel client was disposed.');};
 const grant=permission=>{live();if(!info.permissions.includes(permission))fail('PERMISSION_DENIED',`Declare the ${permission} panel permission.`);};
 const call=(fn,permission)=>{try{permission?grant(permission):live();}catch(error){return Promise.reject(error);}return invoke(fn).then(value=>{live();return value;});};
 const subscribe=(owner,method,callback,permission,owned=false)=>{
  permission?grant(permission):live();if(typeof callback!=='function')fail('INVALID_ARGUMENT','A subscription needs a function.');
  let off;try{off=owner[method](value=>{if(!disposed&&(!owned||running))callback(value);});}catch(error){throw new PluginError('HOST_REJECTED',String(error.message),{cause:error});}
  const unsubscribe=()=>{if(subscriptions.delete(unsubscribe))off();};subscriptions.add(unsubscribe);return unsubscribe;
 };
 const dispose=()=>{if(disposed)return;disposed=true;for(const off of [...subscriptions]){try{off();}catch{}};signal?.removeEventListener('abort',dispose);if(running)Promise.resolve().then(()=>host.commands.cancel()).catch(()=>{});};
 signal?.addEventListener('abort',dispose,{once:true});
 if(disposed)fail('DISPOSED','Panel client was disposed.');
 const editorHost=()=>{if(!host.editor||typeof host.editor.read!=='function'||typeof host.editor.onChanged!=='function')fail('API_MISMATCH','This host does not support the optional editor context API.');return host.editor;};
 const client={
  info:Object.freeze(structuredClone(info)),
  supports:permission=>{live();return info.permissions.includes(permission)&&(permission!=='editor.read'||(typeof host.editor?.read==='function'&&typeof host.editor?.onChanged==='function'));},
  editor:{read:()=>call(()=>editorHost().read(),'editor.read'),onChanged:callback=>{grant('editor.read');return subscribe(editorHost(),'onChanged',callback,'editor.read');}},
  project:{read:()=>call(()=>host.project.read(),'project.read'),onChanged:callback=>subscribe(host.project,'onChanged',callback,'project.read')},
  theme:{onChanged:callback=>subscribe(host.theme,'onChanged',callback)},
  storage:Object.fromEntries(['get','set','remove','keys','clear'].map(method=>[method,(...args)=>call(()=>host.storage[method](...args),'storage.local')])),
  commands:{
   run:(id,input={})=>{
    try{live();if(!info.commands.some(command=>command.id===id))fail('UNKNOWN_COMMAND','This panel did not declare that command.');if(running)fail('BUSY','This client already has a running command.');}catch(error){return Promise.reject(error);}
    running=true;return call(()=>host.commands.run(id,input)).finally(()=>{running=false;});
   },
   cancel:()=>call(()=>host.commands.cancel()),onProgress:callback=>subscribe(host.commands,'onProgress',callback,undefined,true),
  },
  dispose,
 };
 return Object.freeze(client);
}
