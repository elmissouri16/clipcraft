import {EDITOR_LIMITS,EDITOR_LANES,editorChanges} from '../../../shared/pluginEditor.mjs';
import {videoLayout,freeLen,layerCount,clipLayer,layerStateOf} from '../../state/store.js';

// One instance per loaded document. Private keys never cross the sandbox bridge.
export function createEditorContext(){
 const documentId=`d-${crypto.randomUUID()}`,handles=new Map(),linkHandles=new Map();let serial=0,base,rows=[],groups=new Map(),counts,last,selectionKey,projection;
 const handle=key=>{if(!handles.has(key))handles.set(key,`c-${++serial}`);return handles.get(key);};
 const identity=(lane,id)=>JSON.stringify([lane,id]);
 const read=(project,selection,playhead)=>{
  if(project!==base){
   base=project;projection=null;
   rows=videoLayout(project.videoClips||[]).map(({clip,start,end,index,trans})=>({clip,lane:'video',layer:0,start,end,main:{index,transition:!!clip.transition&&clip.transition.type!=='none',overlap_sec:trans}}));
   for(const lane of EDITOR_LANES.slice(1))for(const clip of project[`${lane}Clips`]||[])rows.push({clip,lane,layer:clipLayer(lane,clip),start:clip.start,end:clip.start+freeLen(lane,clip)});
   rows=rows.filter(r=>typeof r.clip.id==='string'&&Number.isFinite(r.start)&&r.start>=0&&Number.isFinite(r.end)&&r.end>=r.start&&r.end<=1e9);
   groups=new Map();for(const lane of [...EDITOR_LANES,'sticker'])for(const clip of project[`${lane}Clips`]||[])if(typeof clip.linkId==='string'&&clip.linkId){if(!groups.has(clip.linkId))groups.set(clip.linkId,[]);groups.get(clip.linkId).push({lane,clip});if(!linkHandles.has(clip.linkId))linkHandles.set(clip.linkId,`l-${linkHandles.size+1}`);}
   counts=Object.fromEntries(EDITOR_LANES.map(lane=>[lane,['video','effect'].includes(lane)?1:Math.min(1e6,layerCount(project,lane))]));
  }
  const selected=new Set((selection?.items||(selection?[selection]:[])).map(s=>identity(s.track,s.id)));
  const key=JSON.stringify([...selected]);
  if(!projection||key!==selectionKey){
   selectionKey=key;
   const chosen=rows.filter(r=>selected.has(identity(r.lane,r.clip.id))),linked=new Set(chosen.filter(r=>groups.get(r.clip.linkId)?.length===2).map(r=>r.clip.linkId)),others=rows.filter(r=>!selected.has(identity(r.lane,r.clip.id)));
   const tracks=new Map(),clips=[],clipIds=[];
   const addTrack=(lane,layer)=>{
    const id=`${lane}:${layer}`;if(tracks.has(id))return id;if(tracks.size>=EDITOR_LIMITS.tracks)return null;
    const state=layerStateOf(project,lane,layer);tracks.set(id,{id,lane,layer,...Object.fromEntries(['locked','hidden','muted','solo'].map(k=>[k,!!state[k]]))});return id;
   };
   for(const r of [...chosen,...others.filter(r=>linked.has(r.clip.linkId)),...others.filter(r=>!linked.has(r.clip.linkId))]){
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
   projection={selection:{clipIds,total:chosen.length},timeline:{tracks:[...tracks.values()],tracks_total:Object.values(counts).reduce((a,b)=>a+b,0),clips,clips_total:rows.length,main_total:(project.videoClips||[]).length}};
  }
  const snapshot={version:1,documentId,revision:(last?.revision||0)+1,playhead:{time_sec:Math.max(0,Math.min(1e9,Number.isFinite(playhead.time_sec)?playhead.time_sec:0)),playing:!!playhead.playing},...projection};
  if(!last||editorChanges(last,snapshot).length)last=snapshot;
  return last;
 };
 read.targets=snapshot=>{
  if(snapshot.documentId!==documentId)throw Error('Editor document changed.');
  const reverse=new Map([...handles].map(([key,id])=>[id,key]));
  const links=new Map([...linkHandles].map(([raw,id])=>[id,raw]));
  return snapshot.timeline.clips.map(c=>{const key=reverse.get(c.id);if(!key)throw Error('Unknown editor handle.');const [track,id]=JSON.parse(key);return {handle:c.id,track,id,...(c.link?{linkGroup:c.link.groupId,linkId:links.get(c.link.groupId)}:{})};});
 };
 return read;
}
