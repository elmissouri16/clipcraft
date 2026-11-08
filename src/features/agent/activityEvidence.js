import { clipLen, videoLayout } from '../../state/store.js';
import { safeLocalPath, normalizeRenderProgress } from './activityData.js';
export { safeLocalPath } from './activityData.js';

// Activity previews use existing local media. No image bytes, network URLs or
// additional footage-review service enter the chat/model context.
const label=(value,max=80)=>typeof value==='string'?value.trim().slice(0,max):'';
const rows=p=>[
  ...videoLayout(p?.videoClips||[]).map(r=>({...r,track:'Video'})),
  ...[['overlayClips','Overlay'],['audioClips','Audio'],['textClips','Text'],['effectClips','Effects']].flatMap(([key,track])=>(p?.[key]||[]).map(clip=>({clip,track:key==='textClips'&&clip.caption?'Captions':track,start:clip.start,end:clip.start+(['Overlay','Audio'].includes(track)?clipLen(clip):clip.duration)}))),
];
function visual(p,row) {
  const m=p.media?.find(m=>m.id===row.clip.mediaId);if(!m)return null;
  const src=safeLocalPath(m.poster)||(m.type==='image'?safeLocalPath(m.path):m.type==='audio'?safeLocalPath(m.wave):'');
  if(!src)return null;
  return {src,label:label(row.clip.name||m.name)||'Media',type:m.type,at_sec:row.start,duration_sec:row.end-row.start};
}
export function activityEvidence(name,args={},before={},result,after=before) {
  const a=args||{},r=result||{},old=rows(before),next=rows(after);let visuals=[],change;
  if(['cut_range','keep_ranges','delete_clip','trim_clip','split_at'].includes(name)){
    const selected=old.find(row=>row.clip.id===a.clip_id);
    let ranges=[],kind=name==='keep_ranges'?'keep':name==='split_at'?'split':'cut';
    if(name==='cut_range')ranges=[{start:a.start_sec,end:a.end_sec}];
    else if(name==='keep_ranges')ranges=(a.ranges||[]).map(r=>({start:r.start_sec,end:r.end_sec}));
    else if(name==='delete_clip'&&selected)ranges=[{start:selected.start,end:selected.end}];
    else if(name==='split_at'&&selected)ranges=[{start:a.time_sec,end:a.time_sec}];
    else if(name==='trim_clip'&&selected){
      const start=a.start_sec??selected.start,end=a.end_sec??selected.end;
      if(start>selected.start)ranges.push({start:selected.start,end:Math.min(start,selected.end)});
      if(end<selected.end)ranges.push({start:Math.max(end,selected.start),end:selected.end});
    }
    ranges=ranges.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.start>=0&&r.end>=r.start).slice(0,12);
    if(kind!=='split')ranges=ranges.sort((a,b)=>a.start-b.start).reduce((out,range)=>{
      const last=out.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else out.push({...range});return out;
    },[]);
    if(ranges.length){
      const affected=old.filter(row=>!row.clip.gap&&ranges.some(r=>kind==='split'?row.start<=r.start&&row.end>r.start:row.start<r.end&&row.end>r.start));
      const totals=Object.fromEntries([...new Set(affected.map(row=>row.track))].map(track=>[track,affected.filter(row=>row.track===track).length]));
      const first=Math.min(...ranges.map(r=>r.start)),last=Math.max(...ranges.map(r=>r.end)),pad=Math.max(1,Math.min(5,(last-first)/2));
      const extent=Math.max(last,...old.map(r=>r.end).filter(Number.isFinite));
      change={kind,ranges,window_start:Math.max(0,first-pad),window_end:Math.min(extent,last+pad),duration_sec:ranges.reduce((n,r)=>n+r.end-r.start,0),tracks:totals,
        clips:affected.slice(0,4).map(row=>({label:label(row.clip.text||row.clip.name||before.media?.find(m=>m.id===row.clip.mediaId)?.name)||row.track,track:row.track,start:row.start,end:row.end})),
        more_clips:Math.max(0,affected.length-4),applied:!!r.changed};
      visuals=affected.map(row=>visual(before,row)).filter(Boolean);
    }
  }
  if(!change){
    const ids=new Set([r.clip_id,...(Array.isArray(r.results)?r.results:[]).filter(x=>x&&(!x.error||x.changed)).map(x=>x.clip_id),...(Array.isArray(r.clips)?r.clips:[]).map(x=>x?.clip_id)].filter(Boolean));
    if(['generate_image','generate_images'].includes(name)&&!result){
      const previous=new Set(old.map(row=>row.clip.id));next.filter(row=>!previous.has(row.clip.id)).forEach(row=>ids.add(row.clip.id));
    }
    if(!ids.size&&a.clip_id)ids.add(a.clip_id);
    visuals=next.filter(row=>ids.has(row.clip.id)).map(row=>visual(after,row)).filter(Boolean);
    if(name==='import_media')for(const item of r.media||[]){const m=after.media?.find(m=>m.id===item.media_id);if(m)visuals.push(visual(after,{clip:{mediaId:m.id},start:0,end:m.duration||0}));}
  }
  visuals=[...new Map(visuals.filter(Boolean).map(v=>[`${v.src}:${v.at_sec}`,v])).values()];
  let artifact;
  const file=safeLocalPath(r.file||r.artifact?.path);
  if(['export_video','review_section'].includes(name)&&file&&/\.(mp4|mov|mkv|webm)$/i.test(file)&&(!r.error||r.completed)){
    const metadata=r.metadata||r.artifact||{};
    artifact={file,name:file.split(/[\\/]/).at(-1),bytes:r.size||r.artifact?.bytes||0,duration_sec:metadata.duration_sec,width:metadata.width,height:metadata.height,fps:metadata.fps,review:name==='review_section'};
  }
  return {...(visuals.length?{visuals:visuals.slice(0,6),more_visuals:Math.max(0,visuals.length-6)}:{}),...(change?{change}:{}),...(artifact?{artifact}:{})};
}

export function renderActivityProgress(value) {
  return normalizeRenderProgress(value);
}
