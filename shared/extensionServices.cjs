// Portable, bounded service contracts. These are data contracts, never code.
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const name=/^[a-zA-Z][\w.-]{0,127}$/;
function serviceContract(input){
 let nodes=0;const seen=new Set();
 function schema(value,depth=0){
  if(++nodes>512||depth>16||!plain(value)||seen.has(value))throw Error('Invalid or oversized service schema');seen.add(value);
  const keys={null:[],boolean:[],number:['minimum','maximum'],integer:['minimum','maximum'],string:['minLength','maxLength','enum'],bytes:['maxLength'],array:['items','maxItems'],object:['properties','required']}[value.type];
  if(!keys||Object.keys(value).some(key=>key!=='type'&&!keys.includes(key)))throw Error('Unsupported service schema');
  const out={type:value.type};
  for(const key of ['minimum','maximum','minLength','maxLength','maxItems'])if(value[key]!==undefined){if(!Number.isFinite(value[key])||!['minimum','maximum'].includes(key)&&(!Number.isSafeInteger(value[key])||value[key]<0))throw Error('Invalid service schema bound');out[key]=value[key];}
  if(out.minimum>out.maximum||out.minLength>out.maxLength)throw Error('Inverted service schema bounds');
  if(value.enum!==undefined){if(!Array.isArray(value.enum)||!value.enum.length||value.enum.length>128||value.enum.some(v=>typeof v!=='string'||v.length>1024)||new Set(value.enum).size!==value.enum.length)throw Error('Invalid service enum');out.enum=[...value.enum];}
  if(value.type==='array')out.items=schema(value.items,depth+1);
  if(value.type==='object'){
   if(!plain(value.properties)||Object.keys(value.properties).length>128||Object.keys(value.properties).some(key=>!name.test(key)||['__proto__','constructor','prototype'].includes(key)))throw Error('Invalid service properties');
   out.properties=Object.fromEntries(Object.entries(value.properties).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,schema(v,depth+1)]));
   const required=value.required??[];if(!Array.isArray(required)||required.some(key=>!Object.hasOwn(out.properties,key))||new Set(required).size!==required.length)throw Error('Invalid required service properties');out.required=[...required].sort();
  }
  seen.delete(value);return out;
 }
 if(!plain(input)||Object.keys(input).some(key=>!['version','methods'].includes(key))||!Number.isSafeInteger(input.version)||input.version<1||!plain(input.methods)||!Object.keys(input.methods).length||Object.keys(input.methods).length>64)throw Error('Invalid service contract');
 const methods=Object.fromEntries(Object.entries(input.methods).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
  if(!name.test(key)||['__proto__','constructor','prototype'].includes(key)||!plain(value)||Object.keys(value).some(k=>!['input','output','stream'].includes(k))||value.stream!==undefined&&typeof value.stream!=='boolean')throw Error('Invalid service method contract');
  return [key,{input:schema(value.input),output:schema(value.output),...(value.stream?{stream:true}:{})}];
 }));
 const result={version:input.version,methods};if(JSON.stringify(result).length>65536)throw Error('Service contract exceeds 64 KiB');return result;
}
function serviceValue(schema,value,label='Service value'){
 let nodes=0;const seen=new Set();
 function check(s,v,depth=0){
  if(++nodes>65536||depth>64)throw Error(label+' exceeds validation limits');
  const fail=()=>{throw Error(label+' does not match its service contract');};
  if(s.type==='null'){if(v!==null)fail();}
  else if(s.type==='boolean'){if(typeof v!=='boolean')fail();}
  else if(s.type==='number'||s.type==='integer'){if(!Number.isFinite(v)||s.type==='integer'&&!Number.isSafeInteger(v)||s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum)fail();}
  else if(s.type==='string'){if(typeof v!=='string'||s.minLength!==undefined&&v.length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength||s.enum&&!s.enum.includes(v))fail();}
  else if(s.type==='bytes'){if(!(v instanceof Uint8Array)||s.maxLength!==undefined&&v.byteLength>s.maxLength)fail();}
  else {
   if(!v||typeof v!=='object'||seen.has(v))fail();seen.add(v);
   if(s.type==='array'){if(!Array.isArray(v)||s.maxItems!==undefined&&v.length>s.maxItems)fail();for(const item of v)check(s.items,item,depth+1);}
   else {if(!plain(v)||Object.keys(v).some(key=>!Object.hasOwn(s.properties,key))||s.required.some(key=>v[key]===undefined))fail();for(const [key,item]of Object.entries(v))if(item!==undefined)check(s.properties[key],item,depth+1);}
   seen.delete(v);
  }
 }
 check(schema,value);return value;
}
function serviceMethod(contract,method,input,stream=false){
 if(!contract)return null;const entry=Object.hasOwn(contract.methods,method)?contract.methods[method]:null;
 if(!entry||!!entry.stream!==stream)throw Error('Service method or streaming mode does not match its contract');serviceValue(entry.input,input,'Service input');return entry;
}
function matchServiceContract(actual,expected){if(expected!==undefined&&(!actual||JSON.stringify(serviceContract(actual))!==JSON.stringify(serviceContract(expected))))throw Error('Service contract is unavailable or incompatible');}
module.exports={serviceContract,serviceValue,serviceMethod,matchServiceContract};
