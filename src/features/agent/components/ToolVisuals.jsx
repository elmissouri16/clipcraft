import React, { useEffect, useRef, useState } from 'react';
import { toFileUrl } from '../../../state/store.js';
import { safeLocalPath } from '../activityEvidence.js';
import { activityTime } from '../toolActivity.js';
import { formatElapsed, formatRemaining } from '../../export/exportProgress.js';
import { getPreviewAudio, setPreviewAudio, subscribePreviewAudio } from '../../audio/audioTap.js';

// Rendered videos in the chat play at the preview's listening volume, and changing the
// volume on either player changes it on both: one listening level for the whole app.
function usePreviewListening() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => { const a = getPreviewAudio(); el.volume = a.volume; el.muted = a.muted; };
    const changed = () => setPreviewAudio({ volume: el.volume, muted: el.muted });
    apply();
    el.addEventListener('volumechange', changed);
    const stop = subscribePreviewAudio(apply);
    return () => { el.removeEventListener('volumechange', changed); stop(); };
  });
  return ref;
}

function Thumbnail({ media }) {
  const [unavailable,setUnavailable]=useState(false),src=safeLocalPath(media.src);
  if(!src)return null;
  return <figure className="pilot-media-tile">
    {unavailable?<div className="pilot-media-missing">Preview unavailable</div>:<img src={toFileUrl(src)} alt={media.label||'Media preview'} loading="lazy" decoding="async" onError={()=>setUnavailable(true)} />}
    <figcaption><b>{media.label||'Media'}</b><span>{activityTime(media.at_sec)}{Number.isFinite(media.duration_sec)?` · ${Number(media.duration_sec.toFixed(1))}s`:''}</span></figcaption>
  </figure>;
}
export function ToolMedia({ visuals, more=0 }) {
  if(!Array.isArray(visuals)||!visuals.length)return null;
  return <div className="pilot-media-gallery" aria-label="Media involved in this action">
    {visuals.slice(0,6).filter(v=>v&&typeof v==='object').map((media,i)=><Thumbnail key={`${media.src}:${i}`} media={media} />)}
    {more>0&&<span className="pilot-media-more">+{more} more</span>}
  </div>;
}
export function ToolChange({ change, failed }) {
  if(!change||!Array.isArray(change.ranges))return null;
  const ranges=change.ranges.filter(r=>Number.isFinite(r?.start)&&Number.isFinite(r?.end)).slice(0,12);
  if(!ranges.length)return null;
  const width=change.window_end-change.window_start,keeping=change.kind==='keep',splitting=change.kind==='split';
  const verb=failed?'Not applied':change.applied?(keeping?'Kept':splitting?'Split':'Removed'):(keeping?'Keep':splitting?'Split':'Remove');
  return <div className={`pilot-change ${keeping?'keep':''} ${failed?'not-applied':''}`}>
    <div className="pilot-change-heading"><b>{verb}{!splitting&&Number.isFinite(change.duration_sec)?` ${Number(change.duration_sec.toFixed(2))}s`:''}</b><span>Original timing</span></div>
    <div className="pilot-change-track" role="img" aria-label={`${verb}: ${ranges.map(r=>`${activityTime(r.start)} to ${activityTime(r.end)}`).join(', ')}`}>
      {width>0&&ranges.map((r,i)=><span key={i} style={{left:`${Math.max(0,Math.min(100,(r.start-change.window_start)/width*100))}%`,width:`${Math.max(.8,Math.min(100,(r.end-r.start)/width*100))}%`}} />)}
    </div>
    <div className="pilot-change-times"><span>{activityTime(ranges[0].start)}</span><span>{splitting?'Split point':ranges.length>1?`${ranges.length} sections`:activityTime(ranges[0].end)}</span></div>
    <div className="pilot-change-tracks">{Object.entries(change.tracks||{}).filter(([,n])=>Number.isFinite(n)).map(([track,n])=><span key={track}>{n} {track==='Captions'?'caption':track.toLowerCase()}{n===1?' clip':' clips'}</span>)}</div>
    {Array.isArray(change.clips)&&change.clips.length>0&&<details className="pilot-change-clips"><summary>Affected clips{change.more_clips?` (+${change.more_clips} more)`:''}</summary><ul>{change.clips.slice(0,4).map((c,i)=><li key={i}><span>{c.label}</span><small>{activityTime(c.start)} → {activityTime(c.end)}</small></li>)}</ul></details>}
  </div>;
}
export function ToolRender({ render, onCancel, review=false }) {
  if(!render||!Number.isFinite(render.progress))return null;
  const percent=Math.round(Math.max(0,Math.min(1,render.progress))*100);
  return <div className="pilot-inline-export" role="group" aria-label={review?'Preview rendering progress':'Export progress'}>
    <div className="pilot-inline-export-heading"><strong>{render.stopping?'Stopping export…':render.stage||'Preparing export'}</strong><span>{percent}%</span></div>
    <progress value={percent} max={100} aria-label={review?'Section preview progress':'Video export progress'} />
    <div className="pilot-inline-export-timing"><span>{formatRemaining(render.remainingSeconds)||(render.phase==='verify'?'Checking the saved file':render.timingStatus||'Estimating time remaining')}</span>{Number.isFinite(render.elapsedSeconds)&&<span>{formatElapsed(render.elapsedSeconds)} elapsed</span>}</div>
    {onCancel&&render.phase!=='verify'&&!render.done&&<button type="button" className="pilot-export-cancel" onClick={onCancel} disabled={render.stopping}>{render.stopping?'Stopping…':review?'Cancel preview':'Cancel export'}</button>}
  </div>;
}
export function ToolOutput({ artifact }) {
  const [unavailable,setUnavailable]=useState(false),file=safeLocalPath(artifact?.file),player=usePreviewListening();
  if(!file||!/\.(mp4|mov|mkv|webm)$/i.test(file))return null;
  return <div className="pilot-output" aria-label={artifact.review?'Rendered section':'Exported video'}>
    {!unavailable?<video ref={player} className={artifact.review?'review-video':undefined} src={toFileUrl(file)} preload="metadata" controls playsInline aria-label="Exported video preview" onError={()=>setUnavailable(true)} />:<div className="pilot-output-unavailable">Video preview unavailable</div>}
    <div className="pilot-output-info"><strong>{artifact.review?'Section preview':artifact.name||file.split(/[\\/]/).at(-1)}</strong><span>{[Number.isFinite(artifact.duration_sec)?`${formatElapsed(artifact.duration_sec)}`:'',artifact.width&&artifact.height?`${artifact.width} × ${artifact.height}`:'',artifact.bytes?`${(artifact.bytes/1048576).toFixed(1)} MB`:''].filter(Boolean).join(' · ')}</span></div>
    <div className="pilot-output-actions"><button type="button" onClick={()=>window.api.openFile(file)}>{artifact.review?'Open preview':'Open video'}</button>{!artifact.review&&<button type="button" onClick={()=>window.api.showInFolder(file)}>Show in folder</button>}</div>
  </div>;
}
