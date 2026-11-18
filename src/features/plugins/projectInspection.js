// Complete document inspection stays separate from the bounded edit contract.
// Values are traversed lazily: large strings/arrays never cross IPC in one reply.
import {layerName,layerStateOf} from '../../state/store.js';
const SECTIONS=new Set(['project','tracks','clips','media','markers']);
const LANES=['video','overlay','audio','text','effect'];
const own=(value,key)=>Object.hasOwn(value,key);
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const checkKeys=(input,allowed)=>{if(!record(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Invalid inspection request');};
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const PAGE=200,STRING=65536,INLINE=2048,REFS=100000;
export function createProjectInspection(){
 const mediaIds=new Map(),markerIds=new Map();let mediaSerial=0,markerSerial=0,valueSerial=0,revision=0,documentId='',values=new Map(),references=new Map();
 const mediaId=id=>{if(typeof id!=='string')return null;if(!mediaIds.has(id))mediaIds.set(id,`m-${++mediaSerial}`);return mediaIds.get(id);};
 const markerId=(id,index)=>{const key=JSON.stringify(typeof id==='string'?['id',id]:['index',index]);if(!markerIds.has(key))markerIds.set(key,`k-${++markerSerial}`);return markerIds.get(key);};
 function update(model){if(model.scope.documentId!==documentId||model.scope.projectRevision!==revision){documentId=model.scope.documentId;revision=model.scope.projectRevision;values=new Map();references=new Map();}}
 function scope(input,required=false){
  const supplied=input.documentId!==undefined||input.projectRevision!==undefined;
  if((required||supplied)&&(input.documentId!==documentId||input.projectRevision!==revision))throw Error('Project inspection is stale; read the first page again');
 }
 function value(input,key){
  if(input===undefined)return null;
  if(input===null||typeof input==='boolean'||typeof input==='number'&&Number.isFinite(input))return input;
  if(typeof input==='string'&&input.length<=INLINE)return input;
  if(typeof input!=='string'&&!Array.isArray(input)&&!record(input))throw Error('Inspection values must be JSON data');
  let ref=references.get(key);if(!ref){if(values.size>=REFS)throw Error('Inspection reference limit reached; restart inspection');ref=`v-${++valueSerial}`;references.set(key,ref);values.set(ref,input);}
  const stored=values.get(ref);return {ref,type:typeof stored==='string'?'string':Array.isArray(stored)?'array':'object',size:typeof stored==='string'||Array.isArray(stored)?stored.length:Object.keys(stored).length};
 }
 function page(model,input={}){
  checkKeys(input,['section','cursor','limit','documentId','projectRevision','lane','trackId','ids','sourceIds']);update(model);
  if(!SECTIONS.has(input.section))throw Error('Choose an inspection section');
  const cursor=input.cursor??0,limit=input.limit??100;if(!integer(cursor,Number.MAX_SAFE_INTEGER)||!integer(limit,PAGE)||limit<1)throw Error('Invalid inspection page');scope(input,cursor>0);
  if(input.lane!==undefined&&(!LANES.includes(input.lane)||!['clips','tracks'].includes(input.section)))throw Error('Lane filtering is only available for clips and tracks');
  if(input.trackId!==undefined&&(input.section!=='clips'||typeof input.trackId!=='string'||!/^(video|overlay|audio|text|effect):\d+$/.test(input.trackId)))throw Error('Invalid inspection track');
  if(input.ids!==undefined&&(!['clips','media','markers'].includes(input.section)||!Array.isArray(input.ids)||input.ids.length>PAGE||input.ids.some(id=>typeof id!=='string'||!new RegExp('^'+({clips:'c',media:'m',markers:'k'}[input.section])+'-[1-9][0-9]{0,14}$').test(id))||new Set(input.ids).size!==input.ids.length))throw Error('Use at most 200 unique inspection handles');
  if(input.sourceIds!==undefined&&(!['clips','media'].includes(input.section)||input.ids!==undefined||!Array.isArray(input.sourceIds)||input.sourceIds.length>PAGE||input.sourceIds.some(id=>typeof id!=='string'||!id.length||id.length>1024)||new Set(input.sourceIds).size!==input.sourceIds.length))throw Error('Use at most 200 unique saved clip or media IDs, separately from inspection handles');
  const {project,rows,counts,clipHandle,linkOf}=model,section=input.section;let total,at;
  if(section==='project'){
   if(input.lane!==undefined||input.trackId!==undefined||input.ids!==undefined)throw Error('Invalid project inspection filter');total=1;
   at=()=>({kind:'project',id:documentId,properties:value(without(project,['id','craftAI','media','videoClips','overlayClips','audioClips','textClips','effectClips','stickerClips','markers']),'project')});
  }else if(section==='tracks'){
   const lanes=LANES.filter(lane=>input.lane===undefined||input.lane===lane);total=lanes.reduce((sum,lane)=>sum+counts[lane],0);
   at=index=>{let layer=index,lane;for(const candidate of lanes){if(layer<counts[candidate]){lane=candidate;break;}layer-=counts[candidate];}const state=layerStateOf(project,lane,layer);return {kind:'track',id:`${lane}:${layer}`,lane,layer,name:value(layerName(project,lane,layer),`track-name:${lane}:${layer}`),...Object.fromEntries(['locked','hidden','muted','solo'].map(key=>[key,!!state[key]]))};};
  }else if(section==='clips'){
   let list=rows.filter(row=>(input.lane===undefined||row.lane===input.lane)&&(input.trackId===undefined||`${row.lane}:${row.layer}`===input.trackId));
   if(input.ids){const wanted=new Set(input.ids);list=list.filter(row=>wanted.has(clipHandle(row)));}
   if(input.sourceIds){const wanted=new Set(input.sourceIds);list=list.filter(row=>wanted.has(row.clip.id));}
   total=list.length;at=index=>{const row=list[index],id=clipHandle(row);return {kind:'clip',id,trackId:`${row.lane}:${row.layer}`,lane:row.lane,start_sec:row.start,end_sec:row.end,gap:!!row.clip.gap,mediaId:mediaId(row.clip.mediaId),...(row.main?{main:{...row.main}}:{}),...(linkOf(row)?{link:linkOf(row)}:{}),properties:value(without(row.clip,['id','mediaId','linkId']),`clip:${id}`)};};
  }else if(section==='media'){
   let list=project.media||[];if(input.ids){const wanted=new Set(input.ids);list=list.filter(item=>wanted.has(mediaId(item.id)));}if(input.sourceIds){const wanted=new Set(input.sourceIds);list=list.filter(item=>wanted.has(item.id));}
   total=list.length;at=index=>{const item=list[index],id=mediaId(item.id);if(!id)throw Error('Project contains media without an identity');return {kind:'media',id,properties:value(without(item,['id']),`media:${id}`)};};
  }else{
   let list=(project.markers||[]).map((marker,index)=>({marker,index}));if(input.ids){const wanted=new Set(input.ids);list=list.filter(({marker,index})=>wanted.has(markerId(marker.id,index)));}
   total=list.length;at=index=>{const {marker,index:original}=list[index],id=markerId(marker.id,original);return {kind:'marker',id,time_sec:Number.isFinite(marker.time)?marker.time:null,label:value(marker.label||'',`marker-label:${id}`),properties:value(without(marker,['id']),`marker:${id}`)};};
  }
  if(cursor>total)throw Error('Inspection cursor is outside the section');const items=[];for(let index=cursor;index<Math.min(total,cursor+limit);index++)items.push(at(index));
  return {documentId,projectRevision:revision,section,total,next:cursor+items.length<total?cursor+items.length:null,items};
 }
 function readValue(model,input){
  checkKeys(input,['documentId','projectRevision','ref','path','cursor','limit']);update(model);scope(input,true);
  if(typeof input.ref!=='string'||!values.has(input.ref))throw Error('Inspection value is unavailable');
  const path=input.path??[];if(!Array.isArray(path)||path.length>64||path.some(key=>typeof key!=='string'&&(!Number.isSafeInteger(key)||key<0)||String(key).length>512))throw Error('Invalid inspection value path');
  let target=values.get(input.ref),identity=input.ref;
  for(const key of path){if(!target||typeof target!=='object'||!own(target,key))throw Error('Inspection path does not exist');target=target[key];identity+=':'+JSON.stringify(key);}
  const cursor=input.cursor??0,limit=input.limit??(typeof target==='string'?16384:100);
  if(!integer(cursor,Number.MAX_SAFE_INTEGER)||!integer(limit,typeof target==='string'?STRING:PAGE)||limit<1)throw Error('Invalid inspection value page');
  const result={documentId,projectRevision:revision};
  if(typeof target==='string'){
   if(cursor>target.length)throw Error('Inspection cursor is outside the value');const text=target.slice(cursor,cursor+limit);return {...result,kind:'string',total:target.length,next:cursor+text.length<target.length?cursor+text.length:null,text};
  }
  if(Array.isArray(target)){
   if(cursor>target.length)throw Error('Inspection cursor is outside the value');const items=Array.from({length:Math.min(limit,target.length-cursor)},(_,index)=>value(target[index+cursor],identity+':'+JSON.stringify(index+cursor)));return {...result,kind:'array',total:target.length,next:cursor+items.length<target.length?cursor+items.length:null,items};
  }
  if(record(target)){
   const keys=Object.keys(target);if(cursor>keys.length)throw Error('Inspection cursor is outside the value');const entries=keys.slice(cursor,cursor+limit).map((key,index)=>({key:value(key,identity+':entry:'+(cursor+index)+':key'),value:value(target[key],identity+':entry:'+(cursor+index)+':value')}));return {...result,kind:'object',total:keys.length,next:cursor+entries.length<keys.length?cursor+entries.length:null,entries};
  }
  if(cursor!==0)throw Error('Scalar values have no continuation cursor');return {...result,kind:'scalar',value:value(target,identity)};
 }
 function markerTargets(model,input){
  if(!Array.isArray(input?.operations)||input.operations.length>128)throw Error('Use at most 128 marker operations');
  const ids=input.operations.filter(operation=>operation?.type!=='add').map(operation=>operation?.id);
  if(ids.length>128||ids.some(id=>typeof id!=='string'||!/^k-[1-9][0-9]{0,14}$/.test(id)))throw Error('Invalid marker targets');
  update(model);const wanted=new Set(ids);
  return (model.project.markers||[]).flatMap((marker,index)=>{const handle=markerId(marker.id,index);return wanted.has(handle)?[{handle,index}]:[];});
 }
 return {page,readValue,markerTargets};
}
