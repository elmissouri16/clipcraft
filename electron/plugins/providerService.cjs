const presets=require('../agents/providers.cjs');
const stopped=()=>Object.assign(Error('Plugin provider request stopped or became unavailable.'),{name:'AbortError'});
function createProviderService({manager,settings,dialog,getWindow,watchMs=300}){
 const active=new Set();let revision=0;
 const service={
  async refresh(){
   await manager.ready;
   const {pluginProviderId}=await import('../../shared/pluginProviders.mjs');
   const rows=await manager.providers();
   presets.setPluginProviders(rows.map(row=>({...row,id:pluginProviderId(row.pluginId,row.id,row.digest),localId:row.id,short:row.name,plugin:true})));
   return presets.all();
  },
  async verify(id){
   const row=presets.byId(id);if(!row?.plugin)throw Error('This plugin provider is unavailable. Enable its exact installed version in Settings.');
   const inventory=await manager.inventory();if(!inventory.some(r=>r.key===row.digest&&r.enabled))throw Error('This plugin provider version is disabled or removed.');
   await manager.read(row.digest);return row;
  },
  revoke(){revision++;for(const controller of active)controller.abort();},
  async ensure(id){
   if(!presets.isPlugin(id))return;
   await service.refresh();const row=await service.verify(id),captured=revision;
   if(settings.pluginProviderApproved(id))return row;
   const i18n=require('../system/i18n.cjs');
   const answer=await dialog.showMessageBox(getWindow(),{type:'question',title:i18n.t('plugins.provider_consent_title'),message:row.name,buttons:[i18n.t('plugins.provider_allow'),i18n.t('app.cancel')],defaultId:1,cancelId:1,noLink:true,
    detail:i18n.t('plugins.provider_consent_detail',{publisher:row.publisher,version:row.version,endpoint:row.baseUrl,images:row.models.some(m=>m.vision)?i18n.t('plugins.provider_images_allowed'):i18n.t('plugins.provider_images_blocked')})});
   if(answer.response!==0)throw Error(i18n.t('plugins.provider_consent_denied'));
   if(captured!==revision)throw Error('Plugin inventory changed while permission was pending. Select the provider again.');
   await service.verify(id);settings.approvePluginProvider(id);return row;
  },
  async run(cfg,signal,callback){
   const row=await service.verify(cfg.provider);
   if(!settings.pluginProviderApproved(cfg.provider))throw Error('Approve this plugin provider in Settings before using it.');
   if((cfg.baseUrl||row.baseUrl)!==row.baseUrl||!row.models.some(m=>m.id===cfg.model)||cfg.reasoningEffort)throw Error('The plugin provider endpoint, model or capabilities changed. Select a declared model in Settings.');
   if(row.needsKey&&!cfg.apiKey)throw Error('Add a key for this plugin provider in Settings.');
   const controller=new AbortController(),abort=()=>controller.abort();active.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   let checking=false;
   const verify=async()=>{if(controller.signal.aborted)throw stopped();await service.verify(cfg.provider);if(controller.signal.aborted)throw stopped();};
   const timer=setInterval(async()=>{if(checking)return;checking=true;try{await verify();}catch{controller.abort();}finally{checking=false;}},watchMs);
   try{
    await verify();
    const value=await callback({...cfg,baseUrl:row.baseUrl,webResearch:false,allowEndpointFallback:false},controller.signal,verify);
    await verify();return value;
   }finally{clearInterval(timer);signal?.removeEventListener('abort',abort);active.delete(controller);}
  },
 };
 return service;
}
module.exports={createProviderService};
