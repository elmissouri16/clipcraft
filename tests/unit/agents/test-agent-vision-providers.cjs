const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ai=require("../../../electron/agents/ai.cjs"),ff=require("../../../electron/media/ffmpeg.cjs"),{createLocalAgents}=require("../../../electron/agents/localAgents.cjs");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-vision-providers-')),file=path.join(dir,'frame.jpg');
execFileSync(ff.ffmpegPath,['-v','error','-f','lavfi','-i','color=red:s=80x80','-frames:v','1',file]);
const bytes=fs.readFileSync(file).toString('base64'),images=[{path:file,label:'Source frame at 2s; revision current'}];
const contents=[{role:'user',parts:[{text:'Inspect'}]},{role:'model',parts:[{functionCall:{name:'inspect_frames',args:{}}}]},{role:'user',parts:[{functionResponse:{name:'inspect_frames',response:{result:{frames:[{id:'handle'}]}}}}]}];
const original=JSON.stringify(contents),seen=[];let response;
const oldFetch=global.fetch;global.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);seen.push({url,body});return new Response(JSON.stringify(await response(String(url),body)));};
const req={system:'Inspect actual frames.',contents,tools:[],images};
(async()=>{try{
 for(const provider of ['openai','openrouter','groq','custom','ollama']){
  response=()=>({choices:[{message:{content:'Seen'}}]});await ai.agentStep({provider,model:'vision-model',apiKey:'test',...(provider==='custom'?{baseUrl:'https://example.test/v1'}:{})},req);
  const messages=seen.at(-1).body.messages;assert.equal(messages.at(-2).role,'tool');const image=messages.at(-1).content.find(p=>p.type==='image_url');assert.equal(image.image_url.url,`data:image/jpeg;base64,${bytes}`);assert.ok(!messages.at(-1).content.filter(p=>p.type==='text').some(p=>p.text.includes(bytes)));
 }
 response=()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Seen'}]}]});await ai.agentStep({provider:'openai',model:'gpt-6.1-sol',apiKey:'test'},req);assert.equal(seen.at(-1).body.input.at(-1).content.find(p=>p.type==='input_image').image_url,`data:image/jpeg;base64,${bytes}`);
 response=()=>({content:[{type:'text',text:'Seen'}]});await ai.agentStep({provider:'claude',model:'vision-model',apiKey:'test'},req);assert.equal(seen.at(-1).body.messages.at(-1).content.find(p=>p.type==='image').source.data,bytes);assert.equal(seen.at(-1).body.messages.at(-1).content[0].type,'tool_result');
 response=()=>({candidates:[{content:{role:'model',parts:[{text:'Seen'}]}}]});await ai.agentStep({provider:'gemini',model:'vision-model',apiKey:'test'},req);assert.equal(seen.at(-1).body.contents.at(-1).parts.find(p=>p.inlineData).inlineData.data,bytes);
 response=(url)=>url.endsWith('/api/show')?{thinking:{values:[true,false]}}:{message:{content:'Seen'}};await ai.agentStep({provider:'ollama',model:'binary-vision',reasoningEffort:'off'},req);assert.ok(seen.at(-1).url.endsWith('/api/chat'));assert.equal(seen.at(-1).body.messages.at(-1).images[0],bytes);assert.equal(typeof seen.at(-1).body.messages.at(-1).content,'string');
 let presented;const agents=createLocalAgents({loadSdk:async()=>({query:({prompt})=>({async *[Symbol.asyncIterator](){for await(const message of prompt)presented=message;yield {type:'result',subtype:'success',structured_output:{text:'Seen',calls:[]}};},close(){}})}),resolveExecutable:()=>'/fake/claude',env:process.env});
 await agents.agentStep({provider:'claude-agent-sdk'},req);assert.equal(presented.message.content.find(p=>p.type==='image').source.data,bytes);assert.ok(!presented.message.content.filter(p=>p.type==='text').some(p=>p.text.includes(bytes)));
 assert.equal(JSON.stringify(contents),original,'transient images never alter saved conversation');
 response=()=>({error:{message:'vision unsupported'}});await assert.rejects(ai.agentStep({provider:'openai',model:'vision-model',apiKey:'test'}, {...req,images:Array(7).fill(images[0])}),/six/);
 console.log('agent vision providers ok (all transports receive typed images; tool pairing and saved context preserved)');
}finally{global.fetch=oldFetch;fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
