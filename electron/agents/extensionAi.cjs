// CraftAI consumes ordinary extension services at an application integration
// point. This module has no vendor transport, endpoint or credential handling.
const {copyPayload}=require('../plugins/extensionData.cjs');
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const isExtension=id=>typeof id==='string'&&id.startsWith('extension:');
const stopped=()=>Object.assign(Error('AI extension stopped or changed. Select an available extension in Plugins.'),{name:'AbortError'});
function models(value){
 if(!value||!Array.isArray(value.models)||value.models.length<1||value.models.length>100)throw Error('AI service must return one to 100 models.');
 const ids=new Set();const result=value.models.map(model=>{
  if(!model||!text(model.id,200)||!model.id.trim()||!text(model.name,200)||!model.name.trim()||ids.has(model.id))throw Error('AI service returned invalid or duplicate models.');ids.add(model.id);
  const efforts=model.reasoningEfforts??[];if(!Array.isArray(efforts)||efforts.length>12||efforts.some(effort=>!text(effort,80)||!effort)||new Set(efforts).size!==efforts.length)throw Error('AI service returned invalid thinking levels.');
  return {id:model.id,name:model.name,vision:model.vision===true,reasoningEfforts:[...efforts]};
 });
 const defaultModel=value.defaultModel??result[0].id;if(!ids.has(defaultModel))throw Error('AI service default model is absent from its catalog.');
 return {models:result,defaultModel,enabled:value.enabled!==false,description:text(value.description,1000)?value.description:''};
}
function answer(value,engine,model){
 const data=copyPayload(value,{label:'AI service response'}).value;
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!['text','calls','state'].includes(key))||typeof data.text!=='string'||!Array.isArray(data.calls)||data.calls.length>64)throw Error('AI service returned an invalid text/tool-call response.');
 const calls=data.calls.map(call=>{
  if(!call||!text(call.name,160)||!call.name||!call.args||typeof call.args!=='object'||Array.isArray(call.args)||Object.keys(call).some(key=>!['name','args'].includes(key)))throw Error('AI service returned an invalid tool call.');
  return {name:call.name,args:call.args};
 });
 const parts=[...(data.text?[{text:data.text}]:[]),...calls.map(call=>({functionCall:call}))];
 return {text:data.text,calls,content:{role:'model',parts:parts.length?parts:[{text:''}],...(data.state===undefined?{}:{extensionState:{engine,model,value:data.state}})}};
}
class ExtensionAi{
 constructor(manager){this.manager=manager;}
 async entries(){await this.manager.ready;await this.manager.extensions.activate('ui:ai.engines',{continueOnError:true});return this.manager.extensions.ui.list().filter(entry=>entry.kind==='integration'&&entry.point==='ai.engines');}
 verify(entry){const runtime=this.manager.extensions,record=runtime.services.get(entry.service);if(!record||runtime.active.get(entry.key)!==record.job||record.job.generation!==entry.generation||record.job.state!=='running'||!runtime.ui.list().some(current=>current.id===entry.id&&current.generation===entry.generation&&current.service===entry.service))throw stopped();return record.job;}
 async status(entry,signal,serviceScope){this.verify(entry);const value=models(await this.manager.extensions.callService(entry.service,'models',{}, {...serviceScope,signal,timeoutMs:25000}));this.verify(entry);if(signal?.aborted)throw stopped();return value;}
 async catalog(){
  if(this.refreshing)return this.refreshing;
  const task=(async()=>Promise.all((await this.entries()).map(async entry=>{
   const job=this.manager.extensions.active.get(entry.key),base={id:'extension:'+entry.service,name:entry.title,short:entry.title,plugin:true,extension:true,approved:true,needsKey:false,baseUrl:'',version:job?.manifest.version||'',extensionId:entry.extensionId,digest:entry.key};
   try{const status=await this.status(entry);return {...base,...status,unavailable:!status.enabled};}
   catch(error){return {...base,models:[],defaultModel:'',unavailable:true,description:String(error.message).slice(0,1000)};}
  })))().catch(error=>{if(error.code==='PLUGIN_INVENTORY_RECOVERY')return [];throw error;});this.refreshing=task;try{return await task;}finally{if(this.refreshing===task)this.refreshing=null;}
 }
 async selected(cfg,signal,serviceScope){
  if(signal?.aborted)throw stopped();const entry=(await this.entries()).find(entry=>'extension:'+entry.service===cfg.provider);if(!entry)throw Error('This AI extension is unavailable. Install, enable or trust it in Plugins.');
  const status=await this.status(entry,signal,serviceScope);if(!status.enabled)throw Error('This AI extension is disabled in its settings.');const model=status.models.find(model=>model.id===(cfg.model||status.defaultModel));if(!model)throw Error('Choose a model returned by this AI extension.');
  if(cfg.reasoningEffort&&!model.reasoningEfforts.includes(cfg.reasoningEffort))throw Error('This AI extension model does not support the selected thinking level.');return {entry,model,status};
 }
 async capabilities(cfg,{signal}={}){const {model}=await this.selected(cfg,signal);return {ok:true,model:model.id,reasoningEfforts:model.reasoningEfforts,vision:model.vision,source:'extension service'};}
 async listModels(cfg,{signal}={}){const entry=(await this.entries()).find(entry=>'extension:'+entry.service===cfg.provider);if(!entry)throw Error('This AI extension is unavailable.');const status=await this.status(entry,signal);if(!status.enabled)throw Error('This AI extension is disabled in its settings.');return {ok:true,models:status.models.map(model=>model.id),source:'extension service'};}
 async generate(cfg,{system='',contents=[],tools=[],maxTokens=2048,timeoutMs=90000,signal,serviceScope}){
  const {entry,model}=await this.selected(cfg,signal,serviceScope);if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>131072||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Choose bounded AI generation limits.');
  const input=copyPayload({model:model.id,system,contents,tools,maxTokens,timeoutMs,reasoningEffort:cfg.reasoningEffort||''},{label:'AI conversation',limit:32*1024*1024}).value;
  const hasImages=value=>value&&typeof value==='object'&&(value.inlineData||Object.values(value).some(hasImages));if(!model.vision&&hasImages(input.contents))throw Error('This AI extension model does not support images.');
  if(!Array.isArray(input.contents)||!Array.isArray(input.tools)||typeof input.system!=='string')throw Error('AI conversation must contain messages and tool declarations.');
  // Opaque extension state is returned only to the same engine/model. It never
  // becomes tool declarations, image data or a different service's continuation.
  for(const content of input.contents){if(!content||typeof content!=='object')throw Error('Invalid AI conversation turn.');if(content.extensionState&&(content.extensionState.engine!==cfg.provider||content.extensionState.model!==model.id))delete content.extensionState;}
  this.verify(entry);const value=await this.manager.extensions.callService(entry.service,'generate',input,{...serviceScope,signal,timeoutMs});this.verify(entry);if(signal?.aborted)throw stopped();return answer(value,cfg.provider,model.id);
 }
 async chat(cfg,{system='',messages,maxTokens=1024,timeoutMs=45000,signal,serviceScope}){if(!Array.isArray(messages))throw Error('AI chat needs messages.');const result=await this.generate(cfg,{system,contents:messages.map(message=>({role:message.role==='assistant'?'model':'user',parts:[{text:message.content}]})),tools:[],maxTokens,timeoutMs,signal,serviceScope});if(result.calls.length)throw Error('This text-only AI request returned tool calls.');return result.text;}
}
let configured;
module.exports={ExtensionAi,isExtension,models,answer,configure:value=>{configured=value;},get:()=>{if(!configured)throw Error('AI extension integration is unavailable.');return configured;}};
