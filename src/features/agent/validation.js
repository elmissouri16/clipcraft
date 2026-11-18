import { clipLen, cutOrigins, exportDuration, projectDuration, videoLayout } from "../../state/store.js";

const TRACKS = { video: 'videoClips', overlay: 'overlayClips', audio: 'audioClips', text: 'textClips', effect: 'effectClips' };
const lookup = (p, track, id) => (p[TRACKS[track]] || []).find(c => c.id === id);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Structural checks are evidence about timeline integrity, not aesthetic quality.
export function validateAgentProject(p) {
  const issues = [], warnings = [], seen = new Set(), links = new Map();
  const media = new Map((p.media || []).map(m => [m.id, m]));
  for (const [track, key] of Object.entries(TRACKS)) for (const c of p[key] || []) {
    const at = `${track}:${c.id}`;
    if (!c.id || seen.has(c.id)) issues.push(`${at}: missing or duplicate clip id.`);
    seen.add(c.id);
    if (track !== 'video' && (!Number.isFinite(c.start) || c.start < 0)) issues.push(`${at}: invalid timeline start.`);
    if (['video', 'overlay', 'audio'].includes(track)) {
      if (![c.in, c.out, c.speed ?? 1].every(Number.isFinite) || c.in < 0 || c.out <= c.in || (c.speed ?? 1) <= 0) issues.push(`${at}: invalid source range or speed.`);
      const m = media.get(c.mediaId);
      if (c.volumeKeys !== undefined && (!Array.isArray(c.volumeKeys) || c.volumeKeys.length > 512 || c.volumeKeys.some((k, i) => !k || !Number.isFinite(k.t) || k.t < 0 || !Number.isFinite(k.v) || k.v < 0 || k.v > 2 || i > 0 && k.t <= c.volumeKeys[i - 1].t))) issues.push(`${at}: invalid volume automation.`);
      if (!c.gap && !m) issues.push(`${at}: missing source media.`);
      if (m && m.type !== 'image' && Number.isFinite(m.duration) && c.out > m.duration + 0.05) issues.push(`${at}: source out exceeds media duration.`);
      if (c.linkId) {
        const pair = links.get(c.linkId) || { picture: [], audio: [] };
        (track === 'audio' ? pair.audio : pair.picture).push({ clip: c, track }); links.set(c.linkId, pair);
      }
    } else if (!Number.isFinite(c.duration) || c.duration <= 0) issues.push(`${at}: invalid duration.`);
    for (const keys of Object.values(c.keyframes || {})) if (!Array.isArray(keys) || keys.some(k => !Number.isFinite(k.t) || !Number.isFinite(k.v))) issues.push(`${at}: invalid keyframes.`);
    if (track === 'text' && c.words?.length) {
      let previous = -Infinity;
      for (const word of c.words) {
        if (![word.start, word.end].every(Number.isFinite) || word.start < 0 || word.end <= word.start || word.end > c.duration + 0.001 || word.start < previous) {
          issues.push(`${at}: word timestamps must be ordered and inside the caption duration.`); break;
        }
        previous = word.start;
      }
      if (c.words.map(word => word.text).join(' ').trim().replace(/\s+/g, ' ') !== String(c.text || '').trim().replace(/\s+/g, ' ')) warnings.push(`${at}: caption wording differs from its original timed transcript; review word alignment.`);
    }
  }
  const layout = videoLayout(p.videoClips || []);
  const starts = new Map(layout.map(l => [l.clip.id, l.start]));
  for (const [id, pair] of links) {
    if (pair.picture.length !== 1 || pair.audio.length !== 1) { issues.push(`link:${id}: requires one picture and one audio partner.`); continue; }
    const { clip: pic, track } = pair.picture[0], audio = pair.audio[0].clip;
    const start = track === 'video' ? starts.get(pic.id) : pic.start;
    if (Math.abs(audio.start - start - (audio.linkOff || 0)) > 0.001 || Math.abs(audio.in - pic.in - (audio.linkInOff || 0)) > 0.001 || Math.abs(audio.out - pic.out - (audio.linkInOff || 0)) > 0.001 || Math.abs((audio.speed || 1) - (pic.speed || 1)) > 0.001) issues.push(`link:${id}: picture and audio are out of sync.`);
  }
  const duration = exportDuration(p), extent = projectDuration(p);
  if (!Number.isFinite(duration) || !Number.isFinite(extent)) issues.push('Project duration is not finite.');
  const overruns = [];
  for (const track of ['overlay', 'audio', 'text', 'effect']) for (const c of p[TRACKS[track]] || []) {
    const end = c.start + (track === 'text' || track === 'effect' ? c.duration : clipLen(c));
    if (end > duration + 0.05) {
      const issue = `${track}:${c.id}: ends at ${end.toFixed(3)}s beyond the ${duration.toFixed(3)}s export. Extend the main track or trim this content explicitly.`;
      issues.push(issue);overruns.push({ track, id: c.id, by: end - duration, issue });
    }
  }
  const result = { ok: !issues.length, issues, warnings, export_duration_sec: duration, timeline_extent_sec: extent, checked_clips: seen.size };
  Object.defineProperty(result, 'overruns', { value: overruns }); // for newValidationIssues; not part of the reported result
  return result;
}

// The issues of `after` (a validateAgentProject result for `afterProject`) that `before` did not have.
// Content that already ran past the export stays the same issue while it runs no further past: a ripple
// cut moves it along with the end, and a piece cut from it (cutOrigins) is the same content.
export function newValidationIssues(before, after, afterProject) {
  const existing = new Set(before.issues), origins = cutOrigins(afterProject);
  const was = new Map((before.overruns || []).map(o => [`${o.track}:${o.id}`, o.by]));
  const known = (o) => {
    for (let id = o.id, n = 0; id && n < 64; id = origins?.get(id), n++) if (was.has(`${o.track}:${id}`)) return was.get(`${o.track}:${id}`);
    return undefined;
  };
  const kept = new Set((after.overruns || []).filter(o => { const by = known(o); return by !== undefined && o.by <= by + 0.05; }).map(o => o.issue));
  return after.issues.filter(issue => !existing.has(issue) && !kept.has(issue));
}

// Check the final requested fields, including multi-action tools whose later
// actions deliberately replace intermediate values.
export function verifyActionResults(p, actions, before) {
  const errors = [], patches = new Map();
  const need = (track, id) => { const c = lookup(p, track, id); if (!c) errors.push(`Expected ${track} clip ${id} was not created.`); return c; };
  for (const a of actions.flatMap(a => a.type === 'batch' ? a.actions : [a])) {
    if (a.type === 'update' || a.type === 'updateMany') for (const u of a.type === 'update' ? [a] : a.updates) {
      const key = `${u.track}:${u.id}`, previous = patches.get(key);
      patches.set(key, { track: u.track, id: u.id, patch: { ...previous?.patch, ...u.patch } });
    }
    if (a.type === 'delete' && lookup(p, a.track, a.id)) errors.push(`Clip ${a.id} was not deleted.`);
    if (a.type === 'addText') need('text', a.clipId);
    if (a.type === 'insertAudioClip') need('audio', a.clip.id);
    if (a.type === 'replaceCaptionCues' || a.type === 'appendCaptionTrack') {
      for (const c of a.clips) {
        const actual = need('text', c.id);
        if (actual && ['text', 'start', 'duration', 'layer', 'words'].some(key => !equal(actual[key], c[key]))) errors.push(`Caption ${c.id} did not reach the requested content/timing/layer.`);
      }
      for (const id of a.ids || []) if (!a.clips.some(c => c.id === id) && lookup(p, 'text', id)) errors.push(`Caption ${id} was not removed.`);
    }
    if (a.type === 'setMarkers' && !equal(p.markers,a.markers)) errors.push('The marker collection did not reach the requested state.');
    if (a.type === 'addEffectClip') need('effect', a.clipId);
    if (a.type === 'addOverlayClip') need('overlay', a.clipId);
    if (['split', 'duplicate'].includes(a.type)) need(a.track, a.newId);
    if (a.type === 'extractAudio') need('audio', a.newId);
    if (a.type === 'moveToOverlay') need('overlay', a.id);
    if (a.type === 'moveToMain') need('video', a.id);
    if (a.type === 'addToTimeline' && !Object.keys(TRACKS).some(t => lookup(p, t, a.clipId))) errors.push(`Clip ${a.clipId} was not added to the timeline.`);
    if (a.type === 'cutRanges' && before) {
      const total = exportDuration(before), cuts = [...a.ranges].sort((x, y) => x.start - y.start);
      let removed = 0, at = 0;
      for (const r of cuts) { const start = Math.max(0, at, r.start), end = Math.min(total, r.end); if (end > start) removed += end - start; at = Math.max(at, r.end); }
      if (Math.abs(exportDuration(p) - (total - removed)) > 0.001) errors.push('The range cut did not remove the requested timeline duration.');
    }
    if (a.type === 'moveVideo' && p.videoClips[Math.min(a.toIndex, p.videoClips.length - 1)]?.id !== a.id) errors.push(`Clip ${a.id} did not reach the requested order.`);
    if (a.type === 'styleCaptions') for (const c of p.textClips.filter(c => c.caption)) for (const [key, value] of Object.entries(a.patch)) if (!equal(c[key], value)) errors.push(`Caption ${c.id}: ${key} did not reach the requested value.`);
    if (a.type === 'setCaptions' && a.segments.some(s => !lookup(p, 'text', s.id))) errors.push('Requested captions were not installed.');
    if (a.type === 'setProject') for (const [key, value] of Object.entries(a.patch)) if (!equal(p[key], value)) errors.push(`Project ${key} did not reach the requested value.`);
  }
  for (const { track, id, patch } of patches.values()) {
    const c = need(track, id); if (!c) continue;
    for (const [key, value] of Object.entries(patch)) if (!equal(c[key], value)) errors.push(`Clip ${id}: ${key} did not reach the requested value.`);
  }
  return errors;
}
