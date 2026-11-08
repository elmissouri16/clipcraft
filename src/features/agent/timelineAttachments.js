// Serializable timeline references. This module deliberately has no editor-store dependency.
export const MAX_TIMELINE_ATTACHMENTS = 4;
export const MAX_CONTEXT_CLIPS = 32;
export const MAX_TIMELINE_CONTEXT_CHARS = 36000;
const TRACKS = new Set(['video','overlay','audio','text','effect']);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const text = (s, n=128) => typeof s === 'string' ? s.slice(0,n) : '';
const validId = s => typeof s === 'string' && s.length > 0 && s.length <= 128;
const time = n => Math.round(n * 1000000) / 1000000;
export const contextTime = n => { const s=Math.round(Math.max(0,Number(n)||0)*100);return `${String(Math.floor(s/6000)).padStart(2,'0')}:${((s%6000)/100).toFixed(2).padStart(5,'0')}`; };
export const timelineAttachmentLabel = a => `${a.kind==='range'?'Timeline range':`${a.clip_refs.length} ${a.clip_refs.length===1?'clip':'clips'}`} · ${contextTime(a.start_sec)}–${contextTime(a.end_sec)}`;
export function normalizeTimelineAttachments(value) {
  if(!Array.isArray(value))return [];
  const out=[],seen=new Set();
  for(const a of value){
    if(!a||typeof a!=='object'||!['range','clips'].includes(a.kind)||!validId(a.id)||!validId(a.project_id)||!finite(a.start_sec)||!finite(a.end_sec)||a.start_sec<0||a.end_sec<=a.start_sec||seen.has(a.id))continue;
    const refs=[],keys=new Set();
    for(const r of Array.isArray(a.clip_refs)?a.clip_refs:[]){const key=`${r?.track}:${r?.id}`;if(!TRACKS.has(r?.track)||!validId(r?.id)||keys.has(key))continue;keys.add(key);refs.push({track:r.track,id:r.id});if(refs.length===MAX_CONTEXT_CLIPS)break;}
    if(a.kind==='clips'&&!refs.length)continue;
    seen.add(a.id);out.push({id:text(a.id),project_id:text(a.project_id),kind:a.kind,start_sec:time(a.start_sec),end_sec:time(a.end_sec),clip_refs:a.kind==='clips'?refs:[],attached_revision:text(a.attached_revision,80)});
    if(out.length===MAX_TIMELINE_ATTACHMENTS)break;
  }
  return out;
}
const keyOf = a => JSON.stringify([a.project_id,a.kind,a.kind==='range'?[a.start_sec,a.end_sec]:a.clip_refs.map(r=>`${r.track}:${r.id}`).sort()]);
export function addTimelineAttachment(current, attachment) {
  const list=normalizeTimelineAttachments(current),next=normalizeTimelineAttachments([attachment])[0];
  if(!next)throw Error('That timeline selection is not available. Select it again.');
  const index=list.findIndex(a=>keyOf(a)===keyOf(next));
  if(index>=0)return list.map((a,i)=>i===index?{...next,id:a.id}:a);
  if(list.length>=MAX_TIMELINE_ATTACHMENTS)throw Error(`Attach up to ${MAX_TIMELINE_ATTACHMENTS} timeline parts. Remove one to add another.`);
  return [...list,next];
}
