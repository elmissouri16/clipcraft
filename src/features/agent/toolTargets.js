// Machine-readable targets of a tool call, for the timeline's agent spotlight and trail
// (Timeline.jsx agent-live / agent-done): which clips and time ranges a call works on — on the
// running event, from its arguments — and which it changed — on the done event, from the reducer
// actions it dispatched, a content diff of the project and the ids it created. Display strings
// stay in toolActivity.js; this carries only track names, clip ids and seconds. Bounded, never throws.
import { exportDuration, freeLen, videoLayout } from '../../state/store.js';

const TRACKS = { video: 'videoClips', overlay: 'overlayClips', audio: 'audioClips', text: 'textClips', effect: 'effectClips' };
const MAX_CLIPS = 40, MAX_RANGES = 12;
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const idOf = (v) => (typeof v === 'string' && v ? v.slice(0, 80) : null);
const list = (v) => (Array.isArray(v) ? v : []);
// Tools that place something new at start_sec (+ duration_sec) on a free track.
const PLACING = new Set(['add_text', 'add_effect', 'generate_image', 'add_voiceover', 'add_sound', 'add_stock', 'add_media', 'add_graphic']);
const DEFAULT_LENGTH = { add_text: 3, add_effect: 3 };

// Every clip with its timeline span: [{ track, id, clip, start, end }].
export function clipRows(p) {
  const rows = [];
  for (const row of videoLayout(p?.videoClips || [])) if (!row.clip.gap && row.clip.id) rows.push({ track: 'video', id: row.clip.id, clip: row.clip, start: row.start, end: row.end });
  for (const track of ['overlay', 'audio', 'text', 'effect']) {
    for (const clip of p?.[TRACKS[track]] || []) {
      if (!clip?.id) continue;
      const start = Number(clip.start) || 0, len = track === 'text' || track === 'effect' ? Number(clip.duration) || 0 : freeLen(track, clip);
      rows.push({ track, id: clip.id, clip, start, end: start + (Number.isFinite(len) ? len : 0) });
    }
  }
  return rows;
}
const indexRows = (p) => { const m = new Map(); for (const row of clipRows(p)) m.set(`${row.track}:${row.id}`, row); return m; };
const findRow = (index, id) => { for (const track of Object.keys(TRACKS)) { const row = index.get(`${track}:${id}`); if (row) return row; } return null; };
const pushRef = (out, seen, track, id) => { const key = `${track}:${id}`; if (!seen.has(key) && out.length < MAX_CLIPS) { seen.add(key); out.push({ track, id }); } };
const pushRange = (out, start, end) => { const s = num(start), e = num(end); if (s !== null && e !== null && e >= s && out.length < MAX_RANGES) out.push({ start: s, end: e }); };

// What a call is about to work on, from its arguments and the project before it ran.
export function argTargets(name, args = {}, before = {}) {
  const a = args || {}, index = indexRows(before), clips = [], seen = new Set(), ranges = [];
  let captions;
  for (const raw of [a.clip_id, ...list(a.clip_ids), ...list(a.target_clip_ids), ...list(a.speech_clip_ids)]) {
    const id = idOf(raw);
    if (!id) continue;
    if (id === 'captions') { captions = true; continue; }
    const row = findRow(index, id);
    if (row) pushRef(clips, seen, row.track, row.id);
  }
  const selected = idOf(a.clip_id) ? findRow(index, idOf(a.clip_id)) : null;
  const s = num(a.start_sec), e = num(a.end_sec), d = num(a.duration_sec);
  if (name === 'trim_clip' && selected) {
    // The slivers the trim removes, as activityEvidence shows them.
    const start = s ?? selected.start, end = e ?? selected.end;
    if (start > selected.start) pushRange(ranges, selected.start, Math.min(start, selected.end));
    if (end < selected.end) pushRange(ranges, Math.max(end, selected.start), selected.end);
  } else if (name === 'split_at') { const t = num(a.time_sec); if (t !== null) pushRange(ranges, t, t); }
  else if (name === 'delete_clip') { if (selected) pushRange(ranges, selected.start, selected.end); }
  else if (name === 'keep_ranges') { for (const r of list(a.ranges).slice(0, MAX_RANGES)) if (r) pushRange(ranges, r.start_sec, r.end_sec); }
  else if (Array.isArray(a.scenes)) { for (const scene of a.scenes.slice(0, MAX_RANGES)) { const ss = num(scene?.start_sec); if (ss !== null) pushRange(ranges, ss, ss + (num(scene?.duration_sec) ?? 0)); } }
  else if (s !== null && e !== null && e >= s) pushRange(ranges, s, e); // cut_range, zoom, review_section, scene analysis...
  else if (s !== null && PLACING.has(name) && a.as !== 'main') pushRange(ranges, s, s + (d ?? DEFAULT_LENGTH[name] ?? 0));
  return { clips, ranges, created: [], ...(captions ? { captions } : {}) };
}

// What the reducer actions of a call touched or created. `after` resolves tracks for new clips.
export function actionTargets(actions = [], after = {}) {
  const clips = [], created = [], seen = new Set(), seenNew = new Set();
  let captions;
  const touch = (track, id) => { if (TRACKS[track] && idOf(id)) pushRef(clips, seen, track, idOf(id)); };
  const make = (track, id) => { if (TRACKS[track] && idOf(id)) pushRef(created, seenNew, track, idOf(id)); };
  const trackOf = (id) => { for (const track of Object.keys(TRACKS)) if ((after?.[TRACKS[track]] || []).some((c) => c?.id === id)) return track; return null; };
  const visit = (action) => {
    if (!action || typeof action !== 'object') return;
    const a = action;
    switch (a.type) {
      case 'batch': list(a.actions).forEach(visit); break;
      case 'update': case 'delete': case 'trimClip': touch(a.track, a.id); break;
      case 'updateMany': list(a.updates).forEach((u) => touch(u?.track, u?.id)); break;
      case 'moveVideo': case 'retimeVideo': case 'retimeTransition': touch('video', a.id); break;
      case 'split': case 'duplicate': touch(a.track, a.id); make(a.track, a.newId); break;
      case 'addText': make('text', a.clipId); break;
      case 'addEffectClip': make('effect', a.clipId); break;
      case 'addOverlayClip': make('overlay', a.clipId); break;
      case 'addToTimeline': { const t = trackOf(a.clipId); if (t) make(t, a.clipId); break; }
      case 'insertAudioClip': make('audio', a.clip?.id); break;
      case 'extractAudio': touch(a.track, a.id); make('audio', a.newId); break;
      case 'moveToOverlay': touch('video', a.id); make('overlay', a.id); break;
      case 'moveToMain': touch('overlay', a.id); make('video', a.id); break;
      case 'paste': list(a.newIds).forEach((id) => make(a.track, id)); break;
      case 'appendCaptionTrack': list(a.clips).forEach(c=>make('text',c.id)); break;
      case 'replaceCaptionCues': { const kept = new Set(list(a.ids)); list(a.ids).forEach((id) => touch('text', id)); list(a.clips).forEach((c) => { if (c?.id && !kept.has(c.id)) make('text', c.id); }); break; }
      case 'setCaptions': case 'styleCaptions': case 'importSrtCaptions': case 'styleSrtCaptions': case 'removeSrtCaptions': captions = true; break;
      default: break;
    }
  };
  list(actions).forEach(visit);
  return { clips, created, ...(captions ? { captions } : {}) };
}

// Clips whose content or length changed between two projects, and new ones. A clip that only
// moved in time (the ripple after a cut) is not a change of that clip.
export function changedClipRefs(before = {}, after = {}) {
  const old = indexRows(before), next = indexRows(after), clips = [], created = [], seen = new Set(), seenNew = new Set();
  // Null and absent fields are the same content: reducers normalise untouched clips (e.g. transition: null).
  const fingerprint = (row) => {
    const entries = Object.entries(row.clip).filter(([key, value]) => key !== 'start' && value !== null && value !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `${JSON.stringify(entries)}|${(row.end - row.start).toFixed(4)}`;
  };
  for (const [key, row] of next) {
    const was = old.get(key);
    if (!was) pushRef(created, seenNew, row.track, row.id);
    else if (fingerprint(was) !== fingerprint(row)) pushRef(clips, seen, row.track, row.id);
  }
  return { clips, created };
}

// Where cuts happened, in the time of the project after the cut: one tick per seam.
function seamRanges(name, args = {}, after = {}) {
  const a = args || {}, out = [];
  if (name === 'cut_range') { const s = num(a.start_sec); if (s !== null) pushRange(out, Math.min(s, exportDuration(after)), Math.min(s, exportDuration(after))); }
  else if (name === 'keep_ranges') {
    const kept = list(a.ranges).map((r) => ({ start: num(r?.start_sec), end: num(r?.end_sec) })).filter((r) => r.start !== null && r.end !== null && r.end > r.start).sort((x, y) => x.start - y.start);
    let at = 0;
    kept.forEach((r, i) => { at += r.end - r.start; if (i < kept.length - 1) pushRange(out, at, at); });
  }
  return out;
}

// targets for a tool event. Running (no result): the arguments. Done: actions ∪ diff ∪ result ids.
// Returns undefined when there is nothing to show (reads, unchanged calls).
export function toolTargets(name, args = {}, before = {}, result, after = before, actions = []) {
  try {
    let targets;
    if (!result) targets = argTargets(name, args, before);
    else {
      const fromActions = actionTargets(actions, after), diff = changedClipRefs(before, after);
      const clips = [], created = [], seen = new Set(), seenNew = new Set();
      for (const ref of [...fromActions.clips, ...diff.clips]) pushRef(clips, seen, ref.track, ref.id);
      for (const ref of [...fromActions.created, ...diff.created]) pushRef(created, seenNew, ref.track, ref.id);
      const index = indexRows(after);
      const r = result && typeof result === 'object' ? result : {};
      for (const raw of [r.clip_id, ...list(r.results).map((x) => x?.clip_id), ...list(r.clips).map((x) => x?.clip_id)]) {
        const id = idOf(raw), row = id ? findRow(index, id) : null;
        if (row) pushRef(created, seenNew, row.track, row.id);
      }
      // A created clip is not also "changed".
      targets = { clips: clips.filter((ref) => !seenNew.has(`${ref.track}:${ref.id}`)), ranges: result.error ? [] : seamRanges(name, args, after), created, ...(fromActions.captions || args?.clip_id === 'captions' ? { captions: true } : {}) };
    }
    if (!targets.clips.length && !targets.ranges.length && !targets.created.length && !targets.captions) return undefined;
    return targets;
  } catch { return undefined; }
}
