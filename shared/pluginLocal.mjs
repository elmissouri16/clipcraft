// Curated host recipes only. No executable, path, URL or shell argument is public.
export const LOCAL_MODELS=['base','turbo','darija'];
export function localTools(value=[]){
 if(!Array.isArray(value)||value.length>4)throw Error('Invalid local tools.');
 const ids=new Set();return value.map(row=>{
  if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['id','name','adapter','models'].includes(k))||typeof row.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(row.id)||ids.has(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>100||/[\u0000-\u001f]/.test(row.name)||row.adapter!=='speech.whisper'||!Array.isArray(row.models)||!row.models.length||row.models.length>3||new Set(row.models).size!==row.models.length||row.models.some(model=>!LOCAL_MODELS.includes(model)))throw Error('Declare a unique speech.whisper tool with approved models.');
  ids.add(row.id);return {id:row.id,name:row.name,adapter:row.adapter,models:[...row.models]};
 });
}
export function localRecipe(input,tools){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['toolId','operation','model','start_sec','duration_sec','language'].includes(k)))throw Error('Invalid local recipe.');
 const tool=tools.find(row=>row.id===input.toolId);
 if(!tool||tool.adapter!=='speech.whisper'||input.operation!=='transcribe'||!tool.models.includes(input.model)||!Number.isFinite(input.start_sec)||input.start_sec<0||input.start_sec>86400||!Number.isFinite(input.duration_sec)||input.duration_sec<.1||input.duration_sec>120||typeof input.language!=='string'||!['auto','en','fr','es','ar','de','it','pt','ja','ko','zh','tr','hi'].includes(input.language))throw Error('Choose a declared speech model and at most 120 seconds of source audio.');
 return {toolId:tool.id,operation:'transcribe',model:input.model,start_sec:input.start_sec,duration_sec:input.duration_sec,language:input.language};
}
