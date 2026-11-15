// Declarative service metadata only. No URLs, headers or credentials supplied by plugin code.
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!record(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Invalid AI provider fields.');};
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export const isPluginProvider=id=>typeof id==='string'&&id.startsWith('plugin-provider:');
export const pluginProviderId=(pluginId,id,digest)=>`plugin-provider:${pluginId}/${id}@${digest}`;
export function providerEndpoint(value){
 if(!text(value,2048))throw Error('Invalid AI provider endpoint.');
 let url;try{url=new URL(value);}catch{throw Error('Invalid AI provider endpoint.');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw Error('AI providers require HTTPS, or HTTP on localhost only.');
 if(url.username||url.password||url.search||url.hash||/[%?#\\]/.test(value)||!/^\/[a-zA-Z0-9._~/-]*$/.test(url.pathname))throw Error('AI provider endpoints cannot include credentials, query strings or encoded paths.');
 return url.href.replace(/\/+$/,'');
}
export function validateProvider(value){
 keys(value,['id','name','description','protocol','baseUrl','needsKey','models','defaultModel']);
 if(typeof value.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)||!text(value.name,160)||(value.description!==undefined&&!text(value.description,1000))||value.protocol!=='openai'||typeof value.needsKey!=='boolean')throw Error('Invalid AI provider identity or protocol.');
 if(!Array.isArray(value.models)||!value.models.length||value.models.length>32)throw Error('AI providers declare 1–32 models.');
 const ids=new Set(),models=value.models.map(m=>{
  keys(m,['id','name','vision']);
  if(!text(m.id,160)||!/^[-a-zA-Z0-9._:/]+$/.test(m.id)||ids.has(m.id)||!text(m.name,160)||typeof m.vision!=='boolean')throw Error('Invalid AI provider model.');
  ids.add(m.id);return {id:m.id,name:m.name,vision:m.vision};
 });
 if(!ids.has(value.defaultModel))throw Error('AI provider default model must be declared.');
 return {id:value.id,name:value.name,description:value.description||'',protocol:'openai',baseUrl:providerEndpoint(value.baseUrl),needsKey:value.needsKey,models,defaultModel:value.defaultModel};
}
