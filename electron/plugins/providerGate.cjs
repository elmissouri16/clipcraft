const {AsyncLocalStorage}=require('node:async_hooks');
const providers=require('../agents/providers.cjs');
const scope=new AsyncLocalStorage();let service;
function configure(value){service=value;}
function guarded(fn){return async(cfg,options={},...rest)=>{
 if(!providers.isPlugin(cfg?.provider))return fn(cfg,options,...rest);
 if(!service)throw Error('Plugin provider support is unavailable. Restart ClipCraft.');
 return service.run(cfg,options.signal,(safe,signal,verify)=>scope.run({provider:safe.provider,baseUrl:safe.baseUrl,signal,verify},()=>fn(safe,{...options,signal},...rest)));
};}
module.exports={configure,guarded,current:()=>scope.getStore()};
