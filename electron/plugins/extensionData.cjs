// Shared transport limits for trusted extension events and service stream chunks.
// Plain data is copied incrementally, before a message can retain a large backing
// buffer, cycle or deeply nested object in the host.
function copyPayload(value,{label='Event payload',limit=1024*1024}={}){
 let budget=limit;const ancestors=new Set(),spend=bytes=>{budget-=bytes;if(budget<0)throw Error(label+' exceeds '+(limit===1024*1024?'1 MiB':limit+' bytes'));};
 function copy(value,depth=0){
  if(depth>64)throw Error(label+' nesting exceeds its limit');
  if(value instanceof Uint8Array){spend(value.byteLength);return new Uint8Array(value);}
  if(value===null||value===undefined||typeof value==='boolean'){spend(16);return value;}
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error(label+' requires finite numbers');spend(16);return value;}
  if(typeof value==='string'){spend(Buffer.byteLength(value));return value;}
  if(typeof value!=='object'||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(label+' must contain plain data or bytes');
  if(ancestors.has(value))throw Error(label+' cannot be cyclic');ancestors.add(value);
  const keys=Object.keys(value);
  if(Array.isArray(value)&&(value.length>65536||keys.length!==value.length||keys.some((key,index)=>key!==String(index))))throw Error(label+' requires bounded dense arrays');
  const result=Array.isArray(value)?[]:Object.create(null);
  for(const key of keys){spend(Buffer.byteLength(key)+8);result[key]=copy(value[key],depth+1);}
  ancestors.delete(value);return result;
 }
 const result=copy(value);return {value:result,bytes:limit-budget};
}
module.exports={copyPayload};
