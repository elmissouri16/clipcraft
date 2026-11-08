#!/usr/bin/env node
// Native app-server protocol fixture; no model API calls or external service.
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('codex-cli 0.166.0');process.exit(0);}
if(process.argv.includes('login')){console.log('Logged in using ChatGPT');process.exit(0);}
let buffer='',turn=0,nextId=1000,active=null;
const pending=new Map(),send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const log=value=>{if(process.env.FVE_NATIVE_FIXTURE_LOG)fs.appendFileSync(process.env.FVE_NATIVE_FIXTURE_LOG,JSON.stringify(value)+'\n');};
function call(name,args){const id=nextId++;pending.set(id,name);const request={id,method:'item/tool/call',params:{threadId:'native-thread',turnId:`turn-${turn}`,callId:`call-${id}`,tool:name,arguments:args}};send(request);if(name==='add_text')send({...request,id:`duplicate-${id}`});}
function complete(){send({method:'item/completed',params:{threadId:'native-thread',item:{type:'agentMessage',text:'Native tools completed the edit.'}}});send({method:'turn/completed',params:{threadId:'native-thread',turn:{id:`turn-${turn}`,status:'completed'}}});}
process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}
 if(m.method){log({method:m.method,threadId:m.params?.threadId,...(m.method==='turn/start'?{inputTypes:m.params.input?.map(input=>input.type)}:{})});
  if(m.method==='initialize')send({id:m.id,result:{userAgent:'native-fixture'}});
  else if(m.method==='model/list')send({id:m.id,result:{data:m.params.cursor?[{model:'gpt-6-luna',displayName:'GPT-6 Luna',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'max'}],defaultReasoningEffort:'high',inputModalities:['text','image']}]:[{model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'},{reasoningEffort:'ultra'}],defaultReasoningEffort:'low'},{model:'hidden-test',hidden:true}],nextCursor:m.params.cursor?null:'page-two'}});
  else if(m.method==='thread/start'){if(!m.params.dynamicTools?.every(tool=>tool.type==='function')){send({id:m.id,error:{message:'No native dynamic tools'}});continue;}log({tools:m.params.dynamicTools.map(t=>t.name),hasOutputSchema:!!m.params.outputSchema,webSearch:m.params.config?.web_search});send({id:m.id,result:{thread:{id:'native-thread'}}});}
  else if(m.method==='turn/start'){turn++;active=m.params.input?.[0]?.text||'';send({id:m.id,result:{turn:{id:`turn-${turn}`,status:'inProgress'}}});if(turn>1)send({id:'stale-callback',method:'item/tool/call',params:{threadId:'native-thread',turnId:`turn-${turn-1}`,tool:'add_text',arguments:{text:'STALE EDIT',start_sec:0,duration_sec:1}}});setImmediate(()=>call('get_project',{}));}
  else if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId:'native-thread',turn:{id:`turn-${turn}`,status:'interrupted'}}});}
 }else if(String(m.id).startsWith('duplicate-')){log({duplicateCallbackCompleted:!!m.result?.success});}else if(m.id==='stale-callback'){log({staleCallbackRejected:!!m.error});}else if(pending.has(m.id)){const name=pending.get(m.id);pending.delete(m.id);const raw=m.result?.contentItems?.find(item=>item.type==='inputText')?.text;let result;try{result=JSON.parse(raw);}catch{result={error:raw};}log({toolResult:name,success:m.result?.success,imageCount:m.result?.contentItems?.filter(item=>item.type==='inputImage').length||0});
  if(name==='get_project'){if(/make no changes/i.test(active))call('complete_edit',{});else call(active.includes('CANCEL_NATIVE')?'add_voiceover':'add_text',active.includes('CANCEL_NATIVE')?{text:'Cancel this voice',engine:'gemini'}:{text:active.includes('NATIVE CHECK')?'NATIVE CHECK':`Native title ${turn}`,start_sec:8,duration_sec:1});}
  else if(name==='add_text')call('inspect_frames',{times_sec:[0]});
  else if(name==='inspect_frames'||name==='add_voiceover')call('complete_edit',{});
  else if(name==='complete_edit'){if(result.ready)complete();else if(result.error){send({method:'turn/completed',params:{threadId:'native-thread',turn:{id:`turn-${turn}`,status:'failed',error:{message:result.error}}}});}else call('complete_edit',{});}
 }
}});
