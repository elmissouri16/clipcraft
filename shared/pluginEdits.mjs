// Bounded proposals only. Raw project IDs and reducer actions are never accepted.
import {editorSnapshot} from './pluginEditor.mjs';
export const MAX_CLIP_EDITS=64;
export const EDITABLE_LANES=Object.freeze(['overlay','audio','text','effect']);
const keys=(v,names)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!names.includes(k))||names.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid clip transaction fields.');};
const time=v=>Number.isFinite(v)&&v>=0&&v<=1e9;
export function clipTransaction(value,context,duration=1e9,permissions=['clips.write']){
 const snapshot=editorSnapshot(context);keys(value,['documentId','revision','operations']);
 if(value.documentId!==snapshot.documentId||value.revision!==snapshot.revision)throw Error('Clip transaction context is stale.');
 if(!Array.isArray(value.operations)||!value.operations.length||value.operations.length>MAX_CLIP_EDITS)throw Error('Stage 1–64 clip operations in one transaction.');
 const tracks=new Map(snapshot.timeline.tracks.map(t=>[t.id,t])),clips=new Map(snapshot.timeline.clips.map(c=>[c.id,{...c}]));
 const operations=value.operations.map(op=>{
  if(['split-linked','trim-linked'].includes(op?.type)){
   keys(op,op.type==='split-linked'?['type','clipId','partnerClipId','at_sec','gaps','transitions']:['type','clipId','partnerClipId','start_sec','end_sec','gaps','transitions']);
   if(!permissions.includes('clips.linked'))throw Error('Permission denied: clips.linked');
   const source=clips.get(op.clipId),partner=clips.get(op.partnerClipId);
   if(!source||!partner||!source.link||source.link.partnerId!==partner.id||partner.link?.partnerId!==source.id||source.link.groupId!==partner.link.groupId||source.link.members_total!==2)throw Error('Linked edits need both returned handles of one complete picture/audio pair.');
   if([source,partner].some(c=>tracks.get(c.trackId)?.locked))throw Error('A linked partner track is locked.');
   if(op.gaps!=='preserve-time'||!['reject','preserve-overlap'].includes(op.transitions))throw Error('Choose explicit linked gap and transition policies.');
   if(Math.abs(source.start_sec-partner.start_sec)>1e-8||Math.abs(source.end_sec-partner.end_sec)>1e-8)throw Error('Linked partners must have aligned timeline ranges.');
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
