import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
type Turn={role:string;parts?:{text?:string;thought?:boolean;functionCall?:{name:string;args:unknown};functionResponse?:{response:unknown}}[]};
type Input={model:string;system:string;contents:Turn[];tools:{name:string;description:string;parameters:unknown}[];maxTokens:number;timeoutMs:number};
function schema(value:unknown):unknown{if(Array.isArray(value))return value.map(schema);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='type'&&typeof item==='string'?item.toLowerCase():schema(item)]));}
function messages(system:string,turns:Turn[]){
 const rows:unknown[]=system?[{role:'system',content:system}]:[];let previous:string[]=[];
 for(const [index,turn] of turns.entries()){
  const parts=turn.parts??[],content=parts.filter(part=>typeof part.text==='string'&&!part.thought).map(part=>part.text).join('');
  if(turn.role==='model'){
   const calls=parts.flatMap(part=>part.functionCall?[part.functionCall]:[]);previous=calls.map((_,offset)=>'c'+String(index).padStart(5,'0')+String(offset).padStart(3,'0'));
   rows.push({role:'assistant',content:content||(calls.length?null:''),...(calls.length?{tool_calls:calls.map((call,offset)=>({id:previous[offset],type:'function',function:{name:call.name,arguments:JSON.stringify(call.args??{})}}))}:{})});
  }else{
   const replies=parts.flatMap(part=>part.functionResponse?[part.functionResponse]:[]);for(const [offset,reply] of replies.entries())rows.push({role:'tool',tool_call_id:previous[offset]||'c'+String(index).padStart(5,'0')+String(offset).padStart(3,'0'),content:JSON.stringify(reply.response??{})});
   if(content||!replies.length)rows.push({role:'user',content});
  }
 }
 return rows;
}
export async function activate(c:ExtensionContext){
 await c.ui.registerSettings({id:'connection',title:'Local AI connection',location:'settings.plugins',fields:[{key:'baseUrl',label:'OpenAI-compatible base address',type:'string',default:'http://localhost:11434/v1'},{key:'model',label:'Installed model ID',type:'string',default:'qwen2.5:7b'},{key:'apiKey',label:'Optional API key',type:'secret'}]});
 const configuredModel=async()=>{const model=await c.configuration.get<string>('model')??'qwen2.5:7b';if(!model.trim()||model.length>200||/[\u0000-\u001f]/.test(model))throw Error('Choose a valid installed model ID.');return model;};
 async function generate(input:Input,{signal}:{signal:AbortSignal}){
  const model=await configuredModel();if(input.model!==model)throw Error('The selected model changed. Refresh CraftAI settings.');
  const base=new URL(await c.configuration.get<string>('baseUrl')??'http://localhost:11434/v1');if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('Choose an HTTP(S) base address without embedded credentials, query or fragment.');
  const key=await c.secrets.get('apiKey'),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),timer=setTimeout(()=>controller.abort(),input.timeoutMs);let response:Response|undefined;
  try{
   response=await fetch(base.href.replace(/\/+$/,'')+'/chat/completions',{method:'POST',redirect:'manual',signal:combined,headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})},body:JSON.stringify({model,stream:false,max_tokens:input.maxTokens,messages:messages(input.system,input.contents),...(input.tools.length?{tools:input.tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:schema(tool.parameters)}})),tool_choice:'auto'}:{})})});
   if(!response.ok)throw Error('Local AI returned HTTP '+response.status+'. Check the connection and installed model.');
   if(!response.body)throw Error('Local AI returned no response.');let bytes=0;const chunks:Uint8Array[]=[];const reader=response.body.getReader();
   try{while(true){const step=await reader.read();if(step.done)break;bytes+=step.value.length;if(bytes>1024*1024)throw Error('Local AI response exceeds 1 MiB.');chunks.push(step.value);}}finally{await reader.cancel().catch(()=>{});}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),choice=data.choices?.[0];if(!choice||choice.finish_reason==='length')throw Error('Local AI returned a missing or truncated answer.');
   const message=choice.message;if(!message||message.content!==null&&message.content!==undefined&&typeof message.content!=='string'||message.tool_calls!==undefined&&!Array.isArray(message.tool_calls))throw Error('Local AI returned an invalid message.');
   const calls=(message.tool_calls??[]).map((call:{function?:{name:string;arguments?:string}})=>{if(!call.function||typeof call.function.name!=='string')throw Error('Local AI returned an invalid tool call.');const args=JSON.parse(call.function.arguments??'{}');if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Local AI returned invalid tool arguments.');return {name:call.function.name,args};});
   return {text:message.content??'',calls};
  }catch(error){if(combined.aborted)throw Error(signal.aborted?'Local AI request canceled.':'Local AI request timed out.');const message=error instanceof Error?error.message:'Local AI request failed.';throw Error(key?message.split(key).join('[redacted]'):message);}
  finally{clearTimeout(timer);await response?.body?.cancel().catch(()=>{});}
 }
 await c.services.register('chat',{models:async()=>{const model=await configuredModel();return {models:[{id:model,name:model,vision:false}],defaultModel:model,description:'A separately installed model served by the configured local OpenAI-compatible connection.'};},generate});
 await c.ui.registerIntegration({id:'craft-ai',title:'Local AI (extension)',point:'ai.engines',service:'chat'});
 await c.commands.register('test-connection',(_input,control)=>c.jobs.run('Test local AI',async job=>{const result=await generate({model:await configuredModel(),system:'',contents:[{role:'user',parts:[{text:'Reply with the single word: OK'}]}],tools:[],maxTokens:256,timeoutMs:30000},{signal:job.signal});if(result.calls.length)throw Error('A connection test must return text only.');return {message:'Local AI answered.',reply:result.text.slice(0,200)};},{signal:control.signal}));
}
