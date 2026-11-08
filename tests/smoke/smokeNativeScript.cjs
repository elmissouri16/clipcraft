// Compatibility for existing scripted SDK smoke tests. It translates their
// mocked model steps into native host callbacks; production never uses this.
const fs=require('node:fs'),path=require('node:path');
module.exports=function installNativeSmokeScript(dir){
 const local=require("../../electron/agents/localAgents.cjs"),ai=require("../../electron/agents/ai.cjs");
 local.runEditorNative=async(cfg,opts)=>{
  const contents=structuredClone(opts.history||[]);contents.push({role:'user',parts:[{text:opts.prompt}]});
  let images=[],serial=0;
  const capture=result=>{
   const next=[];let label='Inspected frame';
   for(const block of result.content||[]){
    if(block.type==='text'){label=block.text;continue;}
    if(block.type==='image'){const file=path.join(dir,`native-script-frame-${serial++}.jpg`);fs.writeFileSync(file,Buffer.from(block.data,'base64'));next.push({path:file,label});}
   }
   images=[...next,...images].slice(0,6);
  };
  const invoke=async(name,args)=>{
   const response=await opts.onTool(name,args);const result=JSON.parse(response.content[0].text);
   if(result.changed)images=[];capture(response);return result;
  };
  for(let step=0;step<45;step++){
   if(opts.signal.aborted)throw Object.assign(new Error('Stopped.'),{name:'AbortError'});
   const res=await ai.agentStep(cfg,{system:opts.system,contents,tools:opts.tools,images,signal:opts.signal,onSearch:opts.onSearch});
   if(res.content)contents.push(res.content);
   if(!res.calls.length){
    const result=await invoke('complete_edit',{});
    if(result.error)throw new Error(result.error);
    if(result.ready&&await opts.isComplete())return {text:res.text};
    contents.push({role:'user',parts:[{functionResponse:{name:'inspect_frames',response:{result}}}]});continue;
   }
   const parts=[];
   for(let index=0;index<res.calls.length;){
    const call=res.calls[index];let group=[call];
    if(call.name==='generate_image')while(res.calls[index+group.length]?.name==='generate_image'&&group.length<12)group.push(res.calls[index+group.length]);
    if(group.length>1){const batch=await invoke('generate_images',{scenes:group.map(call=>call.args)});group.forEach((call,i)=>parts.push({functionResponse:{name:call.name,response:{result:batch.results[i]}}}));}
    else parts.push({functionResponse:{name:call.name,response:{result:await invoke(call.name,call.args)}}});
    index+=group.length;
   }
   contents.push({role:'user',parts});
  }
  throw new Error('Scripted native smoke exceeded its step limit.');
 };
};
