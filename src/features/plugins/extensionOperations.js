import {validateTextStyle} from '../../../shared/pluginStyles.mjs';
import {isLayerLocked,layerCount} from '../../state/store.js';
import {TEXT_TEMPLATES} from '../text/catalog.js';

const laneKeys={video:'videoClips',overlay:'overlayClips',audio:'audioClips'};
function trackOf(snapshot,trackId,lane) {
 const track=trackId?snapshot.timeline.tracks.find(t=>t.id===trackId):snapshot.timeline.tracks.find(t=>t.lane===lane&&t.layer===0);
 if(!track||track.lane!==lane)throw Error('Choose a matching timeline track');
 return track;
}
export function mediaInsertion(project,snapshot,item,input) {
 if(!item||!['image','video','audio'].includes(item.type)||!item.path||!item.id)throw Error('Host media artifact is invalid');
 // A named track decides the lane when none is given ("overlay:1" is an overlay placement).
 const lane=input.lane||(typeof input.trackId==='string'&&laneKeys[input.trackId.split(':')[0]]?input.trackId.split(':')[0]:item.type==='audio'?'audio':'video'),key=laneKeys[lane];
 if(!key||item.type==='audio'&&lane!=='audio'||item.type!=='audio'&&lane==='audio')throw Error('Media does not match the requested track');
 const track=trackOf(snapshot,input.trackId,lane);
 if(isLayerLocked(project,lane,track.layer))throw Error('The target track is locked');
 const at=input.start_sec??snapshot.playhead.time_sec;
 if(!Number.isFinite(at)||at<0||at>1e9)throw Error('Invalid media start time');
 if(project.media.length>=10000&&!project.media.some(m=>m.id===item.id))throw Error('Project media limit reached');
 const actions=project.media.some(m=>m.id===item.id)?[]:[{type:'addMedia',items:[item]}],clipId=crypto.randomUUID();
 if(lane==='video'){
  const index=input.index??project.videoClips.length;
  if(!Number.isInteger(index)||index<0||index>project.videoClips.length)throw Error('Invalid main-track insertion index');
  actions.push({type:'addToTimeline',mediaId:item.id,clipId,index,preserveCanvas:true});
 }else if(lane==='overlay')actions.push({type:'addOverlayClip',mediaId:item.id,clipId,at,layer:track.layer});
 else actions.push({type:'addToTimeline',mediaId:item.id,clipId,at,layer:track.layer});
 // The layout pass moves a clip that does not fit to another layer, even a locked one, and may
 // move an existing clip out of the way. An insertion must land where it was asked to, alone.
 const verifyPlacement=after=>{
  if(lane==='video')return;
  const busy='That track is occupied at this time. Choose a free time or another track.';
  const placed=after[key].find(clip=>clip.id===clipId),layers=new Map(project[key].map(clip=>[clip.id,clip.layer||0]));
  if(!placed||(placed.layer||0)!==track.layer||after[key].some(clip=>layers.has(clip.id)&&layers.get(clip.id)!==(clip.layer||0)))throw Error(busy);
 };
 return {action:{type:'batch',actions},clipId,mediaId:item.id,lane,key,verifyPlacement};
}
function captionTrack(project,trackId){
 const id=trackId??'text:0',match=typeof id==='string'&&/^text:(0|[1-9][0-9]{0,8})$/.exec(id),layer=Number(match?.[1]);
 if(!match||!Number.isSafeInteger(layer)||layer>=layerCount(project,'text'))throw Error('Choose an existing Text track');return {id,layer};
}
export function captionRead(project,snapshot,targets,input={}) {
 const track=captionTrack(project,input.trackId),cursor=input.cursor??0,limit=input.limit??100;
 if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid caption page');
 const handles=new Map(targets.filter(t=>t.track==='text').map(t=>[t.id,t.handle]));
 const clips=project.textClips.filter(c=>c.caption&&(c.layer||0)===track.layer).sort((a,b)=>a.start-b.start);
 return {documentId:snapshot.documentId,revision:snapshot.revision,total:clips.length,next:cursor+limit<clips.length?cursor+limit:null,cues:clips.slice(cursor,cursor+limit).map(c=>({id:handles.get(c.id)||null,text:c.text,start_sec:c.start,end_sec:c.start+c.duration}))};
}
export function captionWrite(project,snapshot,input,extensionId,scope) {
 if(!input||Object.keys(input).some(key=>!['documentId','revision','projectRevision','trackId','mode','cues','newTrack','style'].includes(key))||input.documentId!==snapshot.documentId||input.revision!==snapshot.revision)throw Error('Caption context is stale or invalid');
 if(input.projectRevision!==undefined&&(!scope||input.documentId!==scope.documentId||input.projectRevision!==scope.projectRevision))throw Error('Caption project context is stale');
 const create=input.mode==='create-track';
 if(!['append','replace','create-track'].includes(input.mode)||!Array.isArray(input.cues)||input.cues.length>10000)throw Error('Choose append, replace or create-track and at most 10000 cues');
 let track,name,hidden=false,language;
 if(create){
  const spec=input.newTrack;
  if(input.trackId!==undefined||!spec||typeof spec!=='object'||Array.isArray(spec)||Object.keys(spec).some(key=>!['name','hidden','language'].includes(key))||typeof spec.name!=='string'||!spec.name.trim()||spec.name.length>160||/[\u0000-\u001f\u007f]/.test(spec.name)||spec.hidden!==undefined&&typeof spec.hidden!=='boolean'||spec.language!==undefined&&(typeof spec.language!=='string'||spec.language.length>35||!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(spec.language)))throw Error('Provide a plain new caption track name, visibility and optional language');
  const layer=layerCount(project,'text');if(layer>=128||Object.values(project.layerState?.['text:'+layer]||{}).some(Boolean)||!input.cues.length)throw Error('The new caption track is unavailable or empty');
  track={id:'text:'+layer,layer};name=spec.name.trim();hidden=spec.hidden===true;language=spec.language;
 }else{if(input.newTrack!==undefined)throw Error('newTrack requires create-track mode');track=captionTrack(project,input.trackId);}
 if(isLayerLocked(project,'text',track.layer)||!create&&track.layer>=layerCount(project,'text'))throw Error('The caption track is locked or unavailable');
 let characters=0,styleBytes=0;
 const style=input.style===undefined?{}:validateTextStyle(input.style);
 if(style.font?.startsWith('pack:'))throw Error('Caption styles require an installed built-in font');
 const clips=Array.from(input.cues).map(c=>{
  if(!c||typeof c.text!=='string'||!c.text.trim()||c.text.length>4000||(characters+=c.text.length)>256000||!Number.isFinite(c.start_sec)||!Number.isFinite(c.end_sec)||c.start_sec<0||c.end_sec<=c.start_sec||c.end_sec>1e9)throw Error('Invalid caption cue');
  if(Object.keys(c).some(key=>!['text','start_sec','end_sec','style'].includes(key)))throw Error('Unknown caption cue field');
  const cueStyle=c.style===undefined?{}:validateTextStyle(c.style);if(cueStyle.font?.startsWith('pack:'))throw Error('Caption styles require an installed built-in font');styleBytes+=JSON.stringify(cueStyle).length;if(styleBytes>524288)throw Error('Caption style data exceeds 512 KiB');
  return {...TEXT_TEMPLATES.find(template=>template.id==='cap-classic').patch,id:crypto.randomUUID(),caption:true,text:c.text,start:c.start_sec,duration:c.end_sec-c.start_sec,layer:track.layer,size:Math.round(Math.min(project.width,project.height)*.075),template:'cap-classic',x:.5,y:.8,...style,...cueStyle,...Object.fromEntries(['stroke','shadow','bg','highlight','animIn','animOut','animLoop'].filter(key=>style[key]&&cueStyle[key]).map(key=>[key,{...style[key],...cueStyle[key]}])),word_timing:'unavailable',source:'extension',extensionId,...(language?{language}:{}),...(create?{captionTrackCreated:true}:{})};
 });
 const ids=input.mode==='replace'?project.textClips.filter(c=>c.caption&&(c.layer||0)===track.layer).map(c=>c.id):[];
 if(project.textClips.length-ids.length+clips.length>10000)throw Error('Project text limit reached');
 // One track holds one clip at a time. Overlapping cues would be moved to other tracks by the
 // layout pass (also onto locked ones, and taking existing titles with them), so refuse them here.
 const removed=new Set(ids),kept=create?[]:project.textClips.filter(c=>(c.layer||0)===track.layer&&!removed.has(c.id)).map(c=>({start:c.start,duration:c.duration,kept:true}));
 const ordered=[...kept,...clips].sort((x,y)=>x.start-y.start);
 for(let i=1;i<ordered.length;i++)if(ordered[i].start<ordered[i-1].start+ordered[i-1].duration-1e-6&&!(ordered[i].kept&&ordered[i-1].kept))throw Error(ordered[i].kept||ordered[i-1].kept?'A caption cue overlaps a clip already on this track':'Caption cues overlap each other');
 const action=create?{type:'appendCaptionTrack',layer:track.layer,name,hidden,clips}:ids.length||clips.length?{type:'replaceCaptionCues',ids,clips}:null;
 return {action,ids:clips.map(c=>c.id),...(create?{trackId:track.id}:{})};
}

// Public inspection handles resolve privately; raw IDs and metadata never come
// back from the extension. Each collection edit publishes as one Undo step.
export function markerApply(project,scope,input,targets){
 const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
 if(!plain(input)||Object.keys(input).some(key=>!['documentId','projectRevision','operations'].includes(key))||input.documentId!==scope.documentId||input.projectRevision!==scope.projectRevision)throw Error('Marker context is stale or invalid');
 if(!Array.isArray(input.operations)||input.operations.length>128)throw Error('Use at most 128 marker operations');
 const byHandle=new Map(),changed=new Set(),additions=[];let characters=0;
 for(const target of targets){if(byHandle.has(target.handle))throw Error('Marker target is ambiguous');byHandle.set(target.handle,target.index);}
 const edits=new Map();
 for(const operation of input.operations){
  if(!plain(operation)||!['add','update','remove'].includes(operation.type)||Object.keys(operation).some(key=>!({add:['type','time_sec','label'],update:['type','id','time_sec','label'],remove:['type','id']}[operation.type]).includes(key)))throw Error('Invalid marker operation');
  let index;
  if(operation.type!=='add'){
   if(!byHandle.has(operation.id)||changed.has(operation.id))throw Error('Unknown or repeated marker target');changed.add(operation.id);index=byHandle.get(operation.id);
  }
  if(operation.type==='remove'){edits.set(index,null);continue;}
  if(operation.type==='add'&&operation.time_sec===undefined||operation.time_sec!==undefined&&(!Number.isFinite(operation.time_sec)||operation.time_sec<0||operation.time_sec>1e9))throw Error('Invalid marker time');
  if(operation.label!==undefined&&(typeof operation.label!=='string'||operation.label.length>1000||/[\u0000-\u001f\u007f]/.test(operation.label)||(characters+=operation.label.length)>64000))throw Error('Invalid marker label');
  if(operation.type==='update'&&operation.time_sec===undefined&&operation.label===undefined)throw Error('Marker update needs a time or label');
  const previous=operation.type==='add'?null:project.markers[index],patch={...(operation.time_sec===undefined?{}:{time:operation.time_sec}),...(operation.label===undefined?{}:{label:operation.label})};
  if(previous){const next={...previous,...patch};edits.set(index,Object.keys(patch).every(key=>previous[key]===patch[key])?previous:next);}
  else additions.push({...patch,label:operation.label??''});
 }
 const existing=project.markers||[],retained=existing.flatMap((marker,index)=>edits.has(index)?edits.get(index)?[edits.get(index)]:[]:[marker]);
 if(retained.length+additions.length>10000&&retained.length+additions.length>existing.length)throw Error('Project marker limit reached');
 const used=new Set(['markers','media','videoClips','overlayClips','audioClips','textClips','effectClips','stickerClips'].flatMap(key=>(project[key]||[]).map(item=>item.id)));
 for(const marker of additions){let id;do{id=crypto.randomUUID();}while(used.has(id));used.add(id);marker.id=id;}
 const markers=[...retained,...additions];if(additions.length||[...edits].some(([index,marker])=>marker&&marker.time!==existing[index].time))markers.sort((a,b)=>a.time-b.time);
 const changedDocument=markers.length!==existing.length||markers.some((marker,index)=>marker!==existing[index]);
 return {action:changedDocument?{type:'setMarkers',markers}:null,applied:input.operations.length};
}

// Rebuild the bounded context around the explicit public targets of each request.
// Canonical transaction validators still own operation, pair, lock and revision checks.
export function editContextInput(transaction) {
 const ids=new Set(),add=id=>{if(id!==undefined&&id!==null){if(typeof id!=='string'||!/^c-[1-9][0-9]{0,14}$/.test(id))throw Error('Invalid public edit target');ids.add(id);if(ids.size>128)throw Error('Edit target context exceeds 128 clips');}};
 if(!Array.isArray(transaction?.operations)||transaction.operations.length>64)return undefined;
 const fields=operation=>{for(const field of ['clipId','partnerClipId','sourceClipId','beforeClipId'])add(operation?.[field]);};
 for(const operation of transaction.operations){
  fields(operation);
  if(Array.isArray(operation?.clipIds)){if(operation.clipIds.length>128)throw Error('Edit target context exceeds 128 clips');for(const id of operation.clipIds)add(id);}
  for(const key of ['companions','linkedPairs'])if(Array.isArray(operation?.[key])){if(operation[key].length>64)throw Error('Edit pair context exceeds 64 pairs');for(const pair of operation[key])fields(pair);}
 }
 return ids.size?{clipIds:[...ids]}:undefined;
}
