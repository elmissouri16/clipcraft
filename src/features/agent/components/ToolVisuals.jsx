import React, { useEffect, useRef, useState } from 'react';
import { toFileUrl } from '../../../state/store.js';
import { safeLocalPath } from '../activityEvidence.js';
import { activityTime } from '../toolActivity.js';
import { formatElapsed, formatRemaining } from '../../export/exportProgress.js';
import { getPreviewAudio, setPreviewAudio, subscribePreviewAudio } from '../../audio/audioTap.js';
import { t, tn } from '../../../i18n/index.js';

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
    {unavailable?<div className="pilot-media-missing">{t('activity.preview_unavailable')}</div>:<img src={toFileUrl(src)} alt={media.label||t('activity.media_preview')} loading="lazy" decoding="async" onError={()=>setUnavailable(true)} />}
    <figcaption><b>{media.label||t('app.media')}</b><span>{activityTime(media.at_sec)}{Number.isFinite(media.duration_sec)?` · ${Number(media.duration_sec.toFixed(1))}s`:''}</span></figcaption>
  </figure>;
}
export function ToolMedia({ visuals, more=0 }) {
  if(!Array.isArray(visuals)||!visuals.length)return null;
  return <div className="pilot-media-gallery" aria-label={t('activity.media_involved_in_this_action')}>
    {visuals.slice(0,6).filter(v=>v&&typeof v==='object').map((media,i)=><Thumbnail key={`${media.src}:${i}`} media={media} />)}
    {more>0&&<span className="pilot-media-more">{tn('activity.plus_more',more)}</span>}
  </div>;
}
// Clip counts per track in a change summary (activityEvidence.js names the tracks).
const TRACK_CLIPS={Video:'activity.video_clips',Overlay:'activity.overlay_clips',Audio:'activity.audio_clips',Text:'activity.text_clips',Effects:'activity.effects_clips',Captions:'activity.caption_clips'};
export function ToolChange({ change, failed }) {
  if(!change||!Array.isArray(change.ranges))return null;
  const ranges=change.ranges.filter(r=>Number.isFinite(r?.start)&&Number.isFinite(r?.end)).slice(0,12);
  if(!ranges.length)return null;
  const width=change.window_end-change.window_start,keeping=change.kind==='keep',splitting=change.kind==='split';
  const verb=failed?t('activity.not_applied'):change.applied?(keeping?t('activity.kept'):splitting?t('activity.split'):t('activity.removed')):(keeping?t('activity.keep'):splitting?t('activity.split'):t('home.remove'));
  return <div className={`pilot-change ${keeping?'keep':''} ${failed?'not-applied':''}`}>
    <div className="pilot-change-heading"><b>{verb}{!splitting&&Number.isFinite(change.duration_sec)?` ${Number(change.duration_sec.toFixed(2))}s`:''}</b><span>{t('activity.original_timing')}</span></div>
    <div className="pilot-change-track" role="img" aria-label={t('activity.verb_ranges',{verb,ranges:ranges.map(r=>t('activity.start_to_end',{start:activityTime(r.start),end:activityTime(r.end)})).join(', ')})}>
      {width>0&&ranges.map((r,i)=><span key={i} style={{left:`${Math.max(0,Math.min(100,(r.start-change.window_start)/width*100))}%`,width:`${Math.max(.8,Math.min(100,(r.end-r.start)/width*100))}%`}} />)}
    </div>
    <div className="pilot-change-times"><span>{activityTime(ranges[0].start)}</span><span>{splitting?t('activity.split_point'):ranges.length>1?tn('activity.sections',ranges.length):activityTime(ranges[0].end)}</span></div>
    <div className="pilot-change-tracks">{Object.entries(change.tracks||{}).filter(([,n])=>Number.isFinite(n)).map(([track,n])=><span key={track}>{TRACK_CLIPS[track]?tn(TRACK_CLIPS[track],n):tn('activity.track_clips',n,{track:track.toLowerCase()})}</span>)}</div>
    {Array.isArray(change.clips)&&change.clips.length>0&&<details className="pilot-change-clips"><summary>{change.more_clips?tn('activity.affected_clips_plus_more',change.more_clips):t('activity.affected_clips')}</summary><ul>{change.clips.slice(0,4).map((c,i)=><li key={i}><span>{c.label}</span><small>{activityTime(c.start)} → {activityTime(c.end)}</small></li>)}</ul></details>}
  </div>;
}
export function ToolRender({ render, onCancel, review=false }) {
  if(!render||!Number.isFinite(render.progress))return null;
  const percent=Math.round(Math.max(0,Math.min(1,render.progress))*100);
  return <div className="pilot-inline-export" role="group" aria-label={review?t('activity.preview_rendering_progress'):t('export.export_progress')}>
    <div className="pilot-inline-export-heading"><strong>{render.stopping?t('activity.stopping_export'):render.stage||t('activity.preparing_export')}</strong><span>{percent}%</span></div>
    <progress value={percent} max={100} aria-label={review?t('activity.section_preview_progress'):t('activity.video_export_progress')} />
    <div className="pilot-inline-export-timing"><span>{formatRemaining(render.remainingSeconds)||(render.phase==='verify'?t('activity.checking_the_saved_file'):render.timingStatus||t('activity.estimating_time_remaining'))}</span>{Number.isFinite(render.elapsedSeconds)&&<span>{formatElapsed(render.elapsedSeconds)} {t('activity.elapsed')}</span>}</div>
    {onCancel&&render.phase!=='verify'&&!render.done&&<button type="button" className="pilot-export-cancel" onClick={onCancel} disabled={render.stopping}>{render.stopping?t('pilot.stopping_ellipsis'):review?t('activity.cancel_preview'):t('activity.cancel_export')}</button>}
  </div>;
}
export function ToolOutput({ artifact }) {
  const [unavailable,setUnavailable]=useState(false),file=safeLocalPath(artifact?.file),player=usePreviewListening();
  if(!file||!/\.(mp4|mov|mkv|webm)$/i.test(file))return null;
  return <div className="pilot-output" aria-label={artifact.review?t('activity.rendered_section'):t('activity.exported_video')}>
    {!unavailable?<video ref={player} className={artifact.review?'review-video':undefined} src={toFileUrl(file)} preload="metadata" controls controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture playsInline aria-label={t('activity.exported_video_preview')} onError={()=>setUnavailable(true)} />:<div className="pilot-output-unavailable">{t('activity.video_preview_unavailable')}</div>}
    <div className="pilot-output-info"><strong>{artifact.review?t('activity.section_preview'):artifact.name||file.split(/[\\/]/).at(-1)}</strong><span>{[Number.isFinite(artifact.duration_sec)?`${formatElapsed(artifact.duration_sec)}`:'',artifact.width&&artifact.height?`${artifact.width} × ${artifact.height}`:'',artifact.bytes?`${(artifact.bytes/1048576).toFixed(1)} MB`:''].filter(Boolean).join(' · ')}</span></div>
    <div className="pilot-output-actions"><button type="button" onClick={()=>window.api.openFile(file)}>{artifact.review?t('activity.open_preview'):t('activity.open_video')}</button>{!artifact.review&&<button type="button" onClick={()=>window.api.showInFolder(file)}>{t('activity.show_in_folder')}</button>}</div>
  </div>;
}
