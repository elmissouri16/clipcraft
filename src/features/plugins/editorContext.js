import {EDITOR_LIMITS,EDITOR_LANES,editorChanges} from '../../../shared/pluginEditor.mjs';
import {videoLayout,freeLen,layerCount,clipLayer,layerStateOf} from '../../state/store.js';

import {sameDoc} from '../../state/projectFile.js';
import {createProjectInspection} from './projectInspection.js';

// One instance per loaded document. Bounded edit snapshots keep private keys out;
// trusted complete inspection exposes saved content through separate read-only pages.
export function createEditorContext(){
 const documentId=`d-${crypto.randomUUID()}`,handles=new Map(),reverseHandles=new Map(),linkHandles=new Map(),reverseLinks=new Map(),inspection=createProjectInspection();let projectRevision=0,serial=0,base,rows=[],groups=new Map(),counts,last,selectionKey,projection;
 const handle=key=>{if(!handles.has(key)){const id=`c-${++serial}`;handles.set(key,id);reverseHandles.set(id,key);}return handles.get(key);};
 const identity=(lane,id)=>JSON.stringify([lane,id]);
 const read=(project,selection,playhead,input)=>{
  if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='clipIds')||!Array.isArray(input.clipIds)||input.clipIds.length>128||new Set(input.clipIds).size!==input.clipIds.length||input.clipIds.some(id=>typeof id!=='string'||!/^c-[1-9][0-9]{0,14}$/.test(id))))throw Error('Use at most 128 unique clip handles for an edit context');
  const documentChanged=!base||!sameDoc(base,project);
  if(project!==base){
   if(documentChanged)projectRevision++;base=project;projection=null;
   rows=videoLayout(project.videoClips||[]).map(({clip,start,end,index,trans})=>({clip,lane:'video',layer:0,start,end,main:{index,transition:!!clip.transition&&clip.transition.type!=='none',overlap_sec:trans}}));
   for(const lane of EDITOR_LANES.slice(1))for(const clip of project[`${lane}Clips`]||[])rows.push({clip,lane,layer:clipLayer(lane,clip),start:clip.start,end:clip.start+freeLen(lane,clip)});
   rows=rows.filter(r=>typeof r.clip.id==='string'&&Number.isFinite(r.start)&&r.start>=0&&Number.isFinite(r.end)&&r.end>=r.start&&r.end<=1e9);
   groups=new Map();for(const lane of [...EDITOR_LANES,'sticker'])for(const clip of project[`${lane}Clips`]||[])if(typeof clip.linkId==='string'&&clip.linkId){if(!groups.has(clip.linkId))groups.set(clip.linkId,[]);groups.get(clip.linkId).push({lane,clip});if(!linkHandles.has(clip.linkId)){const id=`l-${linkHandles.size+1}`;linkHandles.set(clip.linkId,id);reverseLinks.set(id,clip.linkId);}}
   counts=Object.fromEntries(EDITOR_LANES.map(lane=>[lane,['video','effect'].includes(lane)?1:Math.min(1e6,layerCount(project,lane))]));
  }
  const selected=new Set((selection?.items||(selection?[selection]:[])).map(s=>identity(s.track,s.id)));
  const key=JSON.stringify([...selected]);
  const projectRows=(priority=[])=>{
   const chosen=rows.filter(r=>selected.has(identity(r.lane,r.clip.id))),prioritySet=new Set(priority),priorityLinks=new Set(priority.filter(r=>groups.get(r.clip.linkId)?.length===2).map(r=>r.clip.linkId));
   const priorityPartners=rows.filter(r=>!prioritySet.has(r)&&priorityLinks.has(r.clip.linkId)),used=new Set([...priority,...priorityPartners]);
   const chosenRest=chosen.filter(r=>!used.has(r));for(const r of chosenRest)used.add(r);
   const linked=new Set(chosen.filter(r=>groups.get(r.clip.linkId)?.length===2).map(r=>r.clip.linkId)),others=rows.filter(r=>!used.has(r));
   const ordered=[...priority,...priorityPartners,...chosenRest,...others.filter(r=>linked.has(r.clip.linkId)),...others.filter(r=>!linked.has(r.clip.linkId))];
   const tracks=new Map(),clips=[],clipIds=[];
   const addTrack=(lane,layer)=>{
    const id=`${lane}:${layer}`;if(tracks.has(id))return id;if(tracks.size>=EDITOR_LIMITS.tracks)return null;
    const state=layerStateOf(project,lane,layer);tracks.set(id,{id,lane,layer,...Object.fromEntries(['locked','hidden','muted','solo'].map(k=>[k,!!state[k]]))});return id;
   };
   for(const r of ordered){
    if(clips.length>=EDITOR_LIMITS.clips)break;
    const trackId=addTrack(r.lane,r.layer);if(!trackId)continue;
    const id=handle(identity(r.lane,r.clip.id));clips.push({id,trackId,start_sec:r.start,end_sec:r.end,gap:!!r.clip.gap,...(r.main?{main:r.main}:{})});
    if(selected.has(identity(r.lane,r.clip.id))&&clipIds.length<EDITOR_LIMITS.selection)clipIds.push(id);
   }
   for(const lane of EDITOR_LANES)for(let layer=0;layer<counts[lane]&&tracks.size<EDITOR_LIMITS.tracks;layer++)addTrack(lane,layer);
   const returned=new Map(clips.map(c=>[c.id,c]));
   for(const r of rows){const group=groups.get(r.clip.linkId),id=handles.get(identity(r.lane,r.clip.id)),c=returned.get(id);if(!group||!c)continue;
    const other=group.length===2?group.find(m=>m.clip!==r.clip):null;
    const supported=other&&!r.clip.gap&&!other.clip.gap&&((r.lane==='audio'&&['video','overlay'].includes(other.lane))||(other.lane==='audio'&&['video','overlay'].includes(r.lane)));
    const partner=supported?handles.get(identity(other.lane,other.clip.id)):null;
    c.link={groupId:linkHandles.get(r.clip.linkId),partnerId:returned.has(partner)?partner:null,members_total:group.length};
   }
   return {selection:{clipIds,total:chosen.length},timeline:{tracks:[...tracks.values()],tracks_total:Object.values(counts).reduce((a,b)=>a+b,0),clips,clips_total:rows.length,main_total:(project.videoClips||[]).length}};
  }
  if(!projection||key!==selectionKey){selectionKey=key;projection=projectRows();}
  const snapshot={version:1,documentId,revision:(last?.revision||0)+1,playhead:{time_sec:Math.max(0,Math.min(1e9,Number.isFinite(playhead.time_sec)?playhead.time_sec:0)),playing:!!playhead.playing},...projection};
  if(!last||documentChanged||editorChanges(last,snapshot).length)last=snapshot;
  if(input?.clipIds.length){
   const byKey=new Map(rows.map(row=>[identity(row.lane,row.clip.id),row]));
   const priority=input.clipIds.map(id=>{const row=byKey.get(reverseHandles.get(id));if(!row)throw Error('Clip handle is unavailable in this document');return row;});
   const focused=projectRows(priority),returned=new Set(focused.timeline.clips.map(clip=>clip.id));if(input.clipIds.some(id=>!returned.has(id)))throw Error('Requested edit context exceeds the clip or track limits');
   return {...last,...focused};
  }
  return last;
 };
 read.scope=()=>({documentId,projectRevision});
 read.targets=snapshot=>{
  if(snapshot.documentId!==documentId)throw Error('Editor document changed.');
  return snapshot.timeline.clips.map(c=>{const key=reverseHandles.get(c.id);if(!key)throw Error('Unknown editor handle.');const [track,id]=JSON.parse(key);return {handle:c.id,track,id,...(c.link?{linkGroup:c.link.groupId,linkId:reverseLinks.get(c.link.groupId)}:{})};});
 };
 const model=(project,selection,playhead)=>{
  read(project,selection,playhead);
  const clipHandle=row=>handle(identity(row.lane,row.clip.id));
  const linkOf=row=>{const members=groups.get(row.clip.linkId);if(!members)return null;const other=members.length===2?members.find(member=>member.clip!==row.clip):null,supported=other&&!row.clip.gap&&!other.clip.gap&&((row.lane==='audio'&&['video','overlay'].includes(other.lane))||(other.lane==='audio'&&['video','overlay'].includes(row.lane)));return {groupId:linkHandles.get(row.clip.linkId),partnerId:supported?handle(identity(other.lane,other.clip.id)):null,members_total:members.length};};
  return {project,scope:{documentId,projectRevision},rows,counts,clipHandle,linkOf};
 };
 read.inspect=(project,selection,playhead,input)=>inspection.page(model(project,selection,playhead),input);
 read.readValue=(project,selection,playhead,input)=>inspection.readValue(model(project,selection,playhead),input);
 read.markerTargets=(project,selection,playhead,input)=>inspection.markerTargets(model(project,selection,playhead),input);
 return read;
}
