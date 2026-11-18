// Bounded proposals only. Raw project IDs and reducer actions are never accepted.
import {editorSnapshot} from './pluginEditor.mjs';
import {LIFECYCLE_OPERATIONS,lifecycleOperation} from './pluginLifecycle.mjs';
import {PROPERTY_OPERATIONS,propertyOperation} from './pluginProperties.mjs';
import {AUTOMATION_OPERATIONS,automationOperation} from './pluginAutomation.mjs';
export const MAX_CLIP_EDITS=64;
export const EDITABLE_LANES=Object.freeze(['overlay','audio','text','effect']);
const keys=(v,names)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k))||names.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid clip transaction fields.');};
const time=v=>Number.isFinite(v)&&v>=0&&v<=1e9;
export function clipTransaction(value,context,duration=1e9,permissions=['clips.write']){
 const snapshot=editorSnapshot(context);keys(value,['documentId','revision','operations']);
 if(value.documentId!==snapshot.documentId||value.revision!==snapshot.revision)throw Error('Clip transaction context is stale.');
 if(!Array.isArray(value.operations)||!value.operations.length||value.operations.length>MAX_CLIP_EDITS)throw Error('Stage 1–64 clip operations in one transaction.');
 const tracks=new Map(snapshot.timeline.tracks.map(t=>[t.id,t])),clips=new Map(snapshot.timeline.clips.map(c=>[c.id,{...c}]));
 let companionBudget=MAX_CLIP_EDITS-value.operations.length,curveBudget=256;
 const operations=value.operations.map(op=>{
  if(AUTOMATION_OPERATIONS.includes(op?.type)){
   if(value.operations.some(v=>!AUTOMATION_OPERATIONS.includes(v?.type)))throw Error('Source automation operations cannot mix with other edit families.');
   const operation=automationOperation(op,clips,tracks,permissions);if(operation.type==='set-keyframes'){curveBudget-=operation.points.length;if(curveBudget<0)throw Error('A source automation batch may supply at most 256 curve points.');}return operation;
  }
  if(PROPERTY_OPERATIONS.includes(op?.type)){
   if(value.operations.some(v=>!PROPERTY_OPERATIONS.includes(v?.type)))throw Error('Property operations cannot mix with other edit families.');
   return propertyOperation(op,clips,tracks,permissions);
  }
  if(LIFECYCLE_OPERATIONS.includes(op?.type)){
   if(value.operations.some(v=>!LIFECYCLE_OPERATIONS.includes(v?.type)))throw Error('Lifecycle operations cannot mix with other edit families.');
   return lifecycleOperation(op,clips,tracks,permissions,duration);
  }
  if(op?.type==='ripple-remove'){
   keys(op,['type','start_sec','end_sec','clipIds','linkedPairs','gaps','transitions','markers']);
   if(!permissions.includes('timeline.ripple'))throw Error('Permission denied: timeline.ripple');
   if(value.operations.length!==1)throw Error('Ripple removal must be the only operation in its transaction.');
   if(!time(op.start_sec)||!time(op.end_sec)||op.end_sec-op.start_sec<=1e-8||op.end_sec>duration+1e-8)throw Error('Choose a positive ripple interval inside the project.');
   if(op.gaps!=='preserve-pieces'||op.transitions!=='reject'||op.markers!=='preserve')throw Error('Choose explicit ripple gap, transition and marker policies.');
   if(!Array.isArray(op.clipIds)||op.clipIds.length>63||!Array.isArray(op.linkedPairs)||op.linkedPairs.length>32||op.clipIds.length+op.linkedPairs.length+1>MAX_CLIP_EDITS)throw Error('Ripple scope exceeds the 64-operation/declaration budget.');
   if(op.clipIds.length&&!permissions.includes('clips.write'))throw Error('Permission denied: clips.write for ripple free clips.');
   if(op.linkedPairs.length&&!permissions.includes('clips.links'))throw Error('Permission denied: clips.links for ripple pairs.');
   if(tracks.get('video:0')?.locked)throw Error('Main track is locked.');
   const used=new Set(),take=id=>{const c=clips.get(id);if(!c||used.has(id))throw Error('Ripple needs unique returned clip handles.');used.add(id);if(tracks.get(c.trackId)?.locked)throw Error('A ripple target is locked.');return c;};
   const clipIds=op.clipIds.map(id=>{const c=take(id);if(c.gap||c.link||!EDITABLE_LANES.includes(tracks.get(c.trackId)?.lane))throw Error('Ripple free targets must be unlinked free-track clips.');return id;});
   const linkedPairs=op.linkedPairs.map(value=>{keys(value,['clipId','partnerClipId']);const a=take(value.clipId),b=take(value.partnerClipId),left=tracks.get(a.trackId)?.lane,right=tracks.get(b.trackId)?.lane;
    if(!a.link||a.link.partnerId!==b.id||b.link?.partnerId!==a.id||a.link.groupId!==b.link.groupId||a.link.members_total!==2||!((['video','overlay'].includes(left)&&right==='audio')||(['video','overlay'].includes(right)&&left==='audio')))throw Error('Ripple needs explicit complete picture/audio pairs.');
    return {clipId:a.id,partnerClipId:b.id};});
   return {type:op.type,start_sec:op.start_sec,end_sec:op.end_sec,clipIds,linkedPairs,gaps:op.gaps,transitions:op.transitions,markers:op.markers};
  }
  if(op?.type==='reorder-linked'){
   keys(op,['type','clipId','partnerClipId','beforeClipId','companions','gaps','transitions']);
   if(!permissions.includes('timeline.reorder')||!permissions.includes('clips.links'))throw Error('Permission denied: reorder-linked requires timeline.reorder and clips.links.');
   if(!Array.isArray(op.companions)||op.companions.length>31)throw Error('Declare at most 31 companion pairs.');
   companionBudget-=op.companions.length;if(companionBudget<0)throw Error('A transaction may contain at most 64 operations and companion declarations.');
   const used=new Set();
   const pair=value=>{
    keys(value,['clipId','partnerClipId']);
    const a=clips.get(value.clipId),b=clips.get(value.partnerClipId),picture=a?.trackId==='video:0'?a:b;
    if(!a||!b||a===b||a.gap||b.gap||!picture?.main||picture.trackId!=='video:0'||(a===picture?b:a).trackId.split(':')[0]!=='audio'||!a.link||a.link.partnerId!==b.id||b.link?.partnerId!==a.id||a.link.groupId!==b.link.groupId||a.link.members_total!==2)throw Error('Linked reorder needs explicit complete main-picture/audio pairs.');
    for(const c of [a,b]){if(used.has(c.id))throw Error('Duplicate linked reorder pair.');used.add(c.id);if(tracks.get(c.trackId)?.locked)throw Error('A linked reorder partner is locked.');}
    return {clipId:a.id,partnerClipId:b.id};
   };
   const source=pair({clipId:op.clipId,partnerClipId:op.partnerClipId}),companions=op.companions.map(pair),picture=clips.get(source.clipId).trackId==='video:0'?clips.get(source.clipId):clips.get(source.partnerClipId),anchor=op.beforeClipId===null?null:clips.get(op.beforeClipId);
   if(op.beforeClipId!==null&&(!anchor?.main||anchor.trackId!=='video:0'||anchor.id===picture.id))throw Error('Linked reorder needs a distinct returned main anchor.');
   if(op.gaps!=='preserve'||!['reject','clear-boundaries'].includes(op.transitions))throw Error('Choose explicit linked reorder gap and transition policies.');
   return {type:op.type,...source,beforeClipId:op.beforeClipId,companions,gaps:op.gaps,transitions:op.transitions};
  }
  if(['link','unlink','move-linked'].includes(op?.type)){
   keys(op,op.type==='move-linked'?['type','clipId','partnerClipId','start_sec','gaps','transitions']:['type','clipId','partnerClipId']);
   if(!permissions.includes('clips.links'))throw Error('Permission denied: clips.links');
   const source=clips.get(op.clipId),partner=clips.get(op.partnerClipId);
   if(!source||!partner||source===partner||source.gap||partner.gap||!((['video','overlay'].includes(tracks.get(source.trackId)?.lane)&&tracks.get(partner.trackId)?.lane==='audio')||(['video','overlay'].includes(tracks.get(partner.trackId)?.lane)&&tracks.get(source.trackId)?.lane==='audio')))throw Error('Link operations need explicit returned picture and audio handles.');
   if([source,partner].some(c=>tracks.get(c.trackId)?.locked))throw Error('A linked partner track is locked.');
   // Topology and timing are checked in operation order by the private host planner.
   // A command may link, move and unlink the same two original handles in one batch.
   if(op.type==='move-linked'&&(!time(op.start_sec)||op.gaps!=='preserve-time'||op.transitions!=='reject'))throw Error('Choose a valid picture start and explicit preserve-time/reject policies.');
   return {...op};
  }
  if(['split-linked','trim-linked'].includes(op?.type)){
   keys(op,op.type==='split-linked'?['type','clipId','partnerClipId','at_sec','gaps','transitions']:['type','clipId','partnerClipId','start_sec','end_sec','gaps','transitions']);
   if(!permissions.includes('clips.linked'))throw Error('Permission denied: clips.linked');
   const source=clips.get(op.clipId),partner=clips.get(op.partnerClipId);
   if(!source||!partner||!source.link||source.link.partnerId!==partner.id||partner.link?.partnerId!==source.id||source.link.groupId!==partner.link.groupId||source.link.members_total!==2)throw Error('Linked edits need both returned handles of one complete picture/audio pair.');
   if([source,partner].some(c=>tracks.get(c.trackId)?.locked))throw Error('A linked partner track is locked.');
   if(op.gaps!=='preserve-time'||!['reject','preserve-overlap'].includes(op.transitions))throw Error('Choose explicit linked gap and transition policies.');
   if(Math.abs((source.end_sec-source.start_sec)-(partner.end_sec-partner.start_sec))>1e-8)throw Error('Linked partners must have equal timeline durations.');
   if(op.type==='split-linked'?!time(op.at_sec):!time(op.start_sec)||!time(op.end_sec)||op.end_sec-op.start_sec<.1-1e-9)throw Error('Invalid linked edit range.');
   return op.type==='split-linked'?{type:op.type,clipId:op.clipId,partnerClipId:op.partnerClipId,at_sec:op.at_sec,gaps:op.gaps,transitions:op.transitions}:{type:op.type,clipId:op.clipId,partnerClipId:op.partnerClipId,start_sec:op.start_sec,end_sec:op.end_sec,gaps:op.gaps,transitions:op.transitions};
  }
  if(['split','trim-main'].includes(op?.type)){
   keys(op,op.type==='split'?['type','clipId','at_sec','gaps','transitions']:['type','clipId','start_sec','end_sec','gaps','transitions']);
   if(!permissions.includes('timeline.edit'))throw Error('Permission denied: timeline.edit');
   const source=clips.get(op.clipId);
   if(!source||source.trackId!=='video:0'||source.gap||!source.main)throw Error('Main edits need a returned non-gap main clip handle.');
   if(tracks.get('video:0')?.locked)throw Error('Main track is locked.');
   if(op.gaps!=='preserve-time'||!['reject','preserve-overlap'].includes(op.transitions))throw Error('Choose explicit main gap and transition policies.');
   if(op.type==='split'?!time(op.at_sec):!time(op.start_sec)||!time(op.end_sec)||op.end_sec-op.start_sec<.1-1e-9)throw Error('Invalid main edit range.');
   // Actual bounds depend on earlier operations; the private host planner owns them.
   return op.type==='split'?{type:'split',clipId:op.clipId,at_sec:op.at_sec,gaps:op.gaps,transitions:op.transitions}:{type:'trim-main',clipId:op.clipId,start_sec:op.start_sec,end_sec:op.end_sec,gaps:op.gaps,transitions:op.transitions};
  }
  if(op?.type==='reorder'){
   keys(op,['type','clipId','beforeClipId','gaps','transitions']);
   if(!permissions.includes('timeline.reorder'))throw Error('Permission denied: timeline.reorder');
   const source=clips.get(op.clipId),anchor=op.beforeClipId===null?null:clips.get(op.beforeClipId);
   if(!source||source.trackId!=='video:0'||source.gap||!source.main||op.beforeClipId!==null&&(!anchor||anchor.trackId!=='video:0'||!anchor.main)||op.clipId===op.beforeClipId)throw Error('Reorder needs returned main clip handles and a distinct anchor.');
   if(tracks.get('video:0')?.locked)throw Error('Main track is locked.');
   if(op.gaps!=='preserve'||!['reject','clear-boundaries'].includes(op.transitions))throw Error('Choose explicit gap and transition policies.');
   return {type:'reorder',clipId:op.clipId,beforeClipId:op.beforeClipId,gaps:'preserve',transitions:op.transitions};
  }
  if(!permissions.includes('clips.write'))throw Error('Permission denied: clips.write');
  keys(op,op?.type==='move'?['type','clipId','start_sec']:['type','clipId','start_sec','end_sec']);
  if(!['move','trim'].includes(op.type)||typeof op.clipId!=='string')throw Error('Unsupported clip edit operation.');
  const clip=clips.get(op.clipId),track=clip&&tracks.get(clip.trackId);
  if(!clip||!track||!EDITABLE_LANES.includes(track.lane)||clip.gap)throw Error('Target must be a returned overlay, audio, text or effect clip.');
  if(track.locked)throw Error('Target track is locked.');
  if(!time(op.start_sec))throw Error('Invalid clip start time.');
  const end=op.type==='move'?op.start_sec+clip.end_sec-clip.start_sec:op.end_sec;
  if(!time(end)||end-op.start_sec<0.1-1e-9||end>duration+1e-9)throw Error('Clip range must be at least 0.1 seconds and stay inside the project.');
  if(op.type==='trim'&&(op.start_sec<clip.start_sec-1e-9||end>clip.end_sec+1e-9))throw Error('Trim must remain inside the current clip range.');
  clip.start_sec=op.start_sec;clip.end_sec=end;
  return op.type==='move'?{type:'move',clipId:op.clipId,start_sec:op.start_sec}:{type:'trim',clipId:op.clipId,start_sec:op.start_sec,end_sec:end};
 });
 return {documentId:snapshot.documentId,revision:snapshot.revision,operations};
}
