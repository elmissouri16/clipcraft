// Saved chat display data: small, typed, local-only media references.
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,n):'';
const finite=(v,fallback=null)=>Number.isFinite(v)&&v>=0?v:fallback;
export const safeLocalPath=value=>typeof value==='string'&&value.length<4096&&(/^(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/.test(value))&&!/[\u0000-\u001f]/.test(value)?value:'';
export function normalizeRenderProgress(value={}) {
  return {progress:Math.min(1,finite(value.progress,0)),stage:text(value.stage,100),phase:text(value.phase,32),remainingSeconds:finite(value.remainingSeconds),elapsedSeconds:finite(value.elapsedSeconds),
    step:finite(value.step),steps:finite(value.steps),timingStatus:text(value.timingStatus,80),stopping:!!value.stopping,done:!!value.done};
}
export function normalizeToolActivity(value) {
  if(!record(value))return undefined;
  const output=Object.fromEntries(Object.entries({title:100,description:260,excerpt:1800,excerptLabel:64,outcome:220}).map(([key,n])=>[key,text(value[key],n)]));
  if(Array.isArray(value.visuals))output.visuals=value.visuals.slice(0,6).filter(v=>record(v)&&safeLocalPath(v.src)).map(v=>({src:safeLocalPath(v.src),label:text(v.label,80),type:['image','video','audio'].includes(v.type)?v.type:'image',at_sec:finite(v.at_sec),duration_sec:finite(v.duration_sec)}));
  if(Number.isFinite(value.more_visuals))output.more_visuals=Math.min(100000,Math.max(0,value.more_visuals));
  if(record(value.render))output.render=normalizeRenderProgress(value.render);
  if(record(value.progress)&&Number.isFinite(value.progress.total)&&value.progress.total>0)output.progress=Object.fromEntries(['total','completed','inserted','active','failed','elapsed_sec'].map(key=>[key,finite(value.progress[key],0)]));
  const c=value.change;
  if(record(c)&&Array.isArray(c.ranges)&&Number.isFinite(c.window_start)&&Number.isFinite(c.window_end)&&c.window_end>c.window_start){
    output.change={kind:['cut','keep','split'].includes(c.kind)?c.kind:'cut',ranges:c.ranges.slice(0,12).filter(r=>record(r)&&finite(r.start)!==null&&finite(r.end)!==null&&r.end>=r.start).map(r=>({start:r.start,end:r.end})),
      window_start:Math.max(0,c.window_start),window_end:c.window_end,duration_sec:finite(c.duration_sec,0),applied:!!c.applied,
      tracks:Object.fromEntries(Object.entries(record(c.tracks)?c.tracks:{}).filter(([key,n])=>['Video','Overlay','Audio','Captions','Text','Effects'].includes(key)&&Number.isFinite(n)).map(([key,n])=>[key,Math.max(0,Math.min(100000,n))])),
      clips:(Array.isArray(c.clips)?c.clips:[]).slice(0,4).filter(record).map(r=>({label:text(r.label,80),track:text(r.track,20),start:finite(r.start,0),end:finite(r.end,0)})),more_clips:finite(c.more_clips,0)};
  }
  const a=value.artifact;
  if(record(a)&&safeLocalPath(a.file)&&/\.(mp4|mov|mkv|webm)$/i.test(a.file))output.artifact={file:safeLocalPath(a.file),name:a.file.split(/[\\/]/).at(-1),bytes:finite(a.bytes,0),duration_sec:finite(a.duration_sec),width:finite(a.width),height:finite(a.height),fps:finite(a.fps),review:!!a.review};
  return output;
}
