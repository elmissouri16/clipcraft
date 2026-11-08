import { videoLayout, clipLen, layerStateOf } from "../../state/store.js";

// Source shot IDs are stable; occurrences and timing always come from the live
// project. Layer eligibility is not proof of visibility through masks/overlays.
export function projectScenes(project, indexes, { scope = 'timeline', clip_ids, media_ids, transcript = [] } = {}) {
  const sources = indexes instanceof Map ? indexes : new Map(Object.entries(indexes));
  const selectedClips = clip_ids?.length ? new Set(clip_ids) : null;
  const selectedMedia = media_ids?.length ? new Set(media_ids) : null;
  const rows = [];
  const add = (media, clip, track, start, end, transition) => {
    if (selectedMedia && !selectedMedia.has(media.id)) return;
    if (clip && selectedClips && !selectedClips.has(clip.id)) return;
    const index = sources.get(media.id); if (!index) return;
    for (const shot of index.shots) {
      const staticImage = media.type === 'image';
      const a = clip ? staticImage ? clip.in : Math.max(shot.start_sec, clip.in) : shot.start_sec;
      const b = clip ? staticImage ? clip.out : Math.min(shot.end_sec, clip.out) : shot.end_sec;
      if (clip && b <= a) continue;
      const layer = clip?.layer || 0, state = clip ? layerStateOf(project, track, layer) : {};
      const from = clip ? start + (a - clip.in) / (clip.speed || 1) : a;
      const to = clip ? start + (b - clip.in) / (clip.speed || 1) : b;
      const speech = clip ? transcript.filter(s => s.start < to && s.end > from).map(s => s.text).join(' ') : '';
      rows.push({ scene_id: `${track}:${clip?.id || media.id}:${shot.id}`, shot_id: shot.id, analysis_id: index.analysis_id,
        source_fingerprint: index.fingerprint, media_id: media.id, media_name: media.name, ...(clip ? { clip_id: clip.id } : {}), track, layer,
        source_start_sec: staticImage ? 0 : a, source_end_sec: staticImage ? 0 : b, start_sec: from, end_sec: to,
        static: staticImage, disabled: !!clip?.disabled, hidden: !!state.hidden, eligible_for_display: !clip?.disabled && !state.hidden,
        ...(transition ? { transition_in: transition } : {}), ...(shot.observation ? { observation: shot.observation } : {}),
        ...(speech ? { speech_excerpt: speech } : {}),
      });
    }
  };
  if (scope === 'media') for (const media of project.media) add(media, null, 'media', 0, media.duration || 0);
  else {
    for (const item of videoLayout(project.videoClips)) {
      if (item.clip.gap) { if (!selectedClips || selectedClips.has(item.clip.id)) rows.push({ scene_id:`gap:${item.clip.id}`,clip_id:item.clip.id,track:'video',layer:0,type:'gap',start_sec:item.start,end_sec:item.end }); continue; }
      const media = project.media.find(m => m.id === item.clip.mediaId);
      if (media) add(media, item.clip, 'video', item.start, item.end, item.trans ? { ...item.clip.transition, overlap_sec:item.trans } : null);
    }
    for (const clip of project.overlayClips || []) { const media = project.media.find(m => m.id === clip.mediaId); if (media) add(media, clip, 'overlay', clip.start, clip.start + clipLen(clip)); }
  }
  return rows.sort((a,b) => a.start_sec - b.start_sec || a.layer - b.layer || a.scene_id.localeCompare(b.scene_id));
}
export function filterScenes(scenes, { query, start_sec, end_sec, scene_ids } = {}) {
  const selected = scene_ids?.length ? new Set(scene_ids) : null;
  const q = String(query || '').trim().toLowerCase();
  return scenes.filter(scene => {
    const point = scene.static && scene.track === 'media';
    return (!selected || selected.has(scene.scene_id)) &&
      (start_sec === undefined || (point ? scene.start_sec >= start_sec : scene.end_sec > start_sec)) &&
      (end_sec === undefined || scene.start_sec < end_sec) &&
      (!q || [scene.observation?.description, ...(scene.observation?.tags || []), scene.speech_excerpt].filter(Boolean).join(' ').toLowerCase().includes(q));
  });
}
export function storyboardSamples(scenes, { source = 'timeline', interval_sec = 10, start_sec, end_sec } = {}) {
  if (!['timeline','clip','media'].includes(source)) throw new Error('Storyboard source must be timeline, clip or media.');
  if (!Number.isFinite(interval_sec) || interval_sec < 0.25 || interval_sec > 60) throw new Error('interval_sec must be 0.25–60.');
  const samples=[];
  for (const scene of scenes) {
    if (scene.type === 'gap' || (source === 'media' && !scene.media_id) || (source !== 'media' && scene.track === 'media')) continue;
    const from = Math.max(scene.start_sec, start_sec ?? scene.start_sec), to = Math.min(scene.end_sec, end_sec ?? scene.end_sec);
    if (!scene.static && to <= from) continue;
    const sourceScale = scene.end_sec > scene.start_sec ? (scene.source_end_sec - scene.source_start_sec) / (scene.end_sec - scene.start_sec) : 0;
    const a = source === 'media' ? scene.source_start_sec + (from - scene.start_sec) * sourceScale : from;
    const b = source === 'media' ? scene.source_start_sec + (to - scene.start_sec) * sourceScale : to;
    const count = scene.static ? 1 : Math.max(1, Math.ceil((b-a)/interval_sec));
    for (let i=0;i<count;i++) samples.push({ scene_id:scene.scene_id, shot_id:scene.shot_id, media_id:scene.media_id,
      ...(scene.clip_id ? {clip_id:scene.clip_id} : {}), source, time_sec:scene.static && source==='media'?0:a+(b-a)*(i+0.5)/count });
  }
  return samples;
}
