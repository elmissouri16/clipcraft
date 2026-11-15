import {clipTransaction,EDITABLE_LANES} from '../../shared/pluginEdits.mjs';
import {uniqueCommandMarkers} from '../../shared/pluginCommands.mjs';
import {translationSnapshot,translationProposal,translationLanguage,sourceTrack} from '../../shared/pluginAi.mjs';
import {TEXT_TEMPLATES} from '../features/text/catalog.js';
import {isPluginTransition,pluginTransitionInstance} from '../features/plugins/transitionRegistry.js';
import {isPluginEffect,pluginEffectInstance} from '../features/plugins/effectRegistry.js';
// Project model + reducer (with undo/redo).
//
// The main (video) track plays clips back to back, so a clip's timeline position is derived from order.
// With the track magnet OFF, deleting or trimming leaves a "gap" clip ({ gap: true }) so later clips stay put;
// with it ON the track closes up the way the main track does. Audio / text clips have a free `start`;
// their magnet snaps drags to neighbours and closes the gap after a delete or trim (ripple).
// Overlay clips (picture-in-picture) are videos / photos with a free `start` drawn above the main track.

import { RATIOS, sizeFor } from "../features/effects/effects.js";
import { cleanPins } from "../features/timeline/track.js";
import { normalizeChatSessions } from "../features/agent/chatSessions.js";
import { editWordTiming, cropWordTiming, captionWordTiming } from "../features/text/timing.js";
import { sliceFades } from "../features/audio/fades.js";
import { markProjectSnapshot } from './projectIdentity.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const MIN_CLIP = 0.1;

// The project format closest to a width x height picture, or null when its size is unknown.
export function ratioFor(w, h) {
  if (!w || !h) return null;
  const d = (r) => Math.abs(Math.log(w / h) - Math.log(RATIOS[r][0] / RATIOS[r][1]));
  return Object.keys(RATIOS).reduce((best, r) => (d(r) < d(best) ? r : best));
}

export function emptyProject() {
  return {
    // A stable identity for the per-project autosave store (electron/project/autosave.cjs): it is
    // born with the project, survives saves/loads (normalizeProject keeps a stored id and
    // mints one for older files), and keys the project's slot on the Home switchboard.
    id: uid(),
    name: 'Untitled', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    media: [], videoClips: [], overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    effectClips: [], // effects on the Effects track: { id, fx, start, duration }
    // Text clips are time-anchored overlays (e.g. captions), so they start with the magnet off.
    magnet: { video: true, overlay: false, audio: true, text: false },
    // Per-layer state (lock / hide / mute / solo), keyed "track:layer" — see layerStateOf.
    // Only layers that differ from the defaults get an entry. NOT part of undo history:
    // toggling a lock must never be an undoable document edit (industry standard).
    layerState: {},
    markers: [], // [{ id, time, label }] timeline flags
    snapping: true, // drags snap to clip edges, the playhead and markers
  };
}

// Validate containers before the project reaches the reducer or render tree. Missing
// fields remain legal for older files; unknown fields survive normalization.
export function validateProject(p) {
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const invalid = (field) => { throw new Error(`Invalid project field: ${field}`); };
  if (!record(p)) invalid('project');
  const nullable = new Set(['overlayClips', 'effectClips', 'markers']);
  for (const key of ['media', 'videoClips', 'audioClips', 'textClips', ...nullable]) {
    const list = p[key];
    if (list === undefined || (list === null && nullable.has(key))) continue;
    if (!Array.isArray(list)) invalid(key);
    for (const item of list) {
      if (!record(item)) invalid(`${key} entry`);
      for (const field of ['in', 'out', 'start', 'duration', 'speed', 'layer']) {
        if (item[field] !== undefined && (typeof item[field] !== 'number' || !Number.isFinite(item[field]))) invalid(`${key}.${field}`);
      }
      if (item.speed !== undefined && item.speed <= 0) invalid(`${key}.speed`);
      if (item.layer !== undefined && (!Number.isInteger(item.layer) || item.layer < 0)) invalid(`${key}.layer`);
      if (item.effects != null && !Array.isArray(item.effects)) invalid(`${key}.effects`);
      for (const field of ['path', 'text']) {
        if (item[field] !== undefined && typeof item[field] !== 'string') invalid(`${key}.${field}`);
      }
    }
  }
  for (const key of ['name', 'id', 'ratio', 'background']) {
    if (p[key] !== undefined && typeof p[key] !== 'string') invalid(key);
  }
  for (const key of ['width', 'height', 'fps', 'resolution']) {
    if (p[key] !== undefined && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0)) invalid(key);
  }
  for (const key of ['magnet', 'layerState', 'layers']) {
    if (p[key] != null && !record(p[key])) invalid(key);
  }
  return p;
}

// Older project files lack the newer fields.
export function normalizeProject(p) {
  validateProject(p);
  const base = emptyProject();
  const without = (item, field) => {
    if (!Object.hasOwn(item, field)) return item;
    const copy = { ...item };
    delete copy[field];
    return copy;
  };
  return {
    ...base, ...p,
    // R1 (2026-11-01): the Stickers feature was removed. Projects saved before the removal
    // may still carry stickerClips — they are DROPPED here, so an old file loads cleanly
    // with everything else intact and no sticker lane anywhere.
    stickerClips: [],
    // Automatic AI removal was retired; old projects use the original media.
    media: (p.media || []).map(item => without(item, 'matte')),
    videoClips: (p.videoClips || []).map(item => without(item, 'bgRemove')),
    overlayClips: (p.overlayClips || []).map(item => without(item, 'bgRemove')),
    effectClips: p.effectClips || [],
    magnet: { ...base.magnet, ...(p.magnet || {}) },
    markers: p.markers || [],
    snapping: p.snapping ?? true,
    craftAI: normalizeChatSessions(p.craftAI),
  };
}

export const newGap = (id, len) => ({ id, gap: true, in: 0, out: len, speed: 1 });

// Merges neighbouring gaps, drops empty ones and removes a trailing gap (nothing plays after it).
function normalizeGaps(list, { keepTrailing = false } = {}) {
  const out = [];
  for (const c of list) {
    if (c.gap) {
      const len = c.out - c.in;
      if (len < 0.02) continue;
      const last = out[out.length - 1];
      if (last && last.gap) {
        out[out.length - 1] = { ...last, out: last.out + len };
        continue;
      }
    }
    out.push(c);
  }
  while (!keepTrailing && out.length && out[out.length - 1].gap) out.pop();
  return out;
}

// Length of a clip on a free track (overlay / audio / text). Audio clips carry a
// constant speed like picture clips do (a detached clip follows its video's speed).
export const freeLen = (track, c) => (track === 'audio' ? (c.out - c.in) / (c.speed || 1) : track === 'overlay' ? (c.out - c.in) / (c.speed || 1) : c.duration);

export const clipLen = (c) => (c.out - c.in) / (c.speed || 1);

// Layers: every clip of a free track sits on a layer, 0 being the one next to the main track.
// Clips of one layer never overlap; a clip that would is moved to the first free layer. A higher overlay, text or
// layer is drawn above a lower one. Layers stay when they become empty (project.layers counts them).
export const LAYERED = { overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' };
export const layerOf = (c) => c.layer ?? 0;

export function layerCount(p, track) {
  const used = (p[LAYERED[track]] || []).reduce((n, c) => Math.max(n, layerOf(c) + 1), 1);
  return Math.max(used, p.layers?.[track] || 1);
}

// Display name of one layer: the user's rename (project.layerNames) or the lane's default.
const LANE_NAMES = { video: 'Main', overlay: 'Overlay', text: 'Text', audio: 'Audio', effect: 'Effects' };
export function layerName(p, track, layer) {
  return (p.layerNames && p.layerNames[track] && p.layerNames[track][layer]) || `${LANE_NAMES[track] || track} ${layer + 1}`;
}

// ---- Layer state: lock / hide / mute / solo, one entry per layer ("track:layer") ----
// The main track is the single layer video:0; the Effects lane (not a layered lane in the
// model) is effect:0. Lanes whose clips can carry sound — and therefore answer to mute /
// solo — are video (its clips' own sound), overlay (picture clips with sound) and audio.
export const LAYER_STATE_DEFAULTS = { locked: false, hidden: false, muted: false, solo: false };
export const layerKey = (track, layer) => `${track}:${layer}`;
export function layerStateOf(p, track, layer) {
  return { ...LAYER_STATE_DEFAULTS, ...((p.layerState || {})[layerKey(track, layer)] || {}) };
}
export const isLayerLocked = (p, track, layer) => layerStateOf(p, track, layer).locked;
export const AUDIO_LANES = { video: true, overlay: true, audio: true };
// The layer a clip sits on: layered lanes read clip.layer; every other track has layer 0.
export const clipLayer = (track, c) => (LAYERED[track] ? layerOf(c) : 0);
export const clipLocked = (p, track, c) => !!c && isLayerLocked(p, track, clipLayer(track, c));
// removeMedia deletes every clip that uses the item, so it answers to the same lock as a
// delete: the first use of the item that sits on a locked layer, or null. The library UI
// names this layer when it refuses the removal.
export function lockedMediaUse(p, mediaId) {
  const lists = [['video', p.videoClips], ['overlay', p.overlayClips || []], ['audio', p.audioClips]];
  for (const [track, list] of lists) {
    for (const c of list) {
      if (c.mediaId === mediaId && clipLocked(p, track, c)) return { track, layer: clipLayer(track, c) };
    }
  }
  return null;
}
// True when any audio-capable layer is soloed (solo then decides what sounds at all).
export function anySolo(p) {
  const ls = p.layerState || {};
  return Object.entries(ls).some(([k, s]) => s && s.solo && AUDIO_LANES[k.split(':')[0]]);
}
// Does this layer's sound reach the mix? Mute silences it; once anything is soloed,
// only soloed layers sound.
export function layerSounds(p, track, layer) {
  const st = layerStateOf(p, track, layer);
  if (st.muted) return false;
  return !anySolo(p) || st.solo;
}

// Remaps the layerState keys of one track through fn(oldLayer) -> newLayer | null (drop),
// the same permutation a layer operation applies to the clips and their names.
function remapLayerState(p, track, fn) {
  const ls = p.layerState || {};
  const prefix = `${track}:`;
  if (!Object.keys(ls).some((k) => k.startsWith(prefix))) return p.layerState;
  const out = {};
  for (const [k, v] of Object.entries(ls)) {
    if (!k.startsWith(prefix)) { out[k] = v; continue; }
    const n = fn(Number(k.slice(prefix.length)));
    if (n !== null && n !== undefined) out[layerKey(track, n)] = v;
  }
  return out;
}

// True when [start, start + len) is free on that layer (the clip `exceptId` aside).
export function layerFree(p, track, layer, start, len, exceptId) {
  return !(p[LAYERED[track]] || []).some((x) => x.id !== exceptId && layerOf(x) === layer
    && x.start < start + len - 1e-6 && start < x.start + freeLen(track, x) - 1e-6);
}

// Gives every clip a layer where it fits, keeps the lists in drawing order (by layer) and the layer counts.
// Returns p itself when nothing changes. Old projects (no layers) get the rows they used to show.
function placeLayers(p, previous) {
  let out = p;
  for (const [track, key] of Object.entries(LAYERED)) {
    const list = p[key] || [];
    const old = previous?.[key];
    // Look/text changes cannot alter placement. Preserve the normalized arrays
    // and skip overlap searches on unaffected tracks and geometry-only equals.
    if (old && (p.layers?.[track] || 1) === (previous.layers?.[track] || 1)
      && (list === old || (list.length === old.length && list.every((c, i) => c.id === old[i].id && c.layer === old[i].layer
        && c.start === old[i].start && freeLen(track, c) === freeLen(track, old[i]))))) continue;
    const placed = []; // [layer][]{ start, end }
    const position = (list, start) => {
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].start < start) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const fits = (l, a, b) => {
      const intervals = placed[l] || [], at = position(intervals, a);
      return ![intervals[at - 1], intervals[at]].some(r => r && r.start < b - 1e-6 && a < r.end - 1e-6);
    };
    const order = [...list].sort((a, b) => (a.layer === undefined) - (b.layer === undefined) || a.start - b.start);
    const layerById = {};
    for (const c of order) {
      const a = c.start;
      const b = c.start + freeLen(track, c);
      let l = layerOf(c);
      while (!fits(l, a, b)) l++;
      const intervals = placed[l] ||= [];
      intervals.splice(position(intervals, a), 0, { start: a, end: b });
      layerById[c.id] = l;
    }
    let changed = false;
    let next = list.map((c) => {
      if (c.layer === layerById[c.id]) return c;
      changed = true;
      return { ...c, layer: layerById[c.id] };
    });
    if (next.some((c, i) => i && layerOf(next[i - 1]) > layerOf(c))) {
      next = next.map((c, i) => [c, i]).sort((x, y) => layerOf(x[0]) - layerOf(y[0]) || x[1] - y[1]).map((x) => x[0]);
      changed = true;
    }
    const count = Math.max(placed.length, p.layers?.[track] || 1);
    if (changed) out = { ...out, [key]: next };
    if ((out.layers?.[track] || 1) !== count) out = { ...out, layers: { ...out.layers, [track]: count } };
  }
  return out;
}

// Transition length into clip i, limited to half of either neighbouring clip.
export function transitionDur(clips, i) {
  const t = clips[i]?.transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  // Range edits preserve the retained overlap, even when a surviving piece is
  // shorter than twice that overlap. Ordinary UI transitions retain their cap.
  if (Number.isFinite(t.timelineOverlap)) return Math.max(0, Math.min(t.timelineOverlap, clipLen(clips[i]), clipLen(clips[i - 1])));
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}

// Clips overlap by the length of the transition into them (FFmpeg xfade).
export function videoLayout(videoClips) {
  let end = 0;
  return videoClips.map((c, i) => {
    const td = transitionDur(videoClips, i);
    const start = Math.max(0, end - td);
    const item = { clip: c, index: i, start, end: start + clipLen(c), trans: td };
    end = item.end;
    return item;
  });
}

export function projectDuration(p) {
  const v = videoLayout(p.videoClips);
  const ends = [v.length ? v[v.length - 1].end : 0];
  p.textClips.forEach((c) => ends.push(c.start + c.duration));
  p.audioClips.forEach((c) => ends.push(c.start + freeLen('audio', c)));
  (p.overlayClips || []).forEach((c) => ends.push(c.start + freeLen('overlay', c)));
  return Math.max(0, ...ends);
}

// Total duration of what gets exported (the video track drives the output length).
// This is THE shared duration basis for everything export-facing: it mirrors, step for
// step, the total electron/media/ffmpeg.cjs accumulates in buildExportArgs (each clip starts
// at the previous end minus its clamped transition overlap). The text rasterizer
// (src/features/export/exportText.js) and the Export dialog's Duration + size estimate both read this
// function — never projectDuration(), which also counts text/audio/overlay ends.
export function exportDuration(p) {
  const v = videoLayout(p.videoClips);
  return v.length ? v[v.length - 1].end : 0;
}

export function videoClipAt(p, t) {
  const hits = videoLayout(p.videoClips).filter((l) => !l.clip.gap && t >= l.start && t < l.end);
  return hits[hits.length - 1] || null;
}

const TRACKS = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips' };

export const IMAGE_DEFAULT = 4;

export function newVideoClip(id, m) {
  return {
    id, mediaId: m.id, in: 0, out: m.type === 'image' ? IMAGE_DEFAULT : m.duration, speed: 1, volume: 1, muted: false,
    filter: 'none', adjust: {}, effects: [], transition: null,
  };
}

// The "Original" format: the first picture on an empty main track sets the canvas shape (a tall phone
// video makes a 9:16 project), unless a format was picked by hand. The canvas fields that change, or {}.
export function canvasFor(p, m) {
  const first = !p.ratioLocked && !p.videoClips.some((c) => !c.gap);
  const ratio = first && ratioFor(m.width, m.height);
  return ratio && ratio !== p.ratio ? { ratio, ...sizeFor(ratio, p.resolution) } : {};
}

function reduceProjectInner(p, a) {
  switch (a.type) {
    case 'addCaptionTranslation': {
      try{
        const source=sourceTrack(a.sourceTrack),cues=translationSnapshot(p,projectDuration(p),source),proposal=translationProposal(a.translation,cues,a.translation?.language);
        const layer=layerCount(p,'text');
        if(layer>=128||isLayerLocked(p,'text',layer)||!Array.isArray(a.ids)||a.ids.length!==cues.length||new Set(a.ids).size!==a.ids.length||a.ids.some(id=>typeof id!=='string'||!id||p.textClips.some(c=>c.id===id)))return p;
        const style=TEXT_TEMPLATES.find(t=>t.id==='cap-classic').patch;
        const clips=cues.map((cue,index)=>({...style,id:a.ids[index],caption:true,source:'plugin-translation',language:proposal.language,text:proposal.translations[index].text,start:cue.start_sec,duration:cue.end_sec-cue.start_sec,layer,y:.8,size:Math.round(Math.min(p.width,p.height)*.075),template:'cap-classic',word_timing:'unavailable'}));
        return {...p,textClips:[...p.textClips,...clips],layers:{...p.layers,text:layer+1},layerNames:{...p.layerNames,text:{...p.layerNames?.text,[layer]:`Captions · ${translationLanguage(proposal.language).label}`}},layerState:{...p.layerState,[`text:${layer}`]:{hidden:true}}};
      }catch{return p;}
    }
    case 'batch':
      // Internal, synchronous compound edits (e.g. a frame hold or caption merge).
      // History, placement, link synchronization and validation see one result.
      if (!Array.isArray(a.actions) || a.actions.length > 512 || a.actions.some(x => !x || ![
        'update', 'updateMany', 'split', 'delete', 'insertAudioClip', 'addText', 'addMedia', 'addToTimeline',
        'addOverlayClip', 'addEffectClip', 'setCaptions', 'renameLayer', 'addLayer', 'removeLayer', 'moveLayer',
        'deleteLayer', 'addMarker', 'removeMarker', 'removeMedia', 'extendVideoTo', 'preparedPluginClips',
      ].includes(x.type))) return p;
      return a.actions.reduce((next, action) => reduceProject(next, action), p);
    case 'load':
      return normalizeProject(a.project);
    case 'setProject':
      return Object.entries(a.patch || {}).every(([key,value]) => JSON.stringify(p[key]) === JSON.stringify(value)) ? p : { ...p, ...a.patch };
    case 'addMedia':
      return a.items.length ? { ...p, media: [...p.media, ...a.items] } : p;
    case 'removeMedia':
      return {
        ...p,
        media: p.media.filter((m) => m.id !== a.id),
        videoClips: p.videoClips.filter((c) => c.mediaId !== a.id),
        audioClips: p.audioClips.filter((c) => c.mediaId !== a.id),
        overlayClips: p.overlayClips.filter((c) => c.mediaId !== a.id),
      };
    case 'addToTimeline': {
      const m = p.media.find((x) => x.id === a.mediaId);
      if (!m) return p;
      // A motion graphic is a full-frame overlay drawn over the video, never a main-track shot.
      if (m.graphic) return reduceProject(p, { type: 'addOverlayClip', mediaId: m.id, clipId: a.clipId, at: Number.isFinite(a.at) ? a.at : 0 });
      if (m.type === 'video' || m.type === 'image') {
        const selectedRange = a.sourceIn !== undefined || a.sourceOut !== undefined;
        if (selectedRange && (m.type !== 'video' || !Number.isFinite(a.sourceIn) || !Number.isFinite(a.sourceOut)
          || a.sourceIn < 0 || a.sourceOut <= a.sourceIn || a.sourceOut > m.duration)) return p;
        const clip = newVideoClip(a.clipId, m);
        const list = [...p.videoClips];
        list.splice(a.index ?? list.length, 0, selectedRange ? { ...clip, in: a.sourceIn, out: a.sourceOut } : clip);
        return { ...p, videoClips: list, ...(a.preserveCanvas ? {} : canvasFor(p, m)) };
      }
      return {
        ...p,
        audioClips: [...p.audioClips, { id: a.clipId, mediaId: m.id, start: a.at, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0, ...(a.layer != null && { layer: a.layer }) }],
      };
    }
    case 'addOverlayClip': {
      // Picture-in-picture: a video or photo above the main track, centred on the canvas at
      // half size by default (Hamza, 2026-11-03: a new overlay lands in the middle, never
      // dropped over a corner). x/y are frame fractions from the centre, so 0/0 is centred.
      const m = p.media.find((x) => x.id === a.mediaId);
      if (!m || m.type === 'audio') return p;
      // A motion graphic is drawn at canvas size: it covers the whole frame.
      const clip = { ...newVideoClip(a.clipId, m), start: Math.max(0, a.at), transform: { scale: m.graphic ? 1 : 0.5, x: 0, y: 0 }, ...(a.layer != null && { layer: a.layer }) };
      return { ...p, overlayClips: [...p.overlayClips, clip] };
    }
    case 'extendVideoTo': {
      // A generated scene may start on an empty timeline or outlast its footage.
      // Pad the main track with background so preview and export cover the scene.
      const end = videoLayout(p.videoClips).at(-1)?.end || 0;
      if (!Number.isFinite(a.end) || a.end <= end) return p;
      const list = [...p.videoClips], last = list.at(-1);
      if (last?.gap) list[list.length - 1] = { ...last, out: last.out + a.end - end };
      else list.push(newGap(a.gapId, a.end - end));
      return { ...p, videoClips: list };
    }
    case 'addEffectClip':
      // A free effect on the Effects track (3 s by default).
      return { ...p, effectClips: [...p.effectClips, { id: a.clipId, fx: a.fx, start: Math.max(0, a.at), duration: a.duration || 3, ...(isPluginEffect(a.fx)?{pluginEffect:pluginEffectInstance(a.fx)}:{}) }] };
    case 'addText':
      return {
        ...p,
        textClips: [
          ...p.textClips,
          // Unset style keys fall back to TEXT_DEFAULTS in src/features/text/render.js.
          { id: a.clipId, text: 'Your text', start: a.at, duration: 3, y: 0.5, ...a.patch, ...(a.layer != null && { layer: a.layer }) },
        ],
      };
    case 'update': {
      const key = TRACKS[a.track], clip = p[key]?.find(c => c.id === a.id);
      if (!clip || Object.entries(a.patch || {}).every(([field,value]) => JSON.stringify(clip[field]) === JSON.stringify(value))) return p;
      const patch = a.track === 'text' ? editWordTiming(clip, a.patch) : { ...a.patch };
      if(patch.transition&&isPluginTransition(patch.transition.type)&&!patch.transition.pluginTransition){
        const instance=pluginTransitionInstance(patch.transition.type);
        if(instance)patch.transition={...patch.transition,pluginTransition:instance};
      }
      if(Array.isArray(patch.effects)) {
        const instances={...(clip.pluginEffects||{}),...(patch.pluginEffects||{})};
        for(const id of patch.effects)if(isPluginEffect(id)&&!instances[id]){const instance=pluginEffectInstance(id);if(instance)instances[id]=instance;}
        if(Object.keys(instances).length)patch.pluginEffects=instances;
      }
      for (const kind of ['In', 'Out']) if (Object.hasOwn(patch, `fade${kind}`) && !Object.hasOwn(patch, `fade${kind}Offset`)) patch[`fade${kind}Offset`] = 0;
      return { ...p, [key]: p[key].map((c) => (c.id === a.id ? { ...c, ...patch } : c)) };
    }
    case 'addLayer':
      return { ...p, layers: { ...p.layers, [a.track]: layerCount(p, a.track) + 1 } };
    case 'removeLayer': {
      // Only an empty layer; the layers above it move down one — clips, names and layer
      // states all follow the same permutation.
      const key = LAYERED[a.track];
      if (!key || p[key].some((c) => layerOf(c) === a.layer) || layerCount(p, a.track) < 2) return p;
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      delete names[a.layer];
      for (const k of Object.keys(names).map(Number).sort((x, y) => x - y)) {
        if (k > a.layer) { names[k - 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, layers: { ...p.layers, [a.track]: layerCount(p, a.track) - 1 },
        [key]: p[key].map((c) => (layerOf(c) > a.layer ? { ...c, layer: layerOf(c) - 1 } : c)),
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (l === a.layer ? null : l > a.layer ? l - 1 : l)),
      };
    }
    case 'duplicateLayer': {
      // Layer context menu (item 13): deep-copy every clip of a layer onto a NEW layer placed
      // directly above it — no limit on how many times. Overlay/text draw higher layer
      // indexes above lower ones, so the copy takes layer+1 and higher layers shift up; audio
      // rows run the other way (layer 0 on top), so the copy takes the original's row and the
      // original (and everything below it) shifts down one. Layer names travel with their layer.
      // For the main track ('video', not a layered lane) the copy becomes a new TOP overlay
      // layer holding the same clips at the same times, as free-positioned overlay clips.
      if (a.track === 'video') {
        const target = layerCount(p, 'overlay');
        let i = 0;
        const copies = videoLayout(p.videoClips).filter((l) => !l.clip.gap).map((l) => {
          const copy = structuredClone(l.clip);
          copy.id = a.newIds[i++];
          copy.start = l.start;
          copy.layer = target;
          copy.transition = null;
          return copy;
        });
        if (!copies.length) return p;
        return { ...p, overlayClips: [...p.overlayClips, ...copies], layers: { ...p.layers, overlay: target + 1 } };
      }
      const key = LAYERED[a.track];
      if (!key) return p;
      const insertAt = a.track === 'audio' ? a.layer : a.layer + 1;
      let i = 0;
      const copies = p[key].filter((c) => layerOf(c) === a.layer).map((c) => {
        const copy = structuredClone(c);
        copy.id = a.newIds[i++];
        copy.layer = insertAt;
        return copy;
      });
      const shifted = p[key].map((c) => (layerOf(c) >= insertAt && !copies.some((x) => x.id === c.id) && (a.track === 'audio' || layerOf(c) !== a.layer)
        ? { ...c, layer: layerOf(c) + 1 } : c));
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      for (const k of Object.keys(names).map(Number).sort((x, y) => y - x)) {
        if (k >= insertAt && (a.track === 'audio' || k !== a.layer)) { names[k + 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, [key]: [...shifted, ...copies],
        layers: { ...p.layers, [a.track]: layerCount(p, a.track) + 1 },
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        // Layer states travel with their layers exactly like the names do; the fresh
        // copy layer starts from the defaults (no entry).
        layerState: remapLayerState(p, a.track, (l) => (l >= insertAt && (a.track === 'audio' || l !== a.layer) ? l + 1 : l)),
      };
    }
    case 'deleteLayer': {
      // Removes the layer AND its clips (unlike removeLayer, which only takes empty layers);
      // layers above move down one and their names follow. The last remaining layer is cleared
      // but kept, so a lane never drops below one layer. One dispatch = one undo step.
      if (a.track === 'video') return { ...p, videoClips: [] };
      const key = LAYERED[a.track];
      if (!key) return p;
      const rest = p[key].filter((c) => layerOf(c) !== a.layer)
        .map((c) => (layerOf(c) > a.layer ? { ...c, layer: layerOf(c) - 1 } : c));
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      delete names[a.layer];
      for (const k of Object.keys(names).map(Number).sort((x, y) => x - y)) {
        if (k > a.layer) { names[k - 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, [key]: rest,
        layers: { ...p.layers, [a.track]: Math.max(1, layerCount(p, a.track) - 1) },
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (l === a.layer ? null : l > a.layer ? l - 1 : l)),
      };
    }
    case 'moveLayer': {
      // Reorder (Stage C): layer `from` ends up at index `to`, the layers in between shift
      // by one. Clips, names and layer states are remapped through the one permutation, so
      // a single dispatch (one undo step) restores the exact prior order. The main track is
      // not in LAYERED and can never be reordered; overlay/text/audio reorder among
      // themselves (their layer 0 included — only 'video' is fixed).
      const key = LAYERED[a.track];
      if (!key) return p;
      const count = layerCount(p, a.track);
      const { from, to } = a;
      if (from === to || from < 0 || to < 0 || from >= count || to >= count) return p;
      const order = [...Array(count).keys()].filter((i) => i !== from);
      order.splice(to, 0, from); // order[newIndex] = oldIndex
      const perm = {};
      order.forEach((oldIdx, newIdx) => { perm[oldIdx] = newIdx; });
      const names = {};
      for (const [k, v] of Object.entries((p.layerNames || {})[a.track] || {})) {
        if (perm[Number(k)] !== undefined) names[perm[Number(k)]] = v;
      }
      return {
        ...p,
        [key]: p[key].map((c) => (perm[layerOf(c)] !== undefined && perm[layerOf(c)] !== layerOf(c) ? { ...c, layer: perm[layerOf(c)] } : c)),
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (perm[l] !== undefined ? perm[l] : l)),
      };
    }
    case 'insertAudioClip':
      // A fully-formed audio clip (Detach audio builds it in App: extracted file, timing, link).
      return { ...p, audioClips: [...p.audioClips, a.clip] };
    case 'renameLayer': {
      const forTrack = { ...((p.layerNames || {})[a.track] || {}) };
      if (a.name && a.name.trim()) forTrack[a.layer] = a.name.trim();
      else delete forTrack[a.layer];
      return { ...p, layerNames: { ...(p.layerNames || {}), [a.track]: forTrack } };
    }
    case 'updateMany':
      // Several clips changed together (one undo step): updates [{ track, id, patch }].
      return a.updates.reduce((q, u) => reduceProject(q, { type: 'update', ...u }), p);
    case 'replaceCaptionCues': {
      // Atomic caption repair/import. Removing cues here never ripples the Text
      // magnet or temporarily relocates the remaining cue to another layer.
      if (!Array.isArray(a.ids) || !Array.isArray(a.clips) || a.clips.length > 10000
        || a.clips.some(c => !c?.id || !c.caption)
        || a.ids.some(id => p.textClips.some(c => c.id === id && !c.caption))) return p;
      const removed = new Set(a.ids);
      return { ...p, textClips: [...p.textClips.filter(c => !removed.has(c.id)), ...a.clips] };
    }
    case 'setMagnet': {
      if (!!p.magnet?.[a.track] === !!a.on) return p;
      const magnet = { ...p.magnet, [a.track]: a.on };
      // Turning the main-track magnet on closes every gap.
      if (a.track === 'video' && a.on) return { ...p, magnet, videoClips: p.videoClips.filter((c) => !c.gap) };
      return { ...p, magnet };
    }
    case 'delete': {
      const key = TRACKS[a.track];
      const c = p[key].find((x) => x.id === a.id);
      if (!c) return p;
      if (a.track === 'video') {
        // Deleting a gap, or deleting with the magnet on, closes the space; otherwise leave a gap behind.
        if (c.gap || p.magnet.video) return { ...p, videoClips: p.videoClips.filter((x) => x.id !== a.id) };
        // The gap covers the clip's visible span: its length less the overlap of the transition
        // into it, so every later clip keeps its position.
        const list = p.videoClips.map((x, i) => (x.id === a.id ? newGap(x.id, clipLen(x) - transitionDur(p.videoClips, i)) : x));
        return { ...p, videoClips: normalizeGaps(list) };
      }
      const rest = p[key].filter((x) => x.id !== a.id);
      if (!p.magnet[a.track]) return { ...p, [key]: rest };
      const len = freeLen(a.track, c);
      const end = c.start + len;
      const same = (x) => !LAYERED[a.track] || layerOf(x) === layerOf(c);
      return { ...p, [key]: rest.map((x) => (same(x) && x.start >= end - 1e-6 ? { ...x, start: Math.max(0, x.start - len) } : x)) };
    }
    case 'preparedPluginClips': {
      const plan=pluginClipArrays.get(a.token);
      return plan&&Object.keys(plan.arrays).every(key=>p[key]===plan.base[key])?{...p,...plan.arrays}:p;
    }
    case 'moveVideo': {
      const list = [...p.videoClips];
      const from = list.findIndex((c) => c.id === a.id);
      if (from < 0) return p;
      const [c] = list.splice(from, 1);
      const to = Math.max(0, Math.min(a.toIndex, list.length));
      if (to === from) return p;
      list.splice(to, 0, c);
      return { ...p, videoClips: normalizeGaps(list, { keepTrailing: true }) }; // gaps that meet after the move merge
    }
    case 'setCaptions': {
      // Replaces previous auto captions with new ones (one undo step).
      // Words keep their spoken timings (relative to the caption) for highlight / karaoke styles.
      const style = { y: 0.8, size: Math.round(Math.min(p.width, p.height) * 0.075), ...a.style };
      const caps = a.segments.map((s) => ({
        ...style,
        id: s.id,
        text: s.text,
        start: s.start,
        duration: Math.max(0.001, s.end - s.start),
        ...captionWordTiming(s),
        caption: true,
      }));
      // Imported .srt subtitles (source: 'srt') are the user's own files: regenerating the
      // auto captions must not delete them, so imported and translated caption tracks are preserved.
      return { ...p, textClips: [...p.textClips.filter((c) => !c.caption || c.source === 'srt' || c.source === 'plugin-translation'), ...caps] };
    }
    case 'importSrtCaptions': {
      // Subtitles parsed from an .srt file: exact file timings and text, styled with the
      // currently chosen caption template patch (a.style). One undo step for the whole file.
      const style = { y: 0.8, size: Math.round(Math.min(p.width, p.height) * 0.075), ...a.style };
      const caps = a.segments.map((s) => ({
        ...style,
        id: s.id,
        text: s.text,
        start: s.start,
        duration: Math.max(0.2, s.end - s.start),
        caption: true,
        source: 'srt',
      }));
      return { ...p, textClips: [...p.textClips, ...caps] };
    }
    case 'removeSrtCaptions':
      return { ...p, textClips: p.textClips.filter((c) => c.source !== 'srt') };
    case 'styleSrtCaptions':
      // Style only the imported .srt subtitles (the Subtitles card's template grid).
      return { ...p, textClips: p.textClips.map((c) => (c.source === 'srt' ? { ...c, ...a.patch } : c)) };
    case 'styleCaptions':
      return { ...p, textClips: p.textClips.map((c) => (c.caption ? { ...c, ...a.patch } : c)) };
    case 'duplicate': {
      const key = TRACKS[a.track];
      const i = p[key].findIndex((c) => c.id === a.id);
      if (i < 0 || p[key][i].gap) return p;
      const c = p[key][i];
      const copy = { ...c, id: a.newId };
      if (a.track === 'video') copy.transition = null;
      else copy.start = c.start + freeLen(a.track, c);
      const list = [...p[key]];
      list.splice(i + 1, 0, copy);
      let next = { ...p, [key]: list };
      const partner = findLinkPartner(p, c);
      if (c.linkId && partner) {
        const partnerKey = TRACKS[partner.track];
        const partnerId = `${a.newId}~l`, linkId = `${c.linkId}~${a.newId}`;
        if (Object.values(CLIP_LISTS).some(k => p[k]?.some(x => x.id === partnerId || x.linkId === linkId))) return p;
        const other = { ...partner.clip, id: partnerId, linkId };
        copy.linkId = linkId;
        if (partner.track === 'video') other.transition = null;
        else other.start = partner.clip.start + freeLen(partner.track, partner.clip);
        const others = [...next[partnerKey]], at = others.findIndex(x => x.id === partner.clip.id);
        others.splice(at + 1, 0, other);
        next = { ...next, [partnerKey]: others };
        const pic = a.track === 'audio' ? other : copy;
        const aud = a.track === 'audio' ? copy : other;
        const picTrack = a.track === 'audio' ? partner.track : a.track;
        aud.start = picStart(next, picTrack, pic) + (aud.linkOff || 0);
      } else if (copy.linkId) {
        delete copy.linkId; delete copy.linkOff; delete copy.linkInOff;
      }
      return next;
    }
    case 'removeEffect': {
      // a.id: an effect object key (see effectObjects).
      const { track, clipId, fx } = parseEffectKey(a.id);
      const key = TRACKS[track];
      if (!key) return p;
      return { ...p, [key]: p[key].map((c) => {
        if (c.id !== clipId) return c;
        const fxRegions = { ...(c.fxRegions || {}) };
        delete fxRegions[fx]; // the region belongs to the effect instance; it goes with it
        return { ...c, effects: (c.effects || []).filter((e) => e !== fx), fxRegions };
      }) };
    }
    case 'split':
      return splitLinked(p, a.track, a.id, a.t, a.newId);
    case 'moveToOverlay': {
      // Main clip -> overlay track at time `at` (the main track closes up or keeps a gap, per its magnet).
      const c = p.videoClips.find((x) => x.id === a.id);
      if (!c || c.gap) return p;
      const rest = reduceProject(p, { type: 'delete', track: 'video', id: a.id });
      return { ...rest, overlayClips: [...rest.overlayClips, { ...c, start: Math.max(0, a.at), transition: null }] };
    }
    case 'moveToMain': {
      // Overlay clip -> main track at position `index`.
      const c = p.overlayClips.find((x) => x.id === a.id);
      if (!c) return p;
      const rest = reduceProject(p, { type: 'delete', track: 'overlay', id: a.id });
      const { start, ...clip } = c;
      const list = [...rest.videoClips];
      list.splice(Math.max(0, Math.min(a.index ?? list.length, list.length)), 0, { ...clip, transition: null });
      return { ...rest, videoClips: list };
    }
    case 'extractAudio': {
      // Extract the sound of a video clip onto the audio track as an INDEPENDENT clip
      // (same timing, same media, no linkId — unlike Detach audio, nothing stays in
      // sync afterwards) and mute the clip. The copy carries the clip's speed: audio
      // clips play at a constant rate, so (out - in) / speed matches the picture's
      // timeline length at any speed.
      const key = TRACKS[a.track];
      const c = key && p[key].find((x) => x.id === a.id);
      const m = c && p.media.find((x) => x.id === c.mediaId);
      if (!c || c.gap || !m || m.type !== 'video' || !m.hasAudio || c.muted) return p;
      const start = a.track === 'video' ? videoLayout(p.videoClips).find((l) => l.clip.id === c.id).start : c.start;
      const audio = { id: a.newId, mediaId: m.id, start, in: c.in, out: c.out, speed: c.speed || 1, volume: c.volume ?? 1, fadeIn: 0, fadeOut: 0 };
      return { ...p, [key]: p[key].map((x) => (x.id === c.id ? { ...x, muted: true } : x)), audioClips: [...p.audioClips, audio] };
    }
    case 'paste': {
      // A copied clip at time `at`: main clips are inserted where `at` falls, others start at `at`.
      const key = TRACKS[a.track];
      if (!key || !a.clip) return p;
      // The copy is independent: a pasted clip never shares its source's audio link
      // (two clips with one linkId would fight over the partner).
      const { linkId, linkOff, linkInOff, ...clip } = a.clip;
      if (a.track === 'video') {
        const list = [...p.videoClips];
        const index = videoLayout(list).filter((l) => (l.start + l.end) / 2 < a.at).length;
        list.splice(index, 0, { ...clip, id: a.newId, transition: null });
        return { ...p, videoClips: list };
      }
      return { ...p, [key]: [...p[key], { ...clip, id: a.newId, start: Math.max(0, a.at) }] };
    }
    case 'cutRanges':
      return cutRanges(p, a.ranges, { ripple: a.ripple === true });
    case 'retimeVideo':
      return retimeVideoClip(p, a.id, a.speed).project;
    case 'retimeTransition':
      return retimeTransition(p, a.id, a.transition).project;
    case 'addMarker':
      return { ...p, markers: [...p.markers, { id: a.id, time: Math.max(0, a.time), label: a.label || '' }].sort((x, y) => x.time - y.time) };
    case 'removeMarker':
      return { ...p, markers: p.markers.filter((m) => m.id !== a.id) };
    default:
      return p;
  }
}

// Every reduction funnels through here so a motion-tracking pin can never dangle: deleting a clip (or
// a whole layer of clips) or clearing a clip's track takes the pin off every follower that used it.
function reduceProject(p, a) {
  const next = reduceProjectInner(p, a);
  if (next === p) return next;
  if (a.type === 'delete') return cleanPins(next, new Set([a.id]));
  if (a.type === 'deleteLayer' || a.type === 'load') return cleanPins(next);
  if (a.type === 'update' && 'track' in (a.patch || {}) && !a.patch.track) return cleanPins(next);
  if (a.type === 'updateMany') return cleanPins(next);
  return next;
}

// Trims one edge of a clip. `delta` is how much that edge moves INTO the clip, in timeline seconds
// (positive shortens, negative extends). Always computed from the project at gesture start, so repeated
// pointer moves never accumulate. Main track (magnet off): the removed time becomes a gap, and extending
// uses up the neighbouring gap. Free tracks (magnet on): the trimmed clip keeps its start and later clips
// shift by the length change (ripple).
export function trimClip(p, { track, id, edge, delta }) {
  const key = TRACKS[track];
  const idx = p[key].findIndex((c) => c.id === id);
  if (idx < 0 || !(Math.abs(delta) > 1e-9)) return p;
  const c = p[key][idx];

  if (track === 'video') {
    const list = [...p.videoClips];
    if (c.gap) {
      list[idx] = { ...c, out: Math.max(MIN_CLIP, c.out - delta) };
      return { ...p, videoClips: normalizeGaps(list) };
    }
    const m = p.media.find((x) => x.id === c.mediaId);
    const sp = c.speed || 1;
    const maxOut = !m || m.type === 'image' ? Infinity : m.duration;
    // A transition overlaps the two clips at the trimmed edge. The removed time comes out of
    // that overlap first (the transition shortens, nothing else moves) and only the rest becomes
    // a gap — so the far edge of the clip, and every later clip, stay where they were.
    const shrinkTransition = (i, left) => {
      const t = list[i].transition;
      list[i] = { ...list[i], transition: left > 1e-6 ? { ...t, duration: left, ...(Number.isFinite(t.timelineOverlap) ? { timelineOverlap: left } : {}) } : null };
    };
    let d;
    if (edge === 'left') {
      const prev = list[idx - 1];
      const avail = prev && prev.gap ? clipLen(prev) : 0;
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = Math.max((newIn - c.in) / sp, -avail);
      list[idx] = { ...c, in: c.in + d * sp };
      if (d > 0) {
        const overlap = transitionDur(p.videoClips, idx);
        const gap = Math.max(0, d - overlap);
        if (overlap > 0) shrinkTransition(idx, overlap - d);
        if (gap > 1e-9) {
          if (prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + gap };
          else list.splice(idx, 0, newGap(`${id}-gl`, gap));
        }
      } else if (d < 0 && prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + d };
    } else {
      const after = list[idx + 1];
      const avail = !after ? Infinity : after.gap ? clipLen(after) : 0;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = Math.max((c.out - newOut) / sp, -avail);
      list[idx] = { ...c, out: c.out - d * sp };
      if (d > 0) {
        const overlap = after && !after.gap ? transitionDur(p.videoClips, idx + 1) : 0;
        const gap = Math.max(0, d - overlap);
        if (overlap > 0) shrinkTransition(idx + 1, overlap - d);
        if (gap > 1e-9) {
          if (after && after.gap) list[idx + 1] = { ...after, out: after.out + gap };
          else if (after) list.splice(idx + 1, 0, newGap(`${id}-gr`, gap));
        }
      } else if (d < 0 && after && after.gap) list[idx + 1] = { ...after, out: after.out + d };
    }
    return { ...p, videoClips: normalizeGaps(list) };
  }

  // Free tracks.
  const len = freeLen(track, c);
  const m = c.mediaId && p.media.find((x) => x.id === c.mediaId);
  let d;
  let next;
  if (track === 'overlay') {
    // Same as audio, with speed (timeline seconds vs source seconds) and endless photos.
    const sp = c.speed || 1;
    if (edge === 'left') {
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = (newIn - c.in) / sp;
      next = { ...c, in: newIn };
    } else {
      const maxOut = m && m.type === 'video' ? m.duration : Infinity;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = (c.out - newOut) / sp;
      next = { ...c, out: newOut };
    }
  } else if (track === 'audio') {
    // delta arrives in timeline seconds; the source window moves by delta * speed, and the
    // ripple shift of later clips is the timeline difference again.
    const sp = c.speed || 1;
    if (edge === 'left') {
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = (newIn - c.in) / sp;
      next = { ...c, in: newIn };
    } else {
      const maxOut = m ? m.duration : Infinity;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = (c.out - newOut) / sp;
      next = { ...c, out: newOut };
    }
  } else {
    d = Math.min(delta, len - MIN_CLIP);
    next = { ...c, duration: len - d };
  }
  const oldEnd = c.start + len;
  const out = p[key].map((x) => {
    if (x.id === id) return next;
    if (p.magnet[track] && x.start >= oldEnd - 1e-6 && (!LAYERED[track] || layerOf(x) === layerOf(c))) return { ...x, start: Math.max(0, x.start - d) };
    return x;
  });
  return { ...p, [key]: out };
}

// The marker closest to time t within `eps` seconds, or null.
export function markerNear(markers, t, eps = 0.05) {
  let best = null;
  for (const m of markers) if (Math.abs(m.time - t) <= eps && (!best || Math.abs(m.time - t) < Math.abs(best.time - t))) best = m;
  return best;
}

// Actions for "delete the part of a clip left (or right) of time t". The clip is split at t and one half is
// deleted through the normal delete, so the track magnet decides between closing the gap and leaving one.
// Returns [] when t is not inside the clip (or too close to its edge).
export function trimActions(p, { track, id, t, side, newId }) {
  const key = TRACKS[track];
  const c = key && p[key].find((x) => x.id === id);
  if (!c || c.gap) return [];
  let start;
  let end;
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
    start = l.start;
    end = l.end;
  } else {
    start = c.start;
    end = c.start + freeLen(track, c);
  }
  if (t - start < MIN_CLIP || end - t < MIN_CLIP) return [];
  const actions = [{ type: 'split', track, id, t, newId }];
  // Delete-left on the main track: the split builds the surviving right half with
  // transition: null (correct for a plain split, whose right half starts mid-clip),
  // and the left half — the one carrying the incoming transition — is the one being
  // deleted. But after the ripple the remainder starts the clip, adjacent to the same
  // previous clip, so the transition belongs to it: hand it over, stored verbatim like
  // everywhere else. Its effective length is clamped at use time by transitionDur
  // (half of either neighbour), the same clamp the split/trim paths already rely on.
  // Delete-right keeps the original clip as the remainder, transition already in place.
  if (track === 'video' && side === 'left' && c.transition) {
    actions.push({ type: 'update', track: 'video', id: newId, patch: { transition: c.transition } });
  }
  actions.push({ type: 'delete', track, id: side === 'left' ? id : newId });
  return actions;
}

// Remove timeline intervals with one shared time map. Manual callers keep free
// tracks fixed by default; the agent opts into ripple for captions, audio,
// overlays, effects and markers. Linked audio always follows its picture.
export function cutRanges(p, ranges, { ripple = false } = {}) {
  const total = exportDuration(p);
  if (!Array.isArray(ranges) || ranges.some(r => !r || !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start)) return p;
  const cuts = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, Math.min(total, range.start)), end = Math.max(0, Math.min(total, range.end));
    if (end - start <= 0.01) continue;
    const last = cuts.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else cuts.push({ start, end });
  }
  if (!cuts.length || isLayerLocked(p, 'video', 0)) return p;
  const mapped = t => t - cuts.reduce((n, r) => n + Math.max(0, Math.min(t, r.end) - r.start), 0);
  const piecesOf = (start, end) => {
    let pieces = [[start, end]];
    for (const r of cuts) pieces = pieces.flatMap(([a, b]) => {
      if (r.end <= a || r.start >= b) return [[a, b]];
      return [...(r.start > a ? [[a, r.start]] : []), ...(r.end < b ? [[r.end, b]] : [])];
    });
    return pieces.filter(([a, b]) => b - a > 1e-7);
  };
  const used = new Set(Object.values(CLIP_LISTS).flatMap(key => (p[key] || []).flatMap(c => [c.id, c.linkId].filter(Boolean))));
  const fresh = base => {
    let id = base, i = 1;
    while (used.has(id)) id = `${base}-${i++}`;
    used.add(id);
    return id;
  };
  const records = new Map();
  const sliceClip = (track, clip, start, end, shouldRipple) => {
    const spans = shouldRipple ? piecesOf(start, end) : [[start, end]];
    const parts = spans.map(([a, b], i) => {
      const at = shouldRipple ? mapped(a) : a;
      if (spans.length === 1 && a === start && b === end && at === start) return { clip, start, end, originalStart: a, originalEnd: b };
      const id = i ? fresh(`${clip.id}-c${i}`) : clip.id;
      let next = { ...clip, id };
      if (track === 'video' || track === 'overlay' || track === 'audio') {
        const speed = clip.speed || 1;
        next.in = clip.gap ? 0 : clip.in + (a - start) * speed;
        next.out = clip.gap ? b - a : clip.in + (b - start) * speed;
      } else {
        next.duration = b - a;
        if (clip.words?.length && (a > start || b < end)) {
          next.words = clip.words.filter(w => w.start < b - start && w.end > a - start)
            .map(w => ({ ...w, start: Math.max(0, w.start - (a - start)), end: Math.min(b - a, w.end - (a - start)) }));
          if (clip.caption && !next.words.length) return null;
          next.text = next.words.map(w => w.text).join(' ');
        }
      }
      if (track !== 'video') next.start = at;
      if (next.anim) {
        const { in: enter, out: leave, ...rest } = next.anim;
        next.anim = { ...rest, ...(a === start && enter ? { in: enter } : {}), ...(b === end && leave ? { out: leave } : {}) };
      }
      if (['video', 'overlay', 'audio'].includes(track)) Object.assign(next, sliceFades(clip, a - start, b - start, end - start));
      // Source-time keyframes are deliberately retained without retiming.
      return { clip: next, start: at, end: shouldRipple ? mapped(b) : b, originalStart: a, originalEnd: b };
    });
    const kept = parts.filter(Boolean);
    records.set(clip.id, kept);
    return kept;
  };
  const main = videoLayout(p.videoClips).flatMap(l => sliceClip('video', l.clip, l.start, l.end, true));
  let previous;
  for (const item of main) {
    const overlap = previous ? Math.max(0, previous.end - item.start) : 0;
    item.clip = { ...item.clip, transition: overlap > 1e-7 && item.clip.transition?.type && item.clip.transition.type !== 'none'
      ? { ...item.clip.transition, duration: overlap, timelineOverlap: overlap } : null };
    previous = item;
  }
  const lists = { video: main };
  for (const [track, key] of Object.entries(CLIP_LISTS)) {
    if (track === 'video') continue;
    lists[track] = (p[key] || []).flatMap(c => sliceClip(track, c, c.start, c.start + freeLen(track, c), ripple));
  }
  // A detached pair is sliced from the picture's retained source intervals. Each
  // resulting pair receives its own link, never several pictures to one sound.
  for (const [linkId, pair] of linkPairs(p)) {
    if (!pair.pic || !pair.aud) continue;
    const pictures = records.get(pair.pic.clip.id) || [];
    const audio = pair.aud.clip;
    lists.audio = lists.audio.filter(item => !records.get(audio.id)?.includes(item));
    pictures.forEach((picture, index) => {
      const nextLink = index ? fresh(`${linkId}~${picture.clip.id}`) : linkId;
      picture.clip = { ...picture.clip, linkId: nextLink };
      const inOffset = audio.linkInOff ?? audio.in - pair.pic.clip.in;
      const at = picture.start + (audio.linkOff || 0);
      const sound = { ...audio, id: index ? fresh(`${audio.id}-c${index}`) : audio.id,
        start: at, in: picture.clip.in + inOffset, out: picture.clip.out + inOffset,
        speed: picture.clip.speed || 1, linkId: nextLink, linkOff: audio.linkOff || 0, linkInOff: inOffset };
      const from = (sound.in - audio.in) / (audio.speed || 1);
      Object.assign(sound, sliceFades(audio, from, from + clipLen(sound), clipLen(audio)));
      lists.audio.push({ clip: sound, start: at, end: at + clipLen(sound) });
    });
  }
  const result = { ...p };
  for (const [track, key] of Object.entries(CLIP_LISTS)) {
    const next = (lists[track] || []).map(item => item.clip);
    // Reject atomically if ripple, slicing or link maintenance would touch a
    // locked clip. Unaffected locked layers do not block an unrelated edit.
    for (const old of p[key] || []) {
      if (!clipLocked(p, track, old)) continue;
      const now = next.find(c => c.id === old.id);
      if (!now || JSON.stringify(now) !== JSON.stringify(old)) return p;
    }
    result[key] = track === 'video' ? normalizeGaps(next, { keepTrailing: ripple }) : next;
  }
  if (ripple) result.markers = (p.markers || []).filter(m => !cuts.some(r => m.time >= r.start && m.time < r.end))
    .map(m => ({ ...m, time: mapped(m.time) }));
  return result;
}

// Agent speed changes warp the complete timeline clock over one main clip.
// Media spanning a clock boundary is split into source-continuous constant-rate
// pieces; ordinary manual `update {speed}` retains its existing behavior.
export function retimeVideoClip(p, clipId, speed) {
  const layout = videoLayout(p.videoClips), hit = layout.find(l => l.clip.id === clipId && !l.clip.gap);
  const fail = error => ({ project: p, error });
  if (!hit) return fail('Choose an existing main-track media clip.');
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) return fail('speed must be between 0.25 and 4.');
  const factor = (hit.clip.speed || 1) / speed;
  if (Math.abs(factor - 1) < 1e-10) return { project: p };
  if (isLayerLocked(p, 'video', 0)) return fail('The main track is locked.');
  return warpTimeline(p, { from: hit.start, to: hit.end, factor, clipId, speed });
}

// A transition moves the incoming scene's anchor. Compress/expand the clock
// before that anchor (preserving speech rather than deleting it), and shift all
// downstream cues together. Main detached sound follows its picture unchanged.
export function retimeTransition(p, clipId, transition) {
  if(transition&&isPluginTransition(transition.type)&&!transition.pluginTransition){const instance=pluginTransitionInstance(transition.type);if(instance)transition={...transition,pluginTransition:instance};}
  const layout = videoLayout(p.videoClips), index = layout.findIndex(l => l.clip.id === clipId && !l.clip.gap);
  const fail = error => ({ project: p, error });
  if (index < 1) return fail('Choose a main-track clip after the first clip.');
  if (isLayerLocked(p, 'video', 0)) return fail('The main track is locked.');
  if (JSON.stringify(layout[index].clip.transition ?? null) === JSON.stringify(transition ?? null)) return { project: p, time_map: null };
  const videoClips = p.videoClips.map(c => c.id === clipId ? { ...c, transition } : c);
  const next = videoLayout(videoClips), delta = next[index].start - layout[index].start;
  if (Math.abs(delta) < 1e-10) return { project: placeLayers({ ...p, videoClips }), time_map: null };
  const from = layout[index - 1].start, to = layout[index].start;
  const factor = (to - from + delta) / (to - from);
  if (!(factor > 0)) return fail('The transition leaves no time before the incoming scene.');
  return warpTimeline(p, { from, to, factor, videoClips });
}

function warpTimeline(p, { from, to, factor, clipId, speed, videoClips }) {
  const fail = error => ({ project: p, error });
  const layout = videoLayout(p.videoClips), delta = (to - from) * (factor - 1), epsilon = 1e-7;
  const map = t => t <= from ? t : t < to ? from + (t - from) * factor : t + delta;
  const used = new Set(Object.values(CLIP_LISTS).flatMap(key => (p[key] || []).flatMap(c => [c.id, c.linkId].filter(Boolean))));
  const fresh = base => { let id = base, i = 1; while (used.has(id)) id = `${base}-${i++}`; used.add(id); return id; };
  const records = new Map(), lists = {};
  let error;
  const slice = (track, c, start, end) => {
    const media = ['video', 'overlay', 'audio'].includes(track);
    const bounds = media ? [start, ...[from, to].filter(t => t > start + epsilon && t < end - epsilon), end] : [start, end];
    if (bounds.length > 2 && c.enhance?.on) { error ||= `Clip ${c.id} has enhanced audio across a speed boundary. Render or split that processed sound before retiming.`; return []; }
    if (bounds.length > 2 && c.anim?.combo) { error ||= `Clip ${c.id} has a continuous combo animation across a speed boundary. Replace it with source keyframes before retiming.`; return []; }
    const parts = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i], b = bounds[i + 1], nextStart = map(a), nextEnd = map(b);
      const rate = media ? (a >= from - epsilon && b <= to + epsilon ? factor : 1) : (nextEnd - nextStart) / (b - a);
      if (Math.abs(nextStart - a) < epsilon && Math.abs(rate - 1) < epsilon && bounds.length === 2) {
        parts.push({ clip: c, start, end, originalStart: a, originalEnd: b }); continue;
      }
      const next = { ...c, id: i ? fresh(`${c.id}-s${i}`) : c.id };
      if (media) {
        if (c.gap) Object.assign(next, { in: 0, out: nextEnd - nextStart, speed: 1 });
        else {
          const nextSpeed = c.id === clipId ? speed : (c.speed || 1) / rate;
          if (nextSpeed < 0.25 - epsilon || nextSpeed > 4 + epsilon) error ||= `Retiming clip ${c.id} would require ${nextSpeed.toFixed(3)}x playback outside the supported 0.25–4x range.`;
          Object.assign(next, { in: a === start ? c.in : c.in + (a - start) * (c.speed || 1),
            out: b === end ? c.out : c.in + (b - start) * (c.speed || 1), speed: nextSpeed });
        }
        if (c.anim) {
          const { in: enter, out: leave, ...rest } = c.anim;
          if ((enter && a > start + epsilon && a < start + (enter.duration || 0.5) - epsilon) ||
              (leave && b < end - epsilon && b > end - (leave.duration || 0.5) + epsilon)) error ||= `A speed boundary crosses clip ${c.id}'s entry or exit animation. Move the boundary outside that animation first.`;
          next.anim = { ...rest,
            ...(enter && a === start ? { in: { ...enter, duration: map(Math.min(end, start + (enter.duration || 0.5))) - map(start) } } : {}),
            ...(leave && b === end ? { out: { ...leave, duration: map(end) - map(Math.max(start, end - (leave.duration || 0.5))) } } : {}) };
        }
        const fades = sliceFades(c, a - start, b - start, end - start);
        for (const key of Object.keys(fades)) fades[key] *= rate;
        Object.assign(next, fades);
      } else {
        next.duration = nextEnd - nextStart;
        if (c.words?.length) next.words = c.words.map(w => ({ ...w, start: map(start + w.start) - nextStart, end: map(start + w.end) - nextStart }));
        for (const key of ['animIn', 'animOut']) if (c[key]?.dur) {
          const duration = c[key].dur;
          next[key] = { ...c[key], dur: key === 'animIn' ? map(Math.min(end, start + duration)) - map(start) : map(end) - map(Math.max(start, end - duration)) };
        }
      }
      if (track !== 'video') next.start = nextStart;
      parts.push({ clip: next, start: nextStart, end: nextEnd, originalStart: a, originalEnd: b });
    }
    records.set(c.id, parts);
    return parts;
  };
  lists.video = videoClips ? videoLayout(videoClips).map(l => {
    const old = layout.find(row => row.clip.id === l.clip.id);
    const item = { clip: l.clip, start: l.start, end: l.end, originalStart: old.start, originalEnd: old.end };
    records.set(l.clip.id, [item]); return item;
  }) : layout.flatMap(l => slice('video', l.clip, l.start, l.end));
  const mainLinks = new Map(videoClips ? lists.video.filter(l => l.clip.linkId).map(l => [l.clip.linkId, l]) : []);
  for (const [track, key] of Object.entries(CLIP_LISTS)) if (track !== 'video') lists[track] = (p[key] || []).flatMap(c => {
    const picture = track === 'audio' && mainLinks.get(c.linkId);
    if (!picture) return slice(track, c, c.start, c.start + freeLen(track, c));
    const start = picture.start + (c.linkOff || 0), next = { ...c, start };
    const item = { clip: next, start, end: start + clipLen(next), originalStart: c.start, originalEnd: c.start + clipLen(c) };
    records.set(c.id, [item]); return [item];
  });
  if (error) return fail(error);
  for (let i = 0; i < lists.video.length; i++) {
    const item = lists.video[i], previous = lists.video[i - 1];
    const overlap = previous ? Math.max(0, previous.end - item.start) : 0;
    if (overlap > epsilon) {
      if (!item.clip.transition || item.clip.transition.type === 'none' || overlap > Math.min(item.end - item.start, previous.end - previous.start) + epsilon) return fail('The requested speed cannot preserve the adjacent transition overlap.');
      item.clip = { ...item.clip, transition: { ...item.clip.transition, duration: overlap, timelineOverlap: overlap } };
    } else if (item.clip.transition) item.clip = { ...item.clip, transition: null };
  }
  for (const [linkId, pair] of linkPairs(p)) {
    if (!pair.pic || !pair.aud) continue;
    const pictures = records.get(pair.pic.clip.id) || [], sounds = records.get(pair.aud.clip.id) || [];
    const inOffset = pair.aud.clip.linkInOff ?? pair.aud.clip.in - pair.pic.clip.in;
    if (pictures.length !== sounds.length) return fail('A time-offset linked pair crosses different speed boundaries. Unlink that pair before retiming.');
    const assigned = new Set();
    for (let i = 0; i < pictures.length; i++) {
      const picture = pictures[i];
      const sound = sounds.find(s => !assigned.has(s) && Math.abs(s.clip.in - picture.clip.in - inOffset) < epsilon && Math.abs(s.clip.out - picture.clip.out - inOffset) < epsilon);
      if (!sound || Math.abs((sound.clip.speed || 1) - (picture.clip.speed || 1)) > epsilon) return fail('A time-offset linked pair cannot retain one shared playback rate across this speed boundary. Unlink it before retiming.');
      assigned.add(sound);
      const nextLink = i ? fresh(`${linkId}~${picture.clip.id}`) : linkId;
      picture.clip = { ...picture.clip, linkId: nextLink };
      sound.clip = { ...sound.clip, linkId: nextLink, linkOff: sound.start - picture.start, linkInOff: inOffset };
    }
  }
  const result = { ...p, markers: (p.markers || []).map(m => ({ ...m, time: map(m.time) })) };
  for (const [track, key] of Object.entries(CLIP_LISTS)) result[key] = lists[track].map(item => item.clip);
  const normalized = placeLayers(result);
  for (const [track, key] of Object.entries(CLIP_LISTS)) for (const c of p[key] || []) if (clipLocked(p, track, c)) {
    const next = normalized[key].find(item => item.id === c.id);
    const before = LAYERED[track] ? { ...c, layer: c.layer ?? 0 } : c;
    if (!next || JSON.stringify(next) !== JSON.stringify(before)) return fail(`Retiming would change locked ${track} clip ${c.id}. Unlock its layer first.`);
  }
  const actual = videoLayout(normalized.videoClips);
  if (actual.length !== lists.video.length || actual.some((l, i) => Math.abs(l.start - lists.video[i].start) > epsilon || Math.abs(l.end - lists.video[i].end) > epsilon)) return fail('The requested speed cannot represent the mapped transition timing exactly.');
  return { project: normalized, time_map: { start_sec: from, end_sec: to, factor, delta_sec: delta } };
}

// After a split the In animation stays on the left part and the Out animation on the right one.
// Keyframes are in source time, so both parts keep them unchanged.
function splitAnim(anim, side) {
  if (!anim) return anim;
  const { in: a, out: b, ...rest } = anim;
  return side === 'left' ? { ...rest, ...(a ? { in: a } : {}) } : { ...rest, ...(b ? { out: b } : {}) };
}

function splitAt(p, track, id, t, newId) {
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
    if (!l || l.clip.gap || t - l.start < MIN_CLIP || l.end - t < MIN_CLIP) return p;
    const cut = l.clip.in + (t - l.start) * (l.clip.speed || 1);
    const list = [];
    p.videoClips.forEach((c, i) => {
      if (c.id !== id) {
        // The transition into the clip after the split keeps its overlap: the short right
        // half must not re-clamp it (which would move every later clip).
        const td = i === l.index + 1 && c.transition && !c.gap ? transitionDur(p.videoClips, i) : 0;
        return list.push(td > 0 ? { ...c, transition: { ...c.transition, timelineOverlap: td } } : c);
      }
      list.push({ ...c, out: cut, anim: splitAnim(c.anim, 'left'), ...sliceFades(c, 0, t - l.start, l.end - l.start) },
        { ...c, id: newId, in: cut, transition: null, anim: splitAnim(c.anim, 'right'), ...sliceFades(c, t - l.start, l.end - l.start, l.end - l.start) });
    });
    return { ...p, videoClips: list };
  }
  if (track === 'audio') {
    const c = p.audioClips.find((x) => x.id === id);
    const len = c ? freeLen('audio', c) : 0;
    if (!c || t - c.start < MIN_CLIP || c.start + len - t < MIN_CLIP) return p;
    const cut = c.in + (t - c.start) * (c.speed || 1);
    return {
      ...p,
      audioClips: p.audioClips.flatMap((x) => (x.id !== id ? [x] : [
        { ...x, out: cut, ...sliceFades(x, 0, t - c.start, len) },
        { ...x, id: newId, start: t, in: cut, ...sliceFades(x, t - c.start, len, len) },
      ])),
    };
  }
  if (track === 'overlay') {
    const c = p.overlayClips.find((x) => x.id === id);
    const len = c ? freeLen('overlay', c) : 0;
    if (!c || t - c.start < MIN_CLIP || c.start + len - t < MIN_CLIP) return p;
    const cut = c.in + (t - c.start) * (c.speed || 1);
    return {
      ...p,
      overlayClips: p.overlayClips.flatMap((x) => (x.id !== id ? [x]
        : [{ ...x, out: cut, anim: splitAnim(x.anim, 'left'), ...sliceFades(x, 0, t - c.start, len) },
          { ...x, id: newId, start: t, in: cut, anim: splitAnim(x.anim, 'right'), ...sliceFades(x, t - c.start, len, len) }])),
    };
  }
  if (track === 'text' || track === 'effect') {
    const key = TRACKS[track];
    const c = p[key].find((x) => x.id === id);
    if (!c || t - c.start < MIN_CLIP || c.start + c.duration - t < MIN_CLIP) return p;
    const halves = splitTimed(c, t, newId);
    if (halves.length < 2) return p; // a caption whose words all fall on one side is not split
    return {
      ...p,
      [key]: p[key].flatMap((x) => (x.id !== id ? [x] : halves)),
    };
  }
  return p;
}

// Splits a clip and, when it is linked (Detach audio) to a partner on the other kind of
// track, splits the partner at the same timeline moment. The left halves keep the link;
// the right halves form a new pair whose offsets are recomputed from the halves themselves,
// so the sync invariants (see syncLinked) hold for both pairs from the start.
function splitLinked(p, track, id, t, newId) {
  const out = splitAt(p, track, id, t, newId);
  if (out === p) return out;
  const src = findClipIn(p, track, id);
  if (!src || !src.linkId) return out;
  const partner = findLinkPartner(p, src);
  if (!partner) return out;
  const partnerNewId = `${newId}~l`;
  const out2 = splitAt(out, partner.track, partner.clip.id, t, partnerNewId);
  if (out2 === out) {
    // The partner could not be split (its range differs): the right half of the first
    // split must not stay linked to a whole partner — it becomes independent.
    return mapClip(out, track, newId, (c) => ({ ...c, linkId: undefined, linkOff: undefined, linkInOff: undefined }));
  }
  const linkId = `${src.linkId}~${newId}`;
  const picTrack = track === 'audio' ? partner.track : track;
  const picRight = findClipIn(out2, picTrack, track === 'audio' ? partnerNewId : newId);
  const audRight = findClipIn(out2, 'audio', track === 'audio' ? newId : partnerNewId);
  if (!picRight || !audRight) return out2;
  let res = mapClip(out2, picTrack, picRight.id, (c) => ({ ...c, linkId }));
  res = mapClip(res, 'audio', audRight.id, (c) => ({
    ...c, linkId,
    linkOff: audRight.start - (picTrack === 'video'
      ? (videoLayout(res.videoClips).find((l) => l.clip.id === picRight.id)?.start ?? audRight.start)
      : picRight.start),
    linkInOff: audRight.in - picRight.in,
  }));
  return res;
}

const CLIP_LISTS = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips' };
export function findClipIn(p, track, id) {
  const key = CLIP_LISTS[track];
  return key ? (p[key] || []).find((c) => c.id === id) : undefined;
}
// The other member of a clip's link pair (a picture clip in video/overlay <-> an audio clip).
export function findLinkPartner(p, clip) {
  if (!clip || !clip.linkId) return null;
  for (const track of ['video', 'overlay', 'audio']) {
    const c = (p[CLIP_LISTS[track]] || []).find((x) => x.id !== clip.id && x.linkId === clip.linkId);
    if (c) return { track, clip: c };
  }
  return null;
}
function mapClip(p, track, id, fn) {
  const key = CLIP_LISTS[track];
  if (!key) return p;
  return { ...p, [key]: p[key].map((c) => (c.id === id ? fn(c) : c)) };
}

// Splits a text clip at timeline time t. Caption words go to the half they are spoken in: a word
// straddling the cut goes to the side holding more of it, never to both. When one half would be
// left without words it returns the clip alone (no split).
function splitTimed(x, t, newId) {
  const cut = t - x.start;
  const a = { ...x, duration: cut };
  const b = { ...x, id: newId, start: t, duration: x.duration - cut };
  if (x.words && x.words.length) {
    const left = x.words.filter((w) => (Math.min(w.end, cut) - w.start) >= (w.end - Math.max(w.start, cut)));
    const right = x.words.filter((w) => !left.includes(w));
    if (!left.length || !right.length) return [x];
    Object.assign(a, cropWordTiming({ ...x, words: left }, 0, cut));
    Object.assign(b, cropWordTiming({ ...x, words: right }, cut, x.duration));
  }
  return [a, b];
}

// ---- Lock enforcement (Stage B) ----
// A locked layer's clips cannot be edited at all. The guard lives HERE, at the dispatch
// layer, so every path — pointer drags, menus, shortcuts, the assistant — is blocked the
// same way, not just the visible buttons. It returns true when the action must not run.
// Undo / redo are handled before this is consulted: restoring an earlier project always
// works, locked or not.
export function actionLocked(p, a) {
  const clipOf = (track, id) => findClipIn(p, track, id);
  switch (a.type) {
    case 'replaceCaptionCues': return !Array.isArray(a.ids) || !Array.isArray(a.clips)
      || a.ids.some(id => clipLocked(p, 'text', clipOf('text', id)))
      || a.clips.some(c => !c || typeof c !== 'object' || isLayerLocked(p, 'text', layerOf(c)));
    case 'batch': {
      if (!Array.isArray(a.actions) || a.actions.length > 512 || a.actions.some(x => !x || x.type === 'batch')) return true;
      let current = p;
      for (const action of a.actions) {
        if (actionLocked(current, action)) return true;
        current = reduceProject(current, action);
      }
      return false;
    }
    case 'insertAudioClip': return isLayerLocked(p, 'audio', layerOf(a.clip));
    case 'update':
      // A move onto another layer is also refused when THAT layer is locked.
      return clipLocked(p, a.track, clipOf(a.track, a.id))
        || (a.patch?.layer !== undefined && LAYERED[a.track] && isLayerLocked(p, a.track, a.patch.layer));
    case 'updateMany': return a.updates.some((u) => clipLocked(p, u.track, clipOf(u.track, u.id)));
    case 'duplicate':
    case 'split': {
      // Both halves of a linked pair are cut, so a locked partner refuses the split too.
      const clip = clipOf(a.track, a.id), partner = findLinkPartner(p, clip);
      return clipLocked(p, a.track, clip) || !!(partner && clipLocked(p, partner.track, partner.clip));
    }
    case 'delete': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'setMagnet':
      // Turning the main-track magnet on removes its gaps.
      return a.track === 'video' && !!a.on && !p.magnet?.video && p.videoClips.some((c) => c.gap) && isLayerLocked(p, 'video', 0);
    case 'removeSrtCaptions': return p.textClips.some((c) => c.source === 'srt' && clipLocked(p, 'text', c));
    case 'styleSrtCaptions': return p.textClips.some((c) => c.source === 'srt' && clipLocked(p, 'text', c));
    case 'styleCaptions': return p.textClips.some((c) => c.caption && clipLocked(p, 'text', c));
    case 'trimClip': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'paste': {
      if (a.track === 'video') return isLayerLocked(p, 'video', 0);
      return isLayerLocked(p, a.track, layerOf(a.clip || {}));
    }
    case 'extendVideoTo': return isLayerLocked(p,'video',0);
    case 'preparedPluginClips': return pluginArraysLocked(p,a.token);
    case 'moveVideo': return isLayerLocked(p, 'video', 0);
    case 'moveToOverlay': return isLayerLocked(p, 'video', 0);
    case 'moveToMain': return clipLocked(p, 'overlay', clipOf('overlay', a.id)) || isLayerLocked(p, 'video', 0);
    case 'extractAudio': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'cutRanges':
    case 'retimeVideo':
    case 'retimeTransition': return isLayerLocked(p, 'video', 0);
    case 'removeEffect': {
      const { track, clipId } = parseEffectKey(a.id);
      return clipLocked(p, track, clipOf(track, clipId));
    }
    case 'removeLayer': return isLayerLocked(p, a.track, a.layer);
    case 'deleteLayer': return a.track !== 'video' && isLayerLocked(p, a.track, a.layer);
    case 'setCaptions':
      // Replaces the auto captions wherever they sit, then adds the new ones on layer 0.
      return isLayerLocked(p, 'text', 0) || p.textClips.some((c) => c.caption && c.source !== 'srt' && c.source !== 'plugin-translation' && clipLocked(p, 'text', c));
    case 'importSrtCaptions': return isLayerLocked(p, 'text', 0);
    case 'addEffectClip': return isLayerLocked(p, 'effect', 0);
    case 'insertAudioClip': return isLayerLocked(p, 'audio', layerOf(a.clip || {}));
    case 'addToTimeline': {
      const m = p.media.find((x) => x.id === a.mediaId);
      return !!m && m.type !== 'audio' && isLayerLocked(p, 'video', 0);
    }
    case 'addMedia':
      return false; // library-level operation with its own confirmation
    case 'removeMedia':
      // Deleting an item deletes every clip that uses it — refused while any of those
      // clips sits on a locked layer (the library flow names the layer to the user).
      return !!lockedMediaUse(p, a.id);
    default: return false;
  }
}

// Adds whose landing layer is only known after placeLayers has run (a clip dropped on a
// full layer is bumped to the next free one) are checked against the RESULT: if the new
// clip ended up on a locked layer, the whole action is reverted.
const PLACEMENT_CHECKED = { addToTimeline: 'clipId', addOverlayClip: 'clipId', addText: 'clipId', moveToOverlay: 'id', extractAudio: 'newId' };
function placementBlocked(before, after, a) {
  const idKey = PLACEMENT_CHECKED[a.type];
  if (!idKey || after === before) return false;
  const id = a[idKey];
  for (const track of ['video', 'overlay', 'text', 'audio']) {
    const c = findClipIn(after, track, id);
    if (c) return clipLocked(after, track, c);
  }
  return false;
}

// ---- Link sync (Detach audio pairs) ----
// A linked pair shares clip.linkId; the audio clip also carries linkOff (its start minus
// the picture clip's timeline start) and linkInOff (its source in-point minus the picture
// clip's). After ANY action, the side that did not change is rewritten from the side that
// did — so the pair selects / moves / trims / speeds together no matter which handle the
// user (or a split, or a reorder) touched. Runs inside historyReducer so every edit path
// is covered; returns the input object untouched when every invariant already holds.
function picStart(p, track, clip) {
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === clip.id);
    return l ? l.start : null;
  }
  return clip.start;
}
function linkPairs(p) {
  const byId = new Map();
  for (const track of ['video', 'overlay', 'audio']) {
    for (const c of p[CLIP_LISTS[track]] || []) {
      if (!c.linkId) continue;
      const pair = byId.get(c.linkId) || {};
      if (track === 'audio') pair.aud = { track, clip: c };
      else pair.pic = { track, clip: c };
      byId.set(c.linkId, pair);
    }
  }
  return byId;
}
// Main-track starts of one project, computed once per call (the layout is O(clips), and a
// project with many linked pieces would otherwise lay the track out several times per pair).
function picStarts(p) {
  let starts = null;
  return (track, clip) => {
    if (track !== 'video') return clip.start;
    if (!starts) { starts = new Map(); for (const l of videoLayout(p.videoClips)) starts.set(l.clip.id, l.start); }
    return starts.has(clip.id) ? starts.get(clip.id) : null;
  };
}

function syncLinked(prev, next) {
  const before = linkPairs(prev);
  const after = linkPairs(next);
  if (!before.size && !after.size) return next;
  const prevStart = picStarts(prev), nextStart = picStarts(next);
  let out = next;
  const put = (track, id, patch) => { out = mapClip(out, track, id, (c) => ({ ...c, ...patch })); };
  for (const [linkId, pair] of after) {
    const was = before.get(linkId);
    if (!pair.pic || !pair.aud) {
      // A member was deleted: the survivor becomes a normal, independent clip — but only
      // when the pair was complete before (a pair being built by Detach must survive its
      // own intermediate steps).
      if (was && was.pic && was.aud) {
        const s = pair.pic || pair.aud;
        put(s.track, s.clip.id, { linkId: undefined, linkOff: undefined, linkInOff: undefined });
      }
      continue;
    }
    if (!was || !was.pic || !was.aud) continue; // a pair created by this action: already consistent
    const v = pair.pic.clip;
    const au = pair.aud.clip;
    const pv = was.pic.clip;
    const pa = was.aud.clip;
    const num = (c, f) => (f === 'speed' ? c.speed || 1 : c[f] || 0);
    const vChanged = ['in', 'out', 'speed'].some((f) => num(v, f) !== num(pv, f))
      || prevStart(was.pic.track, pv) !== nextStart(pair.pic.track, v);
    const aChanged = ['in', 'out', 'speed', 'start'].some((f) => num(au, f) !== num(pa, f));
    if (vChanged) {
      const want = {
        start: nextStart(pair.pic.track, v) + (au.linkOff || 0),
        in: v.in + (au.linkInOff || 0),
        out: v.out + (au.linkInOff || 0),
        speed: v.speed || 1,
      };
      const patch = {};
      for (const f of ['start', 'in', 'out', 'speed']) if (num(au, f) !== want[f]) patch[f] = want[f];
      if (Object.keys(patch).length && !isLayerLocked(next, 'audio', layerOf(au))) put('audio', au.id, patch);
    } else if (aChanged) {
      const patch = {};
      const wantIn = au.in - (au.linkInOff || 0);
      const wantOut = au.out - (au.linkInOff || 0);
      if ((v.in || 0) !== wantIn) patch.in = wantIn;
      if ((v.out || 0) !== wantOut) patch.out = wantOut;
      if ((v.speed || 1) !== (au.speed || 1)) patch.speed = au.speed || 1;
      // The main track's start is positional, so a start change can only flow picture-wards
      // for overlay partners; for video partners it is the picture that leads.
      if (pair.pic.track === 'overlay') {
        const wantStart = au.start - (au.linkOff || 0);
        if ((v.start || 0) !== wantStart) patch.start = wantStart;
      }
      if (Object.keys(patch).length && !clipLocked(next, pair.pic.track, v)) put(pair.pic.track, v.id, patch);
    }
  }
  return out;
}

// Layer state across undo / redo: toggles are not undoable, so the CURRENT states are
// carried over the restored project — but when the undone action was a layer permutation
// (reorder / duplicate / delete layer), the states must follow their LAYERS, not stick to
// the indices. The permutation is read off the clips themselves (each clip id's layer in
// the current project vs in the restored one); when it is consistent for a track, the
// carried keys of that track are remapped through it. (A state entry dropped by deleting
// its layer is not resurrected — toggles made after the snapshot always win.)
function followLayerState(cur, restored) {
  const ls = cur.layerState || {};
  if (!Object.keys(ls).length) return restored.layerState;
  let out = { ...ls };
  for (const track of Object.keys(LAYERED)) {
    const key = LAYERED[track];
    const curById = new Map((cur[key] || []).map((c) => [c.id, layerOf(c)]));
    const map = new Map(); // current layer -> restored layer
    let consistent = true;
    for (const c of restored[key] || []) {
      const lc = curById.get(c.id);
      if (lc === undefined) continue;
      const lr = layerOf(c);
      if (map.has(lc) && map.get(lc) !== lr) { consistent = false; break; }
      map.set(lc, lr);
    }
    if (!consistent || !map.size) continue;
    const prefix = `${track}:`;
    const next = {};
    for (const [k, v] of Object.entries(out)) {
      if (!k.startsWith(prefix)) { next[k] = v; continue; }
      const l = Number(k.slice(prefix.length));
      next[layerKey(track, map.has(l) ? map.get(l) : l)] = v;
    }
    out = next;
  }
  // Translation creates a hidden layer as part of its document edit. Its initial
  // state follows the layer's existence, without changing toggles on old layers.
  for(const clip of cur.textClips||[])if(clip.source==='plugin-translation'&&layerOf(clip)>=layerCount(restored,'text'))delete out[layerKey('text',layerOf(clip))];
  for(const clip of restored.textClips||[])if(clip.source==='plugin-translation'&&layerOf(clip)>=layerCount(cur,'text')){
    const key=layerKey('text',layerOf(clip));if(restored.layerState?.[key])out[key]=restored.layerState[key];
  }
  return out;
}

// History wrapper. Actions with `transient: true` (e.g. live drag updates) don't push undo steps;
// a 'commit' action records the state captured at drag start.
// Background thumbnails/waveforms arrive by file path; patch them into every history state so
// undo/redo never brings back a media item without its visuals.
function patchVisuals(p, a, mediaCache) {
  let media = mediaCache.get(p.media);
  if (!media) {
    media = p.media.some(m => m.path === a.path)
      ? p.media.map(m => m.path === a.path ? { ...m, ...a.patch } : m) : p.media;
    mediaCache.set(p.media, media);
  }
  return media === p.media ? p : { ...p, media };
}

function finishAgentEdit(state, interruption) {
  const { agentEdit, ...rest } = state;
  if (!agentEdit) return state;
  const cause = interruption ? { agentInterruption: { token: agentEdit.token, action: interruption.type, ...(interruption.track ? { track: interruption.track } : {}), fields: Object.keys(interruption.patch || {}) } } : {};
  if (!agentEdit.steps.length) return { ...rest, ...cause, future: agentEdit.future };
  // A press held across the commit restarts its gesture here: the edit is one Undo step of its own.
  return { ...rest, ...cause, past: [...state.past, agentEdit.base].slice(-100), future: [], ...(state.gestureStart ? { gestureStart: state.present } : {}) };
}

const preparedActions = new WeakMap();
// A preflight result can be consumed only with its exact project and action.
// The private token survives the owner's agentToken wrapper; JSON/tool inputs
// cannot forge it. A concurrent edit/lock change falls back to normal guards.
export function prepareProjectAction(project, action) {
  const next = historyReducer({ past: [], present: project, future: [] }, action, true).present;
  const token = {};
  preparedActions.set(token, { base: project, next, action });
  return { project: next, action: { ...action, preparedAction: token } };
}

// Only trusted host planning can mint these tokens; plugin-authored actions cannot.
const pluginEditPlans=new WeakMap(),pluginClipArrays=new WeakMap();
export const pluginEditsApplied=(history,action)=>!!action?.token&&!!history?.pluginEditReceipts?.includes(action.token);
// Range edits preserve the timeline clock. They never call the UI's magnet/gap
// normalizer or linked-edit helpers. All new IDs are host-owned and private.
function planPluginMainRange(main,id,op,allocateId){
 const before=videoLayout(main),hit=before.find(l=>l.clip.id===id);
 if(!hit||hit.clip.gap)throw Error('Invalid main edit target.');
 const {clip,index,start,end}=hit,length=end-start,speed=clip.speed||1,next=main[index+1];
 const from=op.type==='split'?0:op.start_sec-start,to=op.type==='split'?length:op.end_sec-start;
 const epsilon=1e-8;
 if(op.type==='trim-main'&&(from<-epsilon||to>length+epsilon||to-from<MIN_CLIP-1e-9))throw Error('Main trim must crop the current clip range without extension.');
 if(op.type==='trim-main'&&Math.abs(from)<epsilon&&Math.abs(to-length)<epsilon)return main;
 const cut=op.at_sec-start;
 if(op.type==='split'&&(cut<MIN_CLIP-1e-9||length-cut<MIN_CLIP-1e-9))throw Error('Both split halves must retain at least 0.1 seconds.');
 const hasTransition=c=>!!c?.transition&&c.transition.type!=='none';
 if(op.transitions==='reject'&&(hasTransition(clip)||hasTransition(next)))throw Error('Main edit touches an incoming or outgoing transition. Choose preserve-overlap explicitly.');
 const incoming=hit.trans,outgoing=transitionDur(main,index+1);
 const head=Math.max(0,from),tail=Math.max(0,length-to);
 const keptIn=op.type==='split'?incoming:Math.max(0,incoming-head),keptOut=op.type==='split'?outgoing:Math.max(0,outgoing-tail);
 const leftLength=op.type==='split'?cut:to-from,rightLength=op.type==='split'?length-cut:to-from;
 if(keptIn>leftLength+epsilon||keptOut>rightLength+epsilon)throw Error('Main edit would cut inside a retained transition overlap.');
 let sourceIndex=index,successorIndex;const list=[...main],expected=new Map();
 if(op.type==='split'){
  const sourceCut=clip.in+cut*speed,rightId=allocateId();
  const left={...clip,out:sourceCut,anim:splitAnim(clip.anim,'left'),...sliceFades(clip,0,cut,length)};
  const right={...clip,id:rightId,in:sourceCut,transition:null,anim:splitAnim(clip.anim,'right'),...sliceFades(clip,cut,length,length)};
  list.splice(index,1,left,right);successorIndex=index+2;
  expected.set(id,{start,end:op.at_sec});expected.set(rightId,{start:op.at_sec,end});
 }else{
  const patch={in:clip.in+head*speed,out:clip.in+Math.min(length,to)*speed,...sliceFades(clip,head,Math.min(length,to),length)};
  if(clip.anim){const {in:enter,out:leave,...rest}=clip.anim;patch.anim={...rest,...(head<epsilon&&enter?{in:enter}:{}),...(tail<epsilon&&leave?{out:leave}:{})};}
  const replacement=[],headGap=Math.max(0,head-incoming),tailGap=Math.max(0,tail-outgoing);
  if(headGap>epsilon){replacement.push(newGap(allocateId(),headGap));sourceIndex++;}
  replacement.push({...clip,...patch});
  if(tailGap>epsilon)replacement.push(newGap(allocateId(),tailGap));
  list.splice(index,1,...replacement);successorIndex=index+replacement.length;
  expected.set(id,{start:start+head,end:end-tail});
 }
 const retain=(at,oldOverlap,wanted,clearDormant=false)=>{
  const c=list[at];if(!hasTransition(c))return;
  if(wanted<=epsilon){if(oldOverlap>epsilon||clearDormant)list[at]={...c,transition:null};return;}
  if(Math.abs(transitionDur(list,at)-wanted)>epsilon)list[at]={...c,transition:{...c.transition,timelineOverlap:wanted,...(wanted<oldOverlap-epsilon?{duration:wanted}:{})}};
 };
 retain(sourceIndex,incoming,keptIn,op.type==='trim-main'&&index===0&&sourceIndex!==0);
 if(next)retain(successorIndex,outgoing,keptOut);
 const after=videoLayout(list),byId=new Map(after.map(l=>[l.clip.id,l]));
 for(const l of before){const wanted=expected.get(l.clip.id)||l,actual=byId.get(l.clip.id);if(!actual||Math.abs(actual.start-wanted.start)>epsilon||Math.abs(actual.end-wanted.end)>epsilon)throw Error('Main edit would retime another clip.');}
 for(const [key,wanted] of expected){const actual=byId.get(key);if(!actual||Math.abs(actual.start-wanted.start)>epsilon||Math.abs(actual.end-wanted.end)>epsilon)throw Error('Main edit timing could not be preserved.');}
 return list;
}
function pluginArraysLocked(project,token){
 const plan=pluginClipArrays.get(token);if(!plan)return true;
 for(const [track,key] of Object.entries(TRACKS))if(Object.hasOwn(plan.arrays,key)){
  if(project[key]!==plan.base[key])return true;
  const old=new Map(project[key].map(c=>[c.id,c])),next=new Map(plan.arrays[key].map(c=>[c.id,c]));
  for(const c of [...project[key],...plan.arrays[key]])if(old.get(c.id)!==next.get(c.id)&&clipLocked(project,track,c))return true;
 }
 return false;
}
function pluginLinkedPair(project,linkId){
 const members=[];for(const track of [...Object.keys(TRACKS),'sticker'])for(const clip of project[`${track}Clips`]||[])if(clip.linkId===linkId)members.push({track,clip});
 const picture=members.find(m=>['video','overlay'].includes(m.track)),sound=members.find(m=>m.track==='audio');
 if(typeof linkId!=='string'||!linkId||members.length!==2||!picture||!sound||members.some(m=>m.clip.gap))throw Error('Linked edits need exactly one picture and one audio partner.');
 for(const m of members){const c=m.clip,sp=c.speed||1;if(!Number.isFinite(c.in)||!Number.isFinite(c.out)||c.in<0||c.out<=c.in||!Number.isFinite(sp)||sp<=0||clipLocked(project,m.track,c))throw Error('Linked partner is invalid or locked.');const media=project.media.find(v=>v.id===c.mediaId);if(media?.type!=='image'&&Number.isFinite(media?.duration)&&c.out>media.duration+1e-8)throw Error('Linked partner exceeds source bounds.');}
 const v=picture.clip,a=sound.clip,sp=v.speed||1;
 picture.start=picture.track==='video'?videoLayout(project.videoClips).find(l=>l.clip.id===v.id)?.start:v.start;
 picture.end=picture.start+(v.out-v.in)/sp;sound.start=a.start;sound.end=a.start+(a.out-a.in)/(a.speed||1);
 if(!Number.isFinite(picture.start)||picture.start<0||!Number.isFinite(sound.start)||Math.abs(picture.start-sound.start)>1e-8||Math.abs(picture.end-sound.end)>1e-8||Math.abs(sp-(a.speed||1))>1e-8||!Number.isFinite(a.linkOff??0)||Math.abs(a.linkOff||0)>1e-8||!Number.isFinite(a.linkInOff??0)||Math.abs(a.in-v.in-(a.linkInOff||0))>1e-8)throw Error('Linked partners must have aligned ranges, equal speed and consistent source offsets.');
 return {picture,sound};
}
function planPluginFreeRange(clip,start,end,op,newId){
 const length=end-start,speed=clip.speed||1,split=op.type==='split',from=split?0:op.start_sec-start,to=split?length:op.end_sec-start;
 if(!split&&(from<-1e-8||to>length+1e-8||to-from<MIN_CLIP-1e-9))throw Error('Linked trim must crop both current ranges without extension.');
 const cut=op.at_sec-start;if(split&&(cut<MIN_CLIP-1e-9||length-cut<MIN_CLIP-1e-9))throw Error('Both linked split halves must retain at least 0.1 seconds.');
 if(split)return [{...clip,out:clip.in+cut*speed,anim:splitAnim(clip.anim,'left'),...sliceFades(clip,0,cut,length)}, {...clip,id:newId,start:op.at_sec,in:clip.in+cut*speed,anim:splitAnim(clip.anim,'right'),...sliceFades(clip,cut,length,length)}];
 const head=Math.max(0,from),tail=Math.max(0,length-to),patch={start:start+head,in:clip.in+head*speed,out:clip.in+Math.min(length,to)*speed,...sliceFades(clip,head,Math.min(length,to),length)};
 if(clip.anim){const {in:enter,out:leave,...rest}=clip.anim;patch.anim={...rest,...(head<1e-8&&enter?{in:enter}:{}),...(tail<1e-8&&leave?{out:leave}:{})};}
 return [{...clip,...patch}];
}
export function preparePluginEdits(project,context,targets,value,permissions=['clips.write']){
 const transaction=clipTransaction(value,context,projectDuration(project),permissions);
 if(!Array.isArray(targets)||targets.length!==context.timeline.clips.length)throw Error('Invalid private edit targets.');
 const bindings=new Map(targets.map(t=>[t.handle,t]));
 if(bindings.size!==targets.length)throw Error('Duplicate private edit targets.');
 const originals=new Map(),updated=new Map();
 let main=project.videoClips,overlay=project.overlayClips,audio=project.audioClips;const approvedLinked=new Map();const beforeMain=videoLayout(main),mainById=new Map(beforeMain.map(l=>[l.clip.id,l]));
 const usedIds=new Set([...Object.values(TRACKS).flatMap(key=>(project[key]||[]).map(c=>c.id)),...(project.media||[]).map(m=>m.id),...(project.markers||[]).map(m=>m.id),...(project.stickerClips||[]).flatMap(c=>[c.id,c.linkId]),...Object.values(TRACKS).flatMap(key=>(project[key]||[]).map(c=>c.linkId))]);
 const allocateId=()=>{for(let i=0;i<32;i++){const id='plugin-'+uid();if(!usedIds.has(id)){usedIds.add(id);return id;}}throw Error('Could not allocate a unique clip ID.');};
 const mainTarget=handle=>{
  const binding=bindings.get(handle),publicClip=context.timeline.clips.find(c=>c.id===handle),layout=binding&&mainById.get(binding.id);
  if(!binding||binding.track!=='video'||!layout||!publicClip?.main||context.timeline.main_total!==project.videoClips.length||publicClip.trackId!=='video:0'||publicClip.main.index!==layout.index||publicClip.gap!==!!layout.clip.gap||Math.abs(publicClip.start_sec-layout.start)>1e-8||Math.abs(publicClip.end_sec-layout.end)>1e-8||publicClip.main.transition!==(!!layout.clip.transition&&layout.clip.transition.type!=='none')||Math.abs(publicClip.main.overlap_sec-layout.trans)>1e-8)throw Error('Main clip target context changed.');
  return binding.id;
 };
 const model=()=>({...project,videoClips:main,overlayClips:overlay,audioClips:audio});
 const approvePair=pair=>{for(const m of [pair.picture,pair.sound])approvedLinked.set(JSON.stringify([m.track,m.clip.id]),m.clip);};
 const linkedTarget=handle=>{
  const binding=bindings.get(handle),publicClip=context.timeline.clips.find(c=>c.id===handle),original=binding&&project[TRACKS[binding.track]]?.find(c=>c.id===binding.id);
  if(!binding||!original||!publicClip?.link||binding.linkGroup!==publicClip.link.groupId||binding.linkId!==original.linkId)throw Error('Private linked target context changed.');
  if(binding.track==='video')mainTarget(handle);
  else if(publicClip.trackId!==`${binding.track}:${clipLayer(binding.track,original)}`||Math.abs(original.start-publicClip.start_sec)>1e-8||Math.abs(original.start+freeLen(binding.track,original)-publicClip.end_sec)>1e-8)throw Error('Linked target timing changed.');
  return binding;
 };
 for(const op of transaction.operations){
  if(['split-linked','trim-linked'].includes(op.type)){
   const a=linkedTarget(op.clipId),b=linkedTarget(op.partnerClipId);
   if(a.linkId!==b.linkId)throw Error('Linked targets belong to different groups.');
   const originalPair=pluginLinkedPair(project,a.linkId),pair=pluginLinkedPair(model(),a.linkId);
   if(![pair.picture,pair.sound].every(m=>[a,b].some(t=>t.track===m.track&&t.id===m.clip.id))||originalPair.picture.track!==pair.picture.track)throw Error('Linked partner membership changed.');
   const split=op.type==='split-linked',range={...op,type:split?'split':'trim-main'},pic=pair.picture,sound=pair.sound;
   if(!split&&Math.abs(op.start_sec-pic.start)<1e-8&&Math.abs(op.end_sec-pic.end)<1e-8)continue;
   let picPieces;
   if(pic.track==='video'){
    const previous=new Set(main.map(c=>c.id));main=planPluginMainRange(main,pic.clip.id,range,allocateId);
    picPieces=split?[main.find(c=>c.id===pic.clip.id),main.find(c=>!previous.has(c.id))]:[main.find(c=>c.id===pic.clip.id)];
   }else{
    picPieces=planPluginFreeRange(pic.clip,pic.start,pic.end,{...range,type:split?'split':'trim'},split?allocateId():null);
    overlay=overlay.flatMap(c=>c.id===pic.clip.id?picPieces:[c]);
   }
   const sourceOffset=sound.clip.linkInOff||0,pictureStarts=pic.track==='video'?new Map(videoLayout(main).map(l=>[l.clip.id,l.start])):null;
   // Anchor sound to the exact picture arithmetic used by link synchronization.
   // Independent floating-point slices can otherwise trigger a hidden repair.
   const audioPieces=planPluginFreeRange(sound.clip,sound.start,sound.end,{...range,type:split?'split':'trim'},split?allocateId():null).map((c,i)=>({...c,start:pictureStarts?pictureStarts.get(picPieces[i].id):picPieces[i].start,in:picPieces[i].in+sourceOffset,out:picPieces[i].out+sourceOffset,speed:picPieces[i].speed||1}));
   if(split){const linkId=allocateId();picPieces[1]={...picPieces[1],linkId};audioPieces[1]={...audioPieces[1],linkId,linkOff:0,linkInOff:sourceOffset};
    if(pic.track==='video')main=main.map(c=>c.id===picPieces[1].id?picPieces[1]:c);else overlay=overlay.map(c=>c.id===picPieces[1].id?picPieces[1]:c);
   }
   audio=audio.flatMap(c=>c.id===sound.clip.id?audioPieces:[c]);
   approvePair(pluginLinkedPair(model(),a.linkId));if(split)approvePair(pluginLinkedPair(model(),picPieces[1].linkId));
   continue;
  }

  if(['split','trim-main','reorder'].includes(op.type)){
   if(mainById.size!==project.videoClips.length||beforeMain.some(l=>!Number.isFinite(l.start)||!Number.isFinite(l.end)||l.start<0||l.end<=l.start||!Number.isFinite(l.clip.in)||!Number.isFinite(l.clip.out)||l.clip.in<0||l.clip.out<=l.clip.in||!Number.isFinite(l.clip.speed||1)||(l.clip.speed||1)<=0)||isLayerLocked(project,'video',0))throw Error('Main sequence is invalid or locked.');
  }
  if(['split','trim-main'].includes(op.type)){
   main=planPluginMainRange(main,mainTarget(op.clipId),op,allocateId);continue;
  }
  if(op.type==='reorder'){
   const id=mainTarget(op.clipId),anchor=op.beforeClipId===null?null:mainTarget(op.beforeClipId);
   const prior=new Map(main.map((c,i)=>[c.id,i?main[i-1].id:null])),next=[...main],index=next.findIndex(c=>c.id===id),[clip]=next.splice(index,1);
   const at=anchor===null?next.length:next.findIndex(c=>c.id===anchor);if(index<0||at<0||!clip||clip.gap)throw Error('Invalid main reorder target.');
   next.splice(at,0,clip);
   main=next.map((c,i)=>{
    if(prior.get(c.id)===(i?next[i-1].id:null)||!c.transition||c.transition.type==='none')return c;
    if(op.transitions==='reject')throw Error('Reorder changes an incoming transition. Choose clear-boundaries explicitly.');
    return {...c,transition:null};
   });
   continue;
  }
  const binding=bindings.get(op.clipId),publicClip=context.timeline.clips.find(c=>c.id===op.clipId);
  if(!binding||!publicClip||!EDITABLE_LANES.includes(binding.track))throw Error('Unknown clip edit target.');
  const key=TRACKS[binding.track],original=project[key]?.find(c=>c.id===binding.id);
  if(!original||original.gap||original.linkId||clipLocked(project,binding.track,original))throw Error('Clip is unavailable, linked or locked.');
  if(publicClip.trackId!==`${binding.track}:${clipLayer(binding.track,original)}`||Math.abs(original.start-publicClip.start_sec)>1e-8||Math.abs(original.start+freeLen(binding.track,original)-publicClip.end_sec)>1e-8)throw Error('Clip target context changed.');
  const privateKey=JSON.stringify([binding.track,binding.id]);
  if(!originals.has(privateKey))originals.set(privateKey,{binding,original});
  const current=updated.get(privateKey)||original,oldStart=current.start,oldEnd=oldStart+freeLen(binding.track,current);
  let patch={start:op.start_sec};
  if(op.type==='trim'){
   const from=op.start_sec-oldStart,to=op.end_sec-oldStart;
   if(['overlay','audio'].includes(binding.track)){
    const speed=current.speed||1;if(!Number.isFinite(speed)||speed<=0)throw Error('Invalid clip speed.');
    patch={...patch,in:current.in+from*speed,out:current.in+to*speed,...sliceFades(current,from,to,oldEnd-oldStart)};
    const media=project.media.find(m=>m.id===current.mediaId);
    if(!Number.isFinite(patch.in)||!Number.isFinite(patch.out)||patch.in<0||(media?.type!=='image'&&Number.isFinite(media?.duration)&&patch.out>media.duration+1e-8))throw Error('Trim exceeds source bounds.');
   }else patch={...patch,duration:op.end_sec-op.start_sec,...(binding.track==='text'?cropWordTiming(current,from,to):{})};
   if(binding.track==='text'&&current.caption&&current.words?.length&&patch.words?.length===0)throw Error('Trim would remove every measured caption word.');
   if(current.anim){const {in:enter,out:leave,...rest}=current.anim;patch.anim={...rest,...(Math.abs(from)<1e-9&&enter?{in:enter}:{}),...(Math.abs(op.end_sec-oldEnd)<1e-9&&leave?{out:leave}:{})};}
  }
  updated.set(privateKey,{...current,...patch});
 }
 for(const [key,clip] of updated){const {binding}=originals.get(key);if(binding.track==='overlay')overlay=overlay.map(c=>c.id===binding.id?clip:c);if(binding.track==='audio')audio=audio.map(c=>c.id===binding.id?clip:c);}
 const expected={...project,videoClips:main,overlayClips:overlay,audioClips:audio};
 for(const [key,clip] of updated){const {binding}=originals.get(key);if(!['overlay','audio'].includes(binding.track))expected[TRACKS[binding.track]]=expected[TRACKS[binding.track]].map(c=>c.id===binding.id?clip:c);}
 const freeChanges=[];
 for(const track of EDITABLE_LANES){const key=TRACKS[track],before=new Map(project[key].map(c=>[c.id,c]));for(const clip of expected[key])if(JSON.stringify(clip)!==JSON.stringify(before.get(clip.id))){if(clipLocked(project,track,clip))throw Error('Edited track is locked.');if(clip.linkId&&approvedLinked.get(JSON.stringify([track,clip.id]))!==clip)throw Error('Linked free clip was changed without an explicit pair operation.');freeChanges.push({track,clip});}}
 const reordered=main.length!==project.videoClips.length||main.some((c,i)=>c!==project.videoClips[i]);
 const affectedMain=new Set();
 if(reordered){
  // Inserting a split half or gap does not itself edit every later clip. Compare
  // relative order of original records separately from their absolute indices.
  const originalRanks=new Map(main.filter(c=>mainById.has(c.id)).map((c,i)=>[c.id,i]));
  for(const l of videoLayout(main)){
   const old=mainById.get(l.clip.id);
   if(!Number.isFinite(l.start)||!Number.isFinite(l.end)||l.start<0||l.end<=l.start||l.end>1e9)throw Error('Invalid edited main timing.');
   if(!old||old.index!==originalRanks.get(l.clip.id)||old.clip!==l.clip||Math.abs(old.start-l.start)>1e-8||Math.abs(old.end-l.end)>1e-8){
    if(l.clip.linkId&&old&&old.index!==originalRanks.get(l.clip.id))throw Error('Reordering linked clips needs a separate explicit contract.');
    if(l.clip.linkId&&approvedLinked.get(JSON.stringify(['video',l.clip.id]))!==l.clip)throw Error('Main edit would retime or change an unapproved linked main clip.');
    affectedMain.add(l.clip.id);
   }
  }
  for(const lane of ['video','overlay','audio','text','effect'])for(const clip of project[TRACKS[lane]]||[])if(clip.pin?.to&&(affectedMain.has(clip.pin.to)||lane==='video'&&affectedMain.has(clip.id)))throw Error('Main edit would affect a motion-pin dependency.');
 }
 const dependencyIds=new Set([...affectedMain,...freeChanges.filter(({clip})=>clip.linkId).map(({clip})=>clip.id)]);
 for(const track of Object.keys(TRACKS))for(const c of project[TRACKS[track]])if(c.pin?.to&&(dependencyIds.has(c.pin.to)||dependencyIds.has(c.id)))throw Error('Linked edit would affect a motion-pin dependency.');
 for(const c of approvedLinked.values())pluginLinkedPair(expected,c.linkId);
 const clipsChanged=freeChanges.length+affectedMain.size;
 if(clipsChanged>64)throw Error('A clip transaction may affect at most 64 clips.');
 if(!clipsChanged)return {action:null,clipsChanged:0};
 for(const {track,clip} of freeChanges){
  const end=clip.start+freeLen(track,clip);
  if(!Number.isFinite(end)||clip.start<0||end>projectDuration(project)+1e-8)throw Error('Clip range exceeds the project.');
  if(['audio','overlay'].includes(track)){const media=project.media.find(m=>m.id===clip.mediaId);if(!Number.isFinite(clip.in)||!Number.isFinite(clip.out)||clip.in<0||clip.out<=clip.in||(media?.type!=='image'&&Number.isFinite(media?.duration)&&clip.out>media.duration+1e-8))throw Error('Clip edit exceeds source bounds.');}
  for(const other of expected[TRACKS[track]])if(other.id!==clip.id&&clipLayer(track,other)===clipLayer(track,clip)&&other.start<end-1e-6&&clip.start<other.start+freeLen(track,other)-1e-6)throw Error('Clip edit would overlap another clip.');
 }
 const arrays=Object.fromEntries(Object.values(TRACKS).filter(key=>expected[key]!==project[key]).map(key=>[key,expected[key]])),arrayToken={};pluginClipArrays.set(arrayToken,{base:project,arrays});
 const actions=[{type:'preparedPluginClips',token:arrayToken}];
 const prepared=prepareProjectAction(project,{type:'batch',actions});
 if(JSON.stringify(prepared.project)!==JSON.stringify(expected))throw Error('Clip edit would cause an unsupported collateral change.');
 const token={};pluginEditPlans.set(token,{base:project,next:prepared.project,actions});
 return {action:{type:'pluginClipEdits',base:project,token},clipsChanged};
}

export function historyReducer(state, a, preview = false) {
  let editToken;
  if(a.type==='pluginClipEdits'){
    const plan=pluginEditPlans.get(a.token);
    const sameBase=state.present===a.base||a.agentToken&&a.base&&[...new Set([...Object.keys(state.present),...Object.keys(a.base)])].every(key=>key==='craftAI'||state.present[key]===a.base[key]);
    if(!plan||pluginEditsApplied(state,a)||plan.base!==a.base||!sameBase||state.gestureStart||(a.agentToken?state.agentEdit?.token!==a.agentToken:state.agentEdit))return state;
    editToken=a.token;
    const next=state.present===plan.base?plan.next:{...plan.next,craftAI:state.present.craftAI};
    const preparedAction={},action={type:'batch',actions:plan.actions};
    preparedActions.set(preparedAction,{base:state.present,next,action});
    a={...action,preparedAction,...(a.agentToken?{agentToken:a.agentToken}:{})};
  }
  if(a.type==='pluginMarkers'||a.type==='pluginCaptionTrack'){
    // CraftAI saves chat/progress while awaiting a command. Only that field may
    // differ from its captured object; queued document changes still refuse it.
    const sameBase=state.present===a.base||a.agentToken&&a.base&&[...new Set([...Object.keys(state.present),...Object.keys(a.base)])].every(key=>key==='craftAI'||state.present[key]===a.base[key]);
    if(!sameBase||state.gestureStart||(a.agentToken?state.agentEdit?.token!==a.agentToken:state.agentEdit))return state;
    if(a.type==='pluginCaptionTrack')a={type:'addCaptionTranslation',sourceTrack:a.sourceTrack,translation:a.translation,ids:a.ids,...(a.agentToken?{agentToken:a.agentToken}:{})};
    else {
    const proposals=uniqueCommandMarkers(state.present,a.markers,projectDuration(state.present));
    if(!proposals.length)return state;
    if(!Array.isArray(a.ids)||a.ids.length!==proposals.length||new Set(a.ids).size!==a.ids.length||a.ids.some(id=>typeof id!=='string'||!id||state.present.markers?.some(m=>m.id===id)))return state;
    a={type:'batch',...(a.agentToken?{agentToken:a.agentToken}:{}),actions:proposals.map((m,i)=>({type:'addMarker',id:a.ids[i],...m}))};
    }
  }

  let next = reduceHistory(state, a);
  const receipts=a.type==='load'?[]:state.pluginEditReceipts||[];
  if(!preview&&editToken&&next.present!==state.present)next={...next,pluginEditReceipts:[...receipts,editToken].slice(-256)};
  else if(next!==state&&receipts.length)next={...next,pluginEditReceipts:receipts};
  // Undo/gesture branches intentionally rebuild history objects. Retain the
  // interruption diagnosis until a new request or project explicitly clears it.
  if (state.agentInterruption && !next.agentInterruption && !['load', 'beginAgentEdit'].includes(a.type)) next = { ...next, agentInterruption: state.agentInterruption };
  markProjectSnapshot(next.present);
  return next;
}

function reduceHistory(state, a) {
  if (a.type === 'beginAgentEdit') {
    if (typeof a.token !== 'string' || !a.token || state.agentEdit || state.gestureStart) return state;
    return { ...state, agentInterruption: undefined, agentEdit: { token: a.token, base: state.present, steps: [], future: state.future } };
  }
  if (a.type === 'endAgentEdit') return state.agentEdit?.token === a.token ? finishAgentEdit(state) : state;
  if (a.type === 'undoAgentEdit') {
    const edit = state.agentEdit;
    if (!edit || edit.token !== a.token || !edit.steps.length) return state;
    const restored = edit.steps.at(-1), steps = edit.steps.slice(0, -1);
    return { ...state, present: { ...restored, layerState: followLayerState(state.present, restored) },
      future: steps.length ? [] : edit.future, agentEdit: { ...edit, steps } };
  }
  if (a.type === 'craftChat') {
    if (a.projectId !== state.present.id) return state;
    // Chat is saved with the project but never creates timeline Undo steps.
    // Carry it across every snapshot, including an in-progress drag gesture.
    const patch = (p) => p && ({ ...p, craftAI: a.chat });
    return { ...state, present: patch(state.present), past: state.past.map(patch),
      future: state.future.map(patch), gestureStart: patch(state.gestureStart),
      ...(state.agentEdit ? { agentEdit: { ...state.agentEdit, base: patch(state.agentEdit.base), steps: state.agentEdit.steps.map(patch), future: state.agentEdit.future.map(patch) } } : {}) };
  }
  if (a.type === 'projectVisuals') {
    // Rendered cover files are derived presentation data, like mediaVisuals.
    // They must neither revoke an editor transaction nor enter timeline Undo.
    if (a.projectId !== state.present.id || !a.patch || Object.keys(a.patch).some(key => !['posterImage', 'posterImageAt'].includes(key))
      || a.patch.posterImage !== undefined && a.patch.posterImage !== null && typeof a.patch.posterImage !== 'string'
      || a.patch.posterImageAt !== undefined && (!Number.isFinite(a.patch.posterImageAt) || a.patch.posterImageAt < 0)) return state;
    const patch = p => p && ({ ...p, ...a.patch });
    return { ...state, present: patch(state.present), past: state.past.map(patch), future: state.future.map(patch), gestureStart: patch(state.gestureStart),
      ...(state.agentEdit ? { agentEdit: { ...state.agentEdit, base: patch(state.agentEdit.base), steps: state.agentEdit.steps.map(patch), future: state.agentEdit.future.map(patch) } } : {}) };
  }
  // File/slot callers validate synchronously to show an error before dispatch.
  // Keep direct load callers (templates, recovery and the test harness) safe too.
  if (a.type === 'load') {
    try { validateProject(a.project); } catch { return state; }
  }
  if (a.type === 'mediaVisuals') {
    // Most Undo snapshots share the same media array. Patch each distinct array
    // once instead of cloning the full library for every history checkpoint.
    const mediaCache = new Map(), patch = p => patchVisuals(p, a, mediaCache);
    return {
      ...state,
      past: state.past.map(patch),
      present: patch(state.present),
      future: state.future.map(patch),
      gestureStart: state.gestureStart && patch(state.gestureStart),
      ...(state.agentEdit ? { agentEdit: { ...state.agentEdit, base: patch(state.agentEdit.base),
        steps: state.agentEdit.steps.map(patch), future: state.agentEdit.future.map(patch) } } : {}),
    };
  }
  if (a.type === 'setLayerState') {
    // Lock / hide / mute / solo toggles are view-and-guard state, NOT document edits: they
    // never push an undo step, and undo / redo never change them (they are carried over
    // the restored project below, like mediaVisuals patches the visuals).
    const key = layerKey(a.track, a.layer);
    const cur = { ...layerStateOf(state.present, a.track, a.layer), ...a.patch };
    const layerState = { ...(state.present.layerState || {}) };
    if (!cur.locked && !cur.hidden && !cur.muted && !cur.solo) delete layerState[key];
    else layerState[key] = cur;
    if (JSON.stringify(layerState) === JSON.stringify(state.present.layerState || {})) return state;
    return { ...state, present: { ...state.present, layerState } };
  }
  // Only the owner may add to an open agent transaction. A manual document edit
  // first commits the agent checkpoint, then revokes its token. Later in-flight
  // agent results cannot overwrite that manual edit or absorb it into Undo.
  if (a.agentToken && state.agentEdit?.token !== a.agentToken) return state;
  // Explicit history/navigation intent revokes ownership immediately. Other
  // actions must first pass locks/validation and actually change the document.
  // A late blur, ignored callback or rejected edit is not a new edit, and neither
  // is pressing on a clip: the timeline begins a gesture on every press before
  // it knows whether this is a drag or a selection. A gesture interrupts the
  // request at its first real change (below), never by starting.
  if (state.agentEdit && !a.agentToken && ['undo', 'redo', 'load'].includes(a.type)) return historyReducer(finishAgentEdit(state, a), a);
  if (a.type === 'undo') {
    if (!state.past.length) return state;
    const restored = state.past[state.past.length - 1];
    return { past: state.past.slice(0, -1), present: { ...restored, layerState: followLayerState(state.present, restored) }, future: [state.present, ...state.future] };
  }
  if (a.type === 'redo') {
    if (!state.future.length) return state;
    const restored = state.future[0];
    return { past: [...state.past, state.present], present: { ...restored, layerState: followLayerState(state.present, restored) }, future: state.future.slice(1) };
  }
  // Folds every undo step created since `from` (a past.length noted earlier) into one, so a whole AI request
  // can be undone with a single Undo.
  if (a.type === 'collapseHistory') {
    if (state.past.length <= a.from) return state;
    return { ...state, past: state.past.slice(0, a.from + 1) };
  }
  if (a.type === 'beginGesture') return { ...state, gestureStart: state.present };
  if (a.type === 'endGesture') {
    const start = state.gestureStart;
    // Still owned by the request: the gesture changed nothing itself (its first change would have
    // ended the request), so any difference is the agent's and belongs to the agent's Undo step.
    if (state.agentEdit) return { ...state, gestureStart: null };
    if (!start || start === state.present) return { ...state, gestureStart: null };
    return { past: [...state.past, start].slice(-100), present: state.present, future: [], gestureStart: null };
  }
  // Locked layers refuse edits before anything is computed (undo / redo returned above,
  // so history navigation is never blocked by a lock).
  if (actionLocked(state.present, a)) return state;
  const prepared = a.preparedAction && preparedActions.get(a.preparedAction);
  const reuse = prepared && prepared.base === state.present && !state.gestureStart
    && Object.keys(prepared.action).every(key => prepared.action[key] === a[key])
    && Object.keys(a).every(key => key === 'preparedAction' || key === 'agentToken' || Object.hasOwn(prepared.action, key));
  let reduced = reuse ? prepared.next : a.type === 'trimClip' ? trimClip(state.gestureStart || state.present, a) : reduceProject(state.present, a);
  if (!reuse && a.coverExport && reduced !== state.present) {
    // This tail is coverage for free-track content, not a user-authored gap.
    // Recompute it after intermediate insert/trim actions so importing a whole
    // song and then choosing a short range cannot leave an unwanted long tail.
    const tail = reduced.videoClips.at(-1);
    const covered = tail?.agentCoverage === true;
    const base = covered ? { ...reduced, videoClips: reduced.videoClips.slice(0, -1) } : reduced;
    const endOfMain = exportDuration(base);
    let required = endOfMain;
    for (const track of ['overlay', 'audio', 'text', 'effect']) {
      const key = TRACKS[track];
      const oldById = new Map((state.present[key] || []).map(c => [c.id, c]));
      for (const clip of reduced[key] || []) {
        const old = oldById.get(clip.id);
        const end = clip.start + freeLen(track, clip);
        if (covered || !old || Math.abs(end - old.start - freeLen(track, old)) > 1e-7) required = Math.max(required, end);
      }
    }
    if (covered || required > endOfMain + 1e-7) {
      if (isLayerLocked(state.present, 'video', 0)) return state;
      reduced = { ...base, videoClips: [...base.videoClips, ...(required > endOfMain + 1e-7
        ? [{ ...newGap(covered ? tail.id : `${a.clipId || a.id || uid()}~tail`, required - endOfMain), agentCoverage: true }] : [])] };
    }
  }
  if (reduced === state.present) return state;
  let next = reuse ? reduced : placeLayers(reduced, state.present);
  if (next !== state.present && placementBlocked(state.present, next, a)) return state;
  if (!reuse && next !== state.present) {
    next = syncLinked(state.present, next);
    // Older projects can contain drift. Loading or unrelated edits must not
    // freeze them; reject only a newly introduced or worsened mismatch.
    if (a.type !== 'load') {
      const prior = linkPairs(state.present);
      const presentStart = picStarts(state.present), nextStart = picStarts(next);
      const drift = (startOf, pair) => {
        if (!pair?.pic || !pair?.aud) return [0, 0, 0, 0];
        const pic = pair.pic.clip, aud = pair.aud.clip;
        return [aud.start - startOf(pair.pic.track, pic) - (aud.linkOff || 0), aud.in - pic.in - (aud.linkInOff || 0),
          aud.out - pic.out - (aud.linkInOff || 0), (aud.speed || 1) - (pic.speed || 1)].map(Math.abs);
      };
      for (const [id, pair] of linkPairs(next)) {
        const was = drift(presentStart, prior.get(id));
        if (drift(nextStart, pair).some((value, i) => value > 1e-6 && value > was[i] + 1e-6)) return state;
      }
    }
  }
  if (next === state.present) return state;
  if (a.type === 'load') return { past: [], present: next, future: [] };
  if (state.agentEdit && !a.agentToken) state = finishAgentEdit(state, a);
  // An agent step while the user holds a gesture moves the gesture's base along, so a manual trim
  // or drag that follows starts from the agent's latest result instead of reverting it.
  if (state.agentEdit && a.agentToken === state.agentEdit.token) return { ...state, present: next, future: [],
    ...(state.gestureStart ? { gestureStart: next } : {}),
    agentEdit: { ...state.agentEdit, steps: [...state.agentEdit.steps, state.present] } };
  if (a.transient || state.gestureStart) return { ...state, present: next };
  return { ...(state.agentInterruption ? { agentInterruption: state.agentInterruption } : {}), past: [...state.past, state.present].slice(-100), present: next, future: [] };
}

// Playback quality: which copy of a video the player plays. 'full' is the original chain; the other
// levels play a scaled copy whose longest side is capped (electron/media/quality.cjs has the same math for
// the generator; the test suite asserts the two agree). The export always reads m.path.
export const PLAYBACK_QUALITIES = ['full', 'high', 'medium', 'low'];
export const QUALITY_MAX_SIDE = { high: 1280, medium: 960, low: 640 };
export const QUALITY_LABELS = { full: 'Full', high: 'High', medium: 'Medium', low: 'Low' };

let playbackQuality = 'full';
export const setPlaybackQuality = (q) => { playbackQuality = PLAYBACK_QUALITIES.includes(q) ? q : 'full'; };
export const getPlaybackQuality = () => playbackQuality;
export const proxyPrefOn = () => playbackQuality !== 'full';

const evenPx = (n) => Math.max(2, Math.round(n / 2) * 2);
// The pixel size a level's copy of a video gets, or null when no copy is needed (see quality.cjs).
export function qualityTargetSize(width, height, quality) {
  const max = QUALITY_MAX_SIDE[quality];
  if (!max || !width || !height) return null;
  const long = Math.max(width, height);
  if (long <= max) return null;
  const s = max / long;
  return { width: evenPx(width * s), height: evenPx(height * s) };
}

// What state a media item's copy for `quality` is in:
// 'na' (level Full, not a video, or the source already fits the level), 'ready' (the level's own
// copy exists), 'fallback' (no copy yet: a smaller copy or the original plays meanwhile), 'failed'
// (generation failed; not retried until the file is imported again).
export function levelCopyState(m, quality) {
  if (!m || m.type !== 'video') return 'na';
  if (quality === 'full') return m.proxyRequired && !m.proxy ? m.proxyFailed ? 'failed' : 'fallback' : 'na';
  const p = m.proxies && typeof m.proxies === 'object' ? m.proxies[quality] : undefined;
  if (typeof p === 'string') return 'ready';
  if (p === false) return 'failed';
  if (m.width && m.height && !qualityTargetSize(m.width, m.height, quality)) return 'na';
  return 'fallback';
}

// The file the player plays for `m` at an explicit quality level. Fallback order below Full: the
// level's own copy, then the closest smaller existing copy (a lower level's copy, or the legacy
// light copy — about medium-sized), then the preview proxy / the original.
export function previewPathFor(m, quality) {
  if (!m) return m;
  if (quality === 'full' || m.type !== 'video') return m.proxy || (m.proxyRequired && [m.proxies?.high, m.proxies?.medium, m.proxies?.low].find(path => typeof path === 'string')) || m.path;
  if (m.width && m.height && !qualityTargetSize(m.width, m.height, quality)) return m.proxy || m.path;
  const p = m.proxies && typeof m.proxies === 'object' ? m.proxies : {};
  if (typeof p[quality] === 'string') return p[quality];
  const smaller = quality === 'high' ? [p.medium, m.lightProxy, p.low] : quality === 'medium' ? [m.lightProxy, p.low] : [m.lightProxy];
  for (const c of smaller) if (typeof c === 'string' && c) return c;
  return m.proxy || m.path;
}
export const previewPath = (m, quality = playbackQuality) => previewPathFor(m, quality);

// Player view zoom (session-only view state; never saved to the project, never touches export).
// `z` is relative to the Fit size, (x, y) the pan in screen px, `fit` marks the Fit menu choice.
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const FIT_VIEW = Object.freeze({ z: 1, x: 0, y: 0, fit: true });
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export function clampPan(view, stageW, stageH) {
  const mx = Math.max(0, ((view.z - 1) * (stageW || 0)) / 2) + 60;
  const my = Math.max(0, ((view.z - 1) * (stageH || 0)) / 2) + 60;
  return { ...view, x: Math.min(mx, Math.max(-mx, view.x)), y: Math.min(my, Math.max(-my, view.y)) };
}
export function applyZoomChoice(view, choice, stageW, stageH) {
  if (choice === 'fit') return { ...FIT_VIEW };
  const z = clampZoom(choice / 100);
  if (z <= 1) return { z, x: 0, y: 0, fit: false };
  return clampPan({ z, x: view.x || 0, y: view.y || 0, fit: false }, stageW, stageH);
}
export function zoomByFactor(view, factor, stageW, stageH) {
  const z = clampZoom(view.z * factor);
  if (z <= 1) return { ...FIT_VIEW };
  return clampPan({ z, x: view.x || 0, y: view.y || 0, fit: false }, stageW, stageH);
}
// The CSS transform for the stage element: identity (undefined) at Fit, else centre-anchored
// pan + scale. Percentages in the zoom menu are z x 100 relative to the Fit size.
export function zoomTransform(view) {
  if (!view || (view.fit && view.z === 1 && !view.x && !view.y)) return undefined;
  return `translate(${Math.round(view.x || 0)}px, ${Math.round(view.y || 0)}px) scale(${view.z})`;
}

export function toFileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return 'file:///' + parts.map((s, i) => (i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

// Look and placement of a picture clip, for "Copy / paste attributes".
export const ATTRIBUTE_KEYS = ['filter', 'filterIntensity', 'adjust', 'grade', 'effects', 'pluginEffects', 'transform', 'opacity', 'blend', 'chroma', 'mask', 'crop', 'customMask', 'enhance', 'speed', 'volume'];
export function pickAttributes(c) {
  return Object.fromEntries(ATTRIBUTE_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
}

// What plays and exports: deactivated main clips become gaps (black, silent), other deactivated clips are left out.
// Layer state applies here too — this is the one project both the preview and the export
// pipeline read, so a hidden layer vanishes from both and a muted / non-solo layer is
// silent in both: hidden picture layers are dropped (the main track leaves gaps), a
// silenced picture layer keeps its picture with clip.muted set, silenced audio clips go.
export function renderable(p) {
  const hasOff = [p.videoClips, p.overlayClips || [], p.audioClips, p.textClips, p.effectClips || []].some((l) => l.some((c) => c.disabled));
  const ls = p.layerState || {};
  const hasLayerFx = Object.values(ls).some((s) => s && (s.hidden || s.muted || s.solo));
  if (!hasOff && !hasLayerFx) return p;
  const hidden = (track, layer) => layerStateOf(p, track, layer).hidden;
  const kept = (track) => (l) => l.filter((c) => !c.disabled && !hidden(track, layerOf(c)));
  return {
    ...p,
    videoClips: p.videoClips.map((c) => (c.disabled || hidden('video', 0)
      ? { ...newGap(c.id, clipLen(c)), transition: c.transition }
      : (!layerSounds(p, 'video', 0) && !c.muted ? { ...c, muted: true } : c))),
    overlayClips: kept('overlay')(p.overlayClips || [])
      .map((c) => (!layerSounds(p, 'overlay', layerOf(c)) && !c.muted ? { ...c, muted: true } : c)),
    audioClips: (p.audioClips || []).filter((c) => !c.disabled && !hidden('audio', layerOf(c)) && layerSounds(p, 'audio', layerOf(c))),
    textClips: kept('text')(p.textClips),
    effectClips: (p.effectClips || []).filter((c) => !c.disabled && !hidden('effect', 0)),
  };
}

// Effects as timeline objects for the Effects lane: free effects (their own id, movable and trimmable) and
// effects applied to clips (key "<track>|<clipId>|<effectId>", spanning and following the clip).
export function effectObjects(p) {
  const out = (p.effectClips || []).map((e) => ({ key: e.id, free: true, fx: e.fx, start: e.start, duration: e.duration, clip: e }));
  for (const l of videoLayout(p.videoClips)) {
    if (l.clip.gap) continue;
    for (const fx of l.clip.effects || []) out.push({ key: `video|${l.clip.id}|${fx}`, track: 'video', clipId: l.clip.id, fx, start: l.start, duration: l.end - l.start });
  }
  for (const c of p.overlayClips || []) {
    for (const fx of c.effects || []) out.push({ key: `overlay|${c.id}|${fx}`, track: 'overlay', clipId: c.id, fx, start: c.start, duration: freeLen('overlay', c) });
  }
  return out;
}
export const parseEffectKey = (key) => {
  const [track, clipId, fx] = String(key).split('|');
  return { track, clipId, fx };
};
