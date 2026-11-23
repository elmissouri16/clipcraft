// Saved custom timeline entities and deterministic native render projection.
// Schema/data validation is shared by authoring, native UI and SDK commits.
import serviceContractModule from 'clipcraft/internal/service-contract';
import {configurationValue} from './extensionConfiguration.mjs';
import {propertyOperation} from './pluginProperties.mjs';
import {effectParameters,effectId,validateEffectDefinition} from './pluginEffects.mjs';
const {serviceContract,serviceValue}=serviceContractModule;
const local=/^[a-z][a-z0-9-]{0,63}$/,entity=/^[a-zA-Z0-9][\w.-]{0,99}$/,digest=/^[a-f0-9]{64}$/;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const text=(v,max=160)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const keys=(v,allowed)=>{if(!record(v)||Object.keys(v).some(key=>!allowed.includes(key)))throw Error('Invalid custom timeline fields');};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function definitionBase(value){
 if(!local.test(value.id)||!text(value.name))throw Error('Custom timeline types need a local id and name');
 const schema=serviceContract({version:1,methods:{data:{input:value.schema??{type:'object',properties:{}},output:{type:'null'}}}}).methods.data.input;
 const jsonSchema=s=>s.type!=='bytes'&&(s.type!=='array'||jsonSchema(s.items))&&(s.type!=='object'||Object.values(s.properties).every(jsonSchema));
 if(schema.type!=='object'||!jsonSchema(schema))throw Error('Custom timeline schemas require a JSON object');
 const defaults=configurationValue(value.defaults??{});serviceValue(schema,defaults,'Custom type defaults');
 const labels=value.labels??{};if(!record(labels)||Object.entries(labels).some(([key,label])=>!Object.hasOwn(schema.properties,key)||!text(label)))throw Error('Custom property labels must name schema properties');
 return {id:value.id,name:value.name,schema,defaults,labels:{...labels}};
}
export function validateTrackType(value){
 keys(value,['id','name','schema','defaults','labels','kind','color','height']);const base=definitionBase(value);
 if(!['visual','audio','metadata'].includes(value.kind)||value.color!==undefined&&!/^#[a-fA-F0-9]{6}$/.test(value.color)||value.height!==undefined&&(!Number.isInteger(value.height)||!num(value.height,40,160)))throw Error('Invalid custom track appearance or kind');
 return {...base,kind:value.kind,color:value.color??'#8f7bce',height:value.height??64};
}
export function validateClipType(value,tracks,effects){
 keys(value,['id','name','schema','defaults','labels','trackType','render','color','labelField']);const base=definitionBase(value),track=tracks.find(track=>track.id===value.trackType),render=value.render;
 if(!track)throw Error('Custom clip type must reference a declared track type');
 keys(render,['kind','effect','parameters']);
 if(!['shader','media','none'].includes(render.kind)||track.kind==='metadata'&&render.kind!=='none'||track.kind==='audio'&&render.kind!=='media'||track.kind==='visual'&&render.kind==='none')throw Error('Custom renderer does not match the track kind');
 if(render.kind==='shader'){
  const effect=effects.find(effect=>effect.id===render.effect);if(!effect?.fragment)throw Error('Custom shader clips require a declared GLSL effect');
  const parameters=render.parameters??{};if(!record(parameters)||Object.entries(parameters).some(([id,key])=>!effect.parameters.some(parameter=>parameter.id===id)||typeof key!=='string'||!['number','integer'].includes(base.schema.properties[key]?.type)))throw Error('Custom shader uniforms must bind numeric data properties');
  const values=Object.fromEntries(Object.entries(parameters).map(([id,key])=>[id,base.defaults[key]]));effectParameters(effect,values);
 }else if(render.effect!==undefined||render.parameters!==undefined)throw Error('Only shader renderers bind effect parameters');
 if(value.color!==undefined&&!/^#[a-fA-F0-9]{6}$/.test(value.color)||value.labelField!==undefined&&!['string','number','integer','boolean'].includes(base.schema.properties[value.labelField]?.type))throw Error('Invalid custom clip appearance');
 return {...base,trackType:value.trackType,render:{...render,...(render.kind==='shader'?{parameters:{...(render.parameters??{})}}:{})},color:value.color??track.color,...(value.labelField?{labelField:value.labelField}:{})};
}
export function validateTimelineContributions(contributes){
 const trackInput=contributes.trackTypes??[],clipInput=contributes.clipTypes??[];
 if(!Array.isArray(trackInput)||!Array.isArray(clipInput)||trackInput.length>32||clipInput.length>64)throw Error('Use at most 32 custom track types and 64 clip types');
 const tracks=Array.from(trackInput,validateTrackType),effects=Array.from(contributes.effects??[],value=>validateEffectDefinition(value)),clips=Array.from(clipInput,value=>validateClipType(value,tracks,effects));
 if(new Set(tracks.map(row=>row.id)).size!==tracks.length||new Set(clips.map(row=>row.id)).size!==clips.length)throw Error('Duplicate custom timeline type');
 return {trackTypes:tracks,clipTypes:clips};
}
export const customTypeId=(row,kind)=>`custom-${kind}:${row.contributionId}@${row.digest}`;
let catalog={tracks:[],clips:[],effects:[],blankPath:null},trackTypes=new Map(),clipTypes=new Map(),revision=0;
export const customTypesRevision=()=>revision;
export function setCustomTimelineTypes(value={tracks:[],clips:[],effects:[],blankPath:null}){
 const tracks=new Map(),clips=new Map();
 const identity=(row,kind)=>{if(!record(row)||typeof row.pluginId!=='string'||!digest.test(row.digest)||row.contributionId!==row.pluginId+'/'+row.id)throw Error('Invalid custom timeline dependency');return customTypeId(row,kind);};
 for(const row of value.tracks??[])tracks.set(identity(row,'track'),{...row,...validateTrackType(row.definition??Object.fromEntries(['id','name','schema','defaults','labels','kind','color','height'].map(key=>[key,row[key]])))});
 for(const row of value.clips??[]){const same=other=>other.pluginId===row.pluginId&&other.digest===row.digest;const localTracks=[...tracks.values()].filter(same),effects=(value.effects??[]).filter(same);clips.set(identity(row,'clip'),{...row,...validateClipType(row.definition??Object.fromEntries(['id','name','schema','defaults','labels','trackType','render','color','labelField'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])),localTracks,effects)});}
 if(value.blankPath!==null&&value.blankPath!==undefined&&(typeof value.blankPath!=='string'||!value.blankPath||value.blankPath.includes('\0')))throw Error('Invalid custom shader input path');
 const next={tracks:[...tracks.values()],clips:[...clips.values()],effects:value.effects??[],blankPath:value.blankPath??null};if(equal(catalog,next))return false;catalog=next;trackTypes=tracks;clipTypes=clips;revision++;return true;
}
export const customTrackType=id=>trackTypes.get(id),customClipType=id=>clipTypes.get(id);
export const customTypeCatalog=()=>({tracks:[...trackTypes].map(([id,row])=>({...row,typeId:id})),clips:[...clipTypes].map(([id,row])=>({...row,typeId:id}))});
const mergedData=(definition,base,input)=>{if(input!==undefined&&!record(input))throw Error('Custom timeline data must be an object');return customTypeData(definition,{...base,...input});};
export function customTypeData(definition,value){const data=configurationValue(value);serviceValue(definition.schema,data,'Custom timeline data');return data;}
function refType(id,kind){const map=kind==='track'?trackTypes:clipTypes,definition=map.get(id);if(!definition)throw Error('Required custom '+kind+' type is unavailable');return definition;}
function clipState(project,clip,tracks=project.customTracks??[]){
 const track=tracks.find(track=>track.id===clip.trackId);if(!track)throw Error('Custom clip track is unavailable');const td=refType(track.typeId,'track'),cd=refType(clip.typeId,'clip');
 if(td.pluginId!==cd.pluginId||td.digest!==cd.digest||td.id!==cd.trackType||track.kind!==td.kind)throw Error('Custom clip and track type dependencies do not match');
 customTypeData(td,track.data);customTypeData(cd,clip.data);
 if(cd.render.kind==='shader'){const effect=catalog.effects.find(row=>row.pluginId===cd.pluginId&&row.digest===cd.digest&&row.id===cd.render.effect);if(!effect)throw Error('Required custom shader is unavailable');effectParameters(effect,Object.fromEntries(Object.entries(cd.render.parameters).map(([id,key])=>[id,clip.data[key]])));}
 const media=clip.mediaId?project.media.find(media=>media.id===clip.mediaId):null;
 if(cd.render.kind==='media'&&!media||clip.mediaId&&!media||media&&(td.kind==='audio'?media.type!=='audio'&&media.hasAudio!==true:media.type==='audio'))throw Error('Custom clip media is missing or incompatible');
 if(media&&media.type!=='image'&&(!num(media.duration,.001,1e9)||clip.sourceIn+clip.duration*clip.speed>media.duration+1e-5))throw Error('Custom clip source window exceeds its media');
 return {track,trackType:td,type:cd,media};
}
export function validateCustomTimeline(project){
 const tracks=project.customTracks??[],clips=project.customClips??[];
 if(!Array.isArray(tracks)||!Array.isArray(clips)||tracks.length>64||clips.length>1000)throw Error('Custom timeline exceeds its track or clip limit');
 const nativeIds=new Set(['media','videoClips','overlayClips','audioClips','textClips','effectClips','markers'].flatMap(key=>(project[key]??[]).map(row=>row.id)));
 const ids=new Set();for(const row of [...tracks,...clips]){if(!record(row)||!entity.test(row.id)||ids.has(row.id)||nativeIds.has(row.id)||!record(row.data)||typeof row.typeId!=='string'||row.typeId.length>400||!/^custom-(track|clip):[a-z][\w.-]*\/[a-z][\w-]*@[a-f0-9]{64}$/.test(row.typeId))throw Error('Invalid custom timeline identity');ids.add(row.id);configurationValue(row.data);}
 const trackIds=new Set(tracks.map(track=>track.id));
 for(const track of tracks){keys(track,['id','typeId','name','kind','data','hidden','locked','muted','solo']);if(!track.typeId.startsWith('custom-track:')||!text(track.name)||!['visual','audio','metadata'].includes(track.kind)||['hidden','locked','muted','solo'].some(key=>typeof track[key]!=='boolean'))throw Error('Invalid custom track');}
 for(const clip of clips){keys(clip,['id','typeId','trackId','name','data','start','duration','sourceIn','speed','mediaId','transform','opacity','disabled']);if(!clip.typeId.startsWith('custom-clip:')||!trackIds.has(clip.trackId)||!text(clip.name)||!num(clip.start,0,1e9)||!num(clip.duration,.02,86400)||!num(clip.sourceIn,0,1e9)||!num(clip.speed,.25,4)||!num(clip.opacity,0,1)||typeof clip.disabled!=='boolean'||clip.mediaId!==undefined&&(typeof clip.mediaId!=='string'||clip.mediaId.length>200))throw Error('Invalid custom clip');if(clip.transform!==undefined)validateTransform(clip.transform);}
 if(new TextEncoder().encode(JSON.stringify({tracks,clips})).length>4*1024*1024)throw Error('Custom timeline data exceeds 4 MiB');return project;
}
function validateTransform(transform){return propertyOperation({type:'set-transform',clipId:'target',partnerClipId:null,transform},new Map([['target',{trackId:'overlay:0'}]]),new Map([['overlay:0',{locked:false}]]),['clips.properties']).transform;}
export function customTimelineEdit(project,operations){
 if(!Array.isArray(operations)||!operations.length||operations.length>64)throw Error('Use 1 to 64 custom timeline operations');validateCustomTimeline(project);
 let tracks=[...(project.customTracks??[])],clips=[...(project.customClips??[])];const allIds=new Set([...(project.media??[]),...(project.videoClips??[]),...(project.overlayClips??[]),...(project.audioClips??[]),...(project.textClips??[]),...(project.effectClips??[]),...(project.markers??[]),...tracks,...clips].map(row=>row.id));
 const fresh=id=>{if(!entity.test(id)||allIds.has(id))throw Error('Custom entity id is invalid or already used');allIds.add(id);return id;},track=id=>{const row=tracks.find(row=>row.id===id);if(!row)throw Error('Custom track is unavailable');return row;},clip=id=>{const row=clips.find(row=>row.id===id);if(!row)throw Error('Custom clip is unavailable');return row;},unlocked=id=>{const value=track(id);if(value.locked)throw Error('Custom track is locked');return value;};
 for(const op of operations){
  if(!record(op)||typeof op.type!=='string')throw Error('Invalid custom timeline operation');
  if(op.type==='create-track'){
   keys(op,['type','id','typeId','name','data']);const definition=refType(op.typeId,'track');tracks.push({id:fresh(op.id),typeId:op.typeId,name:op.name??definition.name,kind:definition.kind,data:mergedData(definition,definition.defaults,op.data),hidden:false,locked:false,muted:false,solo:false});
  }else if(op.type==='update-track'){
   keys(op,['type','id','patch']);keys(op.patch,['name','data','replaceData','hidden','locked','muted','solo']);if(op.patch.replaceData!==undefined&&typeof op.patch.replaceData!=='boolean'||op.patch.replaceData&&op.patch.data===undefined)throw Error('Invalid custom data replacement');const old=track(op.id);if(old.locked&&Object.keys(op.patch).some(key=>!['locked','hidden','muted','solo'].includes(key)))throw Error('Custom track is locked');const {replaceData,...patch}=op.patch;const next={...old,...patch,...(patch.data!==undefined?{data:mergedData(refType(old.typeId,'track'),replaceData?{}:old.data,patch.data)}:{})};tracks=tracks.map(row=>row===old?next:row);
  }else if(op.type==='delete-track'){
   keys(op,['type','id','removeClips']);if(op.removeClips!==undefined&&typeof op.removeClips!=='boolean')throw Error('Choose explicit track removal');unlocked(op.id);if(clips.some(clip=>clip.trackId===op.id)&&op.removeClips!==true)throw Error('Explicitly remove the track clips before deleting this track');tracks=tracks.filter(row=>row.id!==op.id);clips=clips.filter(row=>row.trackId!==op.id);
  }else if(op.type==='move-track'){
   keys(op,['type','id','beforeId']);const row=unlocked(op.id);if(op.beforeId!==null)track(op.beforeId);if(op.id!==op.beforeId){tracks=tracks.filter(item=>item!==row);tracks.splice(op.beforeId===null?tracks.length:tracks.findIndex(item=>item.id===op.beforeId),0,row);}
  }else if(op.type==='create-clip'){
   keys(op,['type','id','typeId','trackId','name','start_sec','duration_sec','data','mediaId','sourceIn_sec','speed','transform','opacity']);const definition=refType(op.typeId,'clip');unlocked(op.trackId);clips.push({id:fresh(op.id),typeId:op.typeId,trackId:op.trackId,name:op.name??definition.name,data:mergedData(definition,definition.defaults,op.data),start:op.start_sec,duration:op.duration_sec,sourceIn:op.sourceIn_sec??0,speed:op.speed??1,opacity:op.opacity??1,disabled:false,...(op.mediaId?{mediaId:op.mediaId}:{}),...(op.transform?{transform:validateTransform(op.transform)}:{})});
  }else if(op.type==='update-clip'){
   keys(op,['type','id','patch']);keys(op.patch,['name','trackId','start_sec','duration_sec','sourceIn_sec','speed','data','replaceData','transform','opacity','disabled']);if(op.patch.replaceData!==undefined&&typeof op.patch.replaceData!=='boolean'||op.patch.replaceData&&op.patch.data===undefined)throw Error('Invalid custom data replacement');const old=clip(op.id);unlocked(old.trackId);if(op.patch.trackId)unlocked(op.patch.trackId);const {start_sec,duration_sec,sourceIn_sec,replaceData,...patch}=op.patch,next={...old,...patch,...(start_sec!==undefined?{start:start_sec}:{}),...(duration_sec!==undefined?{duration:duration_sec}:{}),...(sourceIn_sec!==undefined?{sourceIn:sourceIn_sec}:{}),...(patch.data!==undefined?{data:mergedData(refType(old.typeId,'clip'),replaceData?{}:old.data,patch.data)}:{}),...(patch.transform?{transform:validateTransform(patch.transform)}:{})};clips=clips.map(row=>row===old?next:row);
  }else if(op.type==='delete-clip'){
   keys(op,['type','id']);unlocked(clip(op.id).trackId);clips=clips.filter(row=>row.id!==op.id);
  }else if(op.type==='duplicate-clip'){
   keys(op,['type','id','newId','trackId','start_sec']);const old=clip(op.id);unlocked(old.trackId);unlocked(op.trackId??old.trackId);clips.push({...old,id:fresh(op.newId),trackId:op.trackId??old.trackId,start:op.start_sec??old.start+old.duration,data:configurationValue(old.data)});
  }else if(op.type==='split-clip'){
   keys(op,['type','id','newId','at_sec']);const old=clip(op.id);unlocked(old.trackId);if(!Number.isFinite(op.at_sec)||op.at_sec<old.start+.02||op.at_sec>old.start+old.duration-.02)throw Error('Split inside the custom clip with at least 0.02 seconds on each side');const left=op.at_sec-old.start;clips=clips.flatMap(row=>row===old?[{...old,duration:left},{...old,id:fresh(op.newId),start:op.at_sec,duration:old.duration-left,sourceIn:old.sourceIn+left*old.speed,data:configurationValue(old.data)}]:[row]);
  }else throw Error('Unsupported custom timeline operation');
 }
 const next={...project,customTracks:tracks,customClips:clips};validateCustomTimeline(next);for(const row of tracks){const old=project.customTracks?.find(item=>item.id===row.id);if(old&&old.typeId===row.typeId&&old.kind===row.kind&&equal(old.data,row.data))continue;const definition=refType(row.typeId,'track');if(definition.kind!==row.kind)throw Error('Custom track kind changed');customTypeData(definition,row.data);}for(const row of clips){const old=project.customClips?.find(item=>item.id===row.id);if(old&&(old===row||equal({...old,disabled:row.disabled},row)))continue;clipState(next,row,tracks);}
 return equal(project.customTracks??[],tracks)&&equal(project.customClips??[],clips)?project:next;
}
export function customTimelineDuration(project){const tracks=new Map((project.customTracks??[]).map(track=>[track.id,track]));return Math.max(0,...(project.customClips??[]).filter(clip=>tracks.get(clip.trackId)?.kind!=='metadata').map(clip=>clip.start+clip.duration));}
export function projectCustomTimeline(project,mainEnd=0){
 if(!(project.customTracks?.length||project.customClips?.length))return project;
 validateCustomTimeline(project);const issues=[],media=[...project.media],overlays=[...(project.overlayClips??[])],audio=[...(project.audioClips??[])],state={...project.layerState},overlayBase=Math.max(-1,...overlays.map(clip=>clip.layer??0))+1,audioBase=Math.max(-1,...audio.map(clip=>clip.layer??0))+1;
 for(const [index,track] of project.customTracks.entries()){
  const layer=track.kind==='audio'?audioBase+index:overlayBase+index,lane=track.kind==='audio'?'audio':'overlay';state[lane+':'+layer]={hidden:track.hidden,muted:track.muted,solo:track.solo,locked:track.locked};
  for(const clip of (project.customClips??[]).filter(clip=>clip.trackId===track.id&&!clip.disabled&&!track.hidden)){
   try{
    const resolved=clipState(project,clip),definition=resolved.type;if(definition.render.kind==='none')continue;
    let mediaId=clip.mediaId;
    if(!mediaId){if(!catalog.blankPath)throw Error('Custom renderer input is unavailable');mediaId='custom-input-'+clip.id;while(media.some(item=>item.id===mediaId))mediaId+='-';media.push({id:mediaId,path:catalog.blankPath,type:'image',name:clip.name,width:project.width,height:project.height,duration:0,customInput:true});}
    const native={id:clip.id,mediaId,start:clip.start,in:clip.sourceIn,out:clip.sourceIn+clip.duration*clip.speed,speed:clip.speed,layer,opacity:clip.opacity,...(clip.transform?{transform:clip.transform}:{}),customClipId:clip.id,effects:[]};
    if(definition.render.kind==='shader'){const effect=catalog.effects.find(effect=>effect.pluginId===definition.pluginId&&effect.digest===definition.digest&&effect.id===definition.render.effect),id=effectId(effect),params=effectParameters(effect,Object.fromEntries(Object.entries(definition.render.parameters).map(([id,key])=>[id,clip.data[key]])));native.effects=[id];native.pluginEffects={[id]:{pluginId:effect.pluginId,contributionId:effect.contributionId,version:effect.version,digest:effect.digest,name:effect.name,params}};native.customTime={offset:clip.sourceIn,scale:clip.speed};}
    (track.kind==='audio'?audio:overlays).push(native);
   }catch(error){issues.push(clip.name+': '+error.message);}
  }
 }
 const end=customTimelineDuration(project),video=[...project.videoClips];if(end>mainEnd+1e-7){let id='custom-duration-gap';const used=new Set([...video,...overlays,...audio,...(project.customClips??[])].map(clip=>clip.id));while(used.has(id))id+='-';video.push({id,gap:true,in:0,out:end-mainEnd,speed:1});}
 return {...project,media,videoClips:video,overlayClips:overlays,audioClips:audio,layerState:state,customTracks:[],customClips:[],customRenderIssues:issues};
}
export function customTimelineRequest(project,scope,input){
 keys(input,['documentId','projectRevision','operations']);if(input.documentId!==scope.documentId||input.projectRevision!==scope.projectRevision)throw Error('Custom timeline context is stale');
 const next=customTimelineEdit(project,input.operations);return {next,value:{applied:next===project?0:input.operations.length,changed:next!==project}};
}
export function customTimelinePage(project,scope,input){
 keys(input,['section','cursor','limit','documentId','projectRevision','trackId']);if(!['tracks','clips'].includes(input.section))throw Error('Choose custom tracks or clips');
 const cursor=input.cursor??0,limit=input.limit??32;if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>128||input.trackId!==undefined&&(typeof input.trackId!=='string'||input.section!=='clips'))throw Error('Invalid custom timeline page');
 if((cursor>0||input.documentId!==undefined||input.projectRevision!==undefined)&&(input.documentId!==scope.documentId||input.projectRevision!==scope.projectRevision))throw Error('Custom timeline page is stale');
 const rows=(project[input.section==='tracks'?'customTracks':'customClips']??[]).filter(row=>!input.trackId||row.trackId===input.trackId);if(cursor>rows.length)throw Error('Custom timeline cursor is outside the document');const items=[];let bytes=0;
 for(const row of rows.slice(cursor,cursor+limit)){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(bytes+size>256*1024)break;items.push(JSON.parse(JSON.stringify(row)));bytes+=size;}
 return {...scope,section:input.section,items,total:rows.length,next:cursor+items.length<rows.length?cursor+items.length:null};
}
