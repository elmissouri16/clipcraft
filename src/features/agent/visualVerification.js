import { clipLen, projectDuration, videoLayout, renderable } from "../../state/store.js";

const visualClip = (clip, project) => {
  const { volume, muted, fadeIn, fadeOut, fadeInOffset, fadeOutOffset, audioFx, enhance, volumeKeys, ...visual } = clip;
  const m = project.media?.find(media => media.id === clip.mediaId);
  return JSON.stringify({ ...visual, source: m && { path: m.path, width: m.width, height: m.height, rotation: m.rotation, mtime: m.mtime, size: m.size } });
};
function regions(project) {
  return [
    ...videoLayout(project.videoClips || []).map(row => ({ key: `video:${row.clip.id}`, start: row.start, end: row.end, clip: row.clip })),
    ...(project.overlayClips || []).map(clip => ({ key: `overlay:${clip.id}`, start: clip.start, end: clip.start + clipLen(clip), clip })),
    ...['textClips', 'effectClips'].flatMap(track => (project[track] || []).map(clip => ({ key: `${track}:${clip.id}`, start: clip.start, end: clip.start + clip.duration, clip }))),
  ];
}
// Requirements refer to affected intervals, rather than accepting any frame at
// the latest revision. Removed/moved clips also require checking the old area.
export function changedVisualRegions(before, after) {
  before=renderable(before);after=renderable(after);
  const old = new Map(regions(before).map(region => [region.key, region]));
  const next = new Map(regions(after).map(region => [region.key, region]));
  const layers = p => {
    const occupied=new Set([...(p.videoClips.length?['video:0']:[]),...(p.overlayClips||[]).map(c=>`overlay:${c.layer??0}`),...(p.textClips||[]).map(c=>`text:${c.layer??0}`),...(p.effectClips?.length?['effect:0']:[])]);
    return Object.entries(p.layerState||{}).filter(([key])=>occupied.has(key));
  };
  const globalChange = ['width', 'height', 'background', 'fps'].some(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    || JSON.stringify(layers(before)) !== JSON.stringify(layers(after));
  const duration = projectDuration(after), fps = after.fps || 30, requirements = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(key), b = next.get(key);
    if (!globalChange && a && b && a.start === b.start && a.end === b.end && visualClip(a.clip, before) === visualClip(b.clip, after)) continue;
    for (const region of [a, b].filter(Boolean)) {
      const start = Math.max(0, region.start), end = Math.min(duration, region.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      // Animated changes must be checked near both ends as well as the middle.
      const animated = region.clip.keyframes || region.clip.anim;
      const spans = animated && end - start > 1 / fps * 3
        ? [[start, start + (end - start) / 3], [start + (end - start) / 3, start + (end - start) * 2 / 3], [start + (end - start) * 2 / 3, end]] : [[start, end]];
      for (const [from, to] of spans) {
        const time = Math.min((Math.ceil(to * fps) - 1) / fps, Math.max(Math.ceil(from * fps) / fps, Math.round((from + to) / 2 * fps) / fps));
        if (time >= from && time < to) requirements.push({ start: from, end: to, time });
      }
    }
  }
  if (globalChange && !requirements.length && duration > 0) requirements.push({ start: 0, end: duration, time: 0 });
  return [...new Map(requirements.map(region => [`${region.start}:${region.end}`, region])).values()].map(region => ({ ...region, checked: false }));
}
// A revision can change for audio or library operations. Preserve reviewed
// intervals unless their composition actually changed since the last check.
export function updateVisualRequirements(initial, before, after, previous) {
  const dirty = changedVisualRegions(before, after);
  return changedVisualRegions(initial, after).map(region => ({ ...region,
    checked: previous.some(old => old.checked && old.start === region.start && old.end === region.end && old.time === region.time)
      && !dirty.some(change => change.start < region.end && change.end > region.start),
  }));
}
export function markVisualCoverage(requirements, frames = []) {
  for (const requirement of requirements) if (frames.some(frame => ['timeline', 'rendered'].includes(frame.source) && Number.isFinite(frame.time_sec) && frame.time_sec >= requirement.start && frame.time_sec < requirement.end)) requirement.checked = true;
}
export function nextVisualSamples(requirements, limit = 6) {
  return [...new Set(requirements.filter(region => !region.checked).map(region => region.time))].slice(0, limit);
}
