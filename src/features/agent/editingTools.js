// Everyday editor controls shared by the API and native agent transports.
// All writes use the runner's guarded dispatch; no direct store mutation here.
import { LAYERED, clipLayer, clipLen, freeLen, findLinkPartner, isLayerLocked, layerCount, layerFree, layerStateOf, uid, videoLayout, MIN_CLIP } from '../../state/store.js';
import { stateAt } from '../timeline/anim.js';
import { sliceFades, volumeAt } from '../audio/fades.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' };
export const EDITING_DECLARATIONS = [{
  name: 'layer_tools',
  description: 'Layer controls. action add, move (layer to to_layer), delete (also deletes its clips), or update (name, locked, hidden, muted, solo). track video/effect has only layer 0 and supports update. Guard/visibility toggles follow manual UI behavior and persist independently of Undo.',
  parameters: { type: 'OBJECT', properties: {
    track: { ...S, enum: ['video', 'overlay', 'text', 'audio', 'effect'] }, action: { ...S, enum: ['add', 'move', 'delete', 'update'] },
    layer: { type: 'INTEGER' }, to_layer: { type: 'INTEGER' }, name: S, locked: B, hidden: B, muted: B, solo: B,
  }, required: ['track', 'action'] },
}];

const finite = n => typeof n === 'number' && Number.isFinite(n);
export function createEditingTools(env) {
  const { project, dispatch, after, findClip, api, settle } = env;
  const checkUnlocked = found => {
    if (isLayerLocked(project(), found.track, clipLayer(found.track, found.clip))) throw Error('The clip is on a locked layer. Unlock it explicitly with layer_tools first.');
  };
  const startOf = found => found.track === 'video'
    ? videoLayout(project().videoClips).find(row => row.clip.id === found.clip.id)?.start : found.clip.start;

  return {
    async layer_tools(a) {
      const p = project(), layered = !!LAYERED[a.track];
      if (!['video', 'effect', ...Object.keys(LAYERED)].includes(a.track)) throw Error('Unknown track family.');
      if (!['add', 'move', 'delete', 'update'].includes(a.action)) throw Error('action must be add, move, delete or update.');
      if (!layered && a.action !== 'update') throw Error('Main and Effects have one fixed layer; use update.');
      const count = layerCount(p, a.track), layer = a.layer ?? 0;
      if (!Number.isInteger(layer) || layer < 0 || layer >= (layered ? count : 1)) throw Error('layer must identify an existing layer.');
      if (a.name !== undefined && (typeof a.name !== 'string' || a.name.length > 128)) throw Error('Layer name must be text up to 128 characters.');
      const state = {};
      for (const key of ['locked', 'hidden', 'muted', 'solo']) if (a[key] !== undefined) {
        if (typeof a[key] !== 'boolean') throw Error(`${key} must be true or false.`);
        state[key] = a[key];
      }
      if (('muted' in state || 'solo' in state) && !['video', 'overlay', 'audio'].includes(a.track)) throw Error('Only picture/audio tracks support muted and solo.');
      if (a.action === 'move' && (!Number.isInteger(a.to_layer) || a.to_layer < 0 || a.to_layer >= count)) throw Error('to_layer must identify an existing layer.');
      if (a.action === 'add') {
        if (count >= 128) throw Error('The agent supports up to 128 layers per track.');
        dispatch({ type: 'addLayer', track: a.track });
        await settle();
        if (a.name !== undefined) dispatch({ type: 'renameLayer', track: a.track, layer: count, name: a.name });
        return after({ track: a.track, layer: count });
      }
      if (a.action === 'move') dispatch({ type: 'moveLayer', track: a.track, from: layer, to: a.to_layer });
      if (a.action === 'delete') dispatch({ type: 'deleteLayer', track: a.track, layer });
      if (a.action === 'update') {
        if (a.name === undefined && !Object.keys(state).length) throw Error('Give a layer name or state to update.');
        if (a.name !== undefined) dispatch({ type: 'renameLayer', track: a.track, layer, name: a.name });
        if (Object.keys(state).length) dispatch({ type: 'setLayerState', track: a.track, layer, patch: state });
      }
      const result = await after({ track: a.track, layer });
      if (a.action === 'update') {
        const actual = layerStateOf(project(), a.track, layer);
        if (Object.entries(state).some(([key, value]) => actual[key] !== value)) throw Error('The layer state did not reach its requested value.');
        result.layer_state = actual;
      }
      return result;
    },

    async splitClip({ clip_id, time_sec }) {
      const found = findClip(clip_id);
      if (!found || found.clip.gap) throw Error('Select an existing media, text or free effect clip.');
      checkUnlocked(found);
      const start = startOf(found), length = ['video', 'overlay', 'audio'].includes(found.track) ? clipLen(found.clip) : found.clip.duration;
      if (!finite(time_sec) || time_sec - start < MIN_CLIP || start + length - time_sec < MIN_CLIP) throw Error('The split must leave at least 0.1 seconds on each side.');
      const id = uid();
      dispatch({ type: 'split', track: found.track, id: clip_id, t: time_sec, newId: id });
      await settle();
      if (!findClip(id)) throw Error('This clip could not be split at that time.');
      return after({ clip_ids: [clip_id, id], split_sec: time_sec });
    },

    async freeSpeed({ clip_id, speed }) {
      const found = findClip(clip_id);
      if (!found || !['overlay', 'audio'].includes(found.track)) throw Error('Speed requires a main, overlay or audio clip.');
      checkUnlocked(found);
      if (!finite(speed) || speed < .25 || speed > 4) throw Error('speed must be between 0.25 and 4.');
      const partner = findLinkPartner(project(), found.clip);
      if (partner) checkUnlocked(partner);
      if (partner?.track === 'video') return env.setMainSpeed({ clip_id: partner.clip.id, speed });
      const target = found.track === 'audio' && partner?.track === 'overlay' ? partner : found;
      dispatch({ type: 'update', track: target.track, id: target.clip.id, patch: { speed } });
      await settle();
      if ((findClip(clip_id)?.clip.speed || 1) !== speed) throw Error('The requested speed was not applied.');
      return after({ clip_id, speed, clip_length_sec: clipLen(findClip(clip_id).clip) });
    },

    async clipOperation(a) {
      const found = findClip(a.clip_id);
      if (!found || found.clip.gap) throw Error('No editable clip with that ID.');
      const p = project(), c = found.clip;
      checkUnlocked(found);
      if (a.action === 'set_layer') {
        if (!LAYERED[found.track]) throw Error('Only Overlay, Text and Audio clips have movable layers.');
        if (!Number.isInteger(a.layer) || a.layer < 0 || a.layer >= layerCount(p, found.track)) throw Error('Choose an existing layer; layer_tools can add one.');
        if (isLayerLocked(p, found.track, a.layer)) throw Error('The destination layer is locked.');
        if (!layerFree(p, found.track, a.layer, c.start, freeLen(found.track, c), c.id)) throw Error('The destination layer overlaps another clip at this time.');
        dispatch({ type: 'update', track: found.track, id: c.id, patch: { layer: a.layer } });
        return after({ clip_id: c.id, layer: a.layer });
      }
      if (a.action === 'unlink') {
        const clips = c.linkId ? ['video', 'overlay', 'audio'].flatMap(track =>
          (p[`${track}Clips`] || []).filter(clip => clip.linkId === c.linkId).map(clip => ({ track, clip }))) : [];
        clips.forEach(checkUnlocked);
        if (clips.length) dispatch({ type: 'updateMany', updates: clips.map(f => ({ track: f.track, id: f.clip.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } })) });
        return after({ clip_ids: clips.map(f => f.clip.id) });
      }
      if (a.action === 'link') {
        const other = findClip(a.partner_clip_id);
        if (!other || other.clip.id === c.id) throw Error('partner_clip_id must identify the other clip.');
        checkUnlocked(other);
        const picture = found.track === 'audio' ? other : found, sound = found.track === 'audio' ? found : other;
        if (!['video', 'overlay'].includes(picture.track) || sound.track !== 'audio' || picture.clip.gap) throw Error('Link exactly one picture clip to one audio clip.');
        if (picture.clip.linkId || sound.clip.linkId) throw Error('Unlink existing partners before creating another pair.');
        const source = p.media.find(m => m.id === sound.clip.mediaId), out = sound.clip.in + picture.clip.out - picture.clip.in;
        if (source?.type === 'image' || !source || out > source.duration + .001) throw Error('The audio source is too short for the picture window.');
        const linkId = uid();
        dispatch({ type: 'updateMany', updates: [
          { track: picture.track, id: picture.clip.id, patch: { linkId } },
          { track: 'audio', id: sound.clip.id, patch: { linkId, linkOff: sound.clip.start - startOf(picture), linkInOff: sound.clip.in - picture.clip.in, speed: picture.clip.speed || 1, out } },
        ] });
        return after({ link_id: linkId, clip_ids: [picture.clip.id, sound.clip.id] });
      }
      if (a.action === 'freeze') {
        if (!['video', 'overlay'].includes(found.track)) throw Error('Freeze requires a picture clip.');
        const media = p.media.find(m => m.id === c.mediaId), start = startOf(found), length = clipLen(c);
        if (media?.type !== 'video') throw Error('Freeze requires a video source.');
        if (c.linkId) throw Error('Unlink this picture/audio pair before freezing a picture interval.');
        if (c.pin) throw Error('Unpin the picture before creating a static frame hold.');
        const time = a.time_sec, duration = a.duration_sec ?? 2, end = time + duration;
        if (!finite(time) || !finite(duration) || duration < MIN_CLIP || time < start || end > start + length + 1e-6) throw Error('Give time_sec and duration_sec inside this clip; freeze holds the existing picture interval and keeps audio/timeline timing.');
        const left = time - start, right = start + length - end;
        if (left > 1e-6 && left < MIN_CLIP || right > 1e-6 && right < MIN_CLIP) throw Error('The frame hold must leave at least 0.1 seconds on each remaining side.');
        const layout = videoLayout(p.videoClips), index = layout.findIndex(row => row.clip.id === c.id);
        const incoming = found.track === 'video' && index > 0 ? Math.max(0, layout[index - 1].end - start) : 0;
        const outgoing = found.track === 'video' && index < layout.length - 1 ? Math.max(0, start + length - layout[index + 1].start) : 0;
        if (left < incoming - 1e-6 || right < outgoing - 1e-6) throw Error('Choose a frame-hold interval outside transition overlaps.');
        const audioLayer = () => {
          for (let layer = 0; layer < 128; layer++) if (!isLayerLocked(p, 'audio', layer) && layerFree(p, 'audio', layer, time, duration)) return layer;
          throw Error('No unlocked audio layer is available to preserve this interval’s sound.');
        };
        const preserveAudio = media.hasAudio && !c.muted && (c.volume ?? 1) > 0;
        const layer = preserveAudio ? audioLayer() : null;
        if (!api.agentMediaJob) throw Error('Restart ClipCraft to load agent media jobs.');
        const sourceAt = c.in + left * (c.speed || 1);
        const frame = await api.agentMediaJob({ requestId: env.requestId, action: 'frame', item: media, at: sourceAt });
        if (frame?.error || !frame?.path) throw Error(frame?.error || 'Could not extract the frame.');
        const still = env.addProbed({ ...frame, origin: 'freeze' });
        if (!still) throw Error('Could not import the frozen frame.');
        await settle();
        const actions = [];
        if (found.track === 'video') for (let n = 1; n < layout.length; n++) {
          const row = layout[n], overlap = Math.max(0, layout[n - 1].end - row.start);
          if (overlap && row.clip.transition) actions.push({ type: 'update', track: 'video', id: row.clip.id, patch: { transition: { ...row.clip.transition, timelineOverlap: overlap } } });
        }
        let target = c.id;
        if (left > 1e-6) { target = uid();actions.push({ type: 'split', track: found.track, id: c.id, t: time, newId: target }); }
        if (right > 1e-6) actions.push({ type: 'split', track: found.track, id: target, t: end, newId: uid() });
        const motion = stateAt(c, left, length);
        actions.push({ type: 'update', track: found.track, id: target, patch: {
          mediaId: still.id, in: 0, out: duration, speed: 1, transform: motion.transform, opacity: motion.opacity,
          anim: undefined, keyframes: undefined, track: undefined, pin: undefined, enhance: undefined, reversed: undefined,
          muted: true, fadeIn: 0, fadeOut: 0, fadeInOffset: 0, fadeOutOffset: 0,
        } });
        let audioId;
        if (preserveAudio) {
          audioId = uid();
          actions.push({ type: 'insertAudioClip', clip: {
            id: audioId, mediaId: c.mediaId, start: time, in: sourceAt, out: sourceAt + duration * (c.speed || 1),
            speed: c.speed || 1, layer, volume: c.volume ?? 1, volumeKeys: c.volumeKeys, audioFx: c.audioFx, enhance: c.enhance,
            ...sliceFades(c, left, left + duration, length),
          } });
        }
        dispatch({ type: 'batch', actions });
        await settle();
        const hold = findClip(target);
        if (!hold || hold.clip.mediaId !== still.id || Math.abs(clipLen(hold.clip) - duration) > 1e-6) throw Error('The requested frame hold was not installed.');
        return after({ clip_id: target, media_id: still.id, start_sec: time, end_sec: end,
          preserved_audio_clip_id: audioId, note: 'Picture held in the existing interval; source audio and downstream timing preserved.' });
      }
      if (a.action === 'reverse') {
        if (!['video', 'overlay', 'audio'].includes(found.track)) throw Error('Only video and audio can be reversed.');
        if (c.linkId) throw Error('Unlink the picture/audio pair before reversing its sources, then relink if needed.');
        const media = p.media.find(m => m.id === c.mediaId);
        if (!media || media.type === 'image') throw Error('Reverse requires a video or audio source.');
        if (c.reversed) {
          const saved = c.reversed;
          dispatch({ type: 'update', track: found.track, id: c.id, patch: {
            mediaId: saved.mediaId, in: saved.in, out: saved.out, reversed: null,
            ...(saved.original ? saved.original : {}),
          } });
          return after({ clip_id: c.id, reversed: false });
        }
        if (!api.agentMediaJob) throw Error('Restart ClipCraft to load agent media jobs.');
        const result = await api.agentMediaJob({ requestId: env.requestId, action: 'reverse', item: media, from: c.in, to: c.out });
        if (result?.error || !result?.path) throw Error(result?.error || 'The reverse render did not produce media.');
        const sourceLength = c.out - c.in;
        if (!(result.duration > 0) || result.duration + .05 < sourceLength) throw Error('The reversed source is shorter than the requested window.');
        const nextMedia = env.addProbed({ ...result, origin: 'reverse' });
        if (!nextMedia) throw Error('The reversed media could not be imported.');
        await settle();
        const keyframes = c.keyframes && Object.fromEntries(Object.entries(c.keyframes).map(([key, keys]) => [key, keys.map(k => ({ ...k, t: k.t - c.in }))]));
        const track = c.track?.points ? { ...c.track, points: c.track.points.map(point => ({ ...point, t: c.out - point.t })).sort((a, b) => a.t - b.t) } : c.track;
        let volumeKeys = c.volumeKeys;
        if (volumeKeys?.length) {
          const keys = volumeKeys.filter(k => k.t >= c.in && k.t <= c.out);
          if (volumeKeys[0].t < c.in && !keys.some(k => k.t === c.in)) keys.unshift({ t: c.in, v: volumeAt(volumeKeys, c.in) });
          if (volumeKeys.at(-1).t > c.out && !keys.some(k => k.t === c.out)) keys.push({ t: c.out, v: volumeAt(volumeKeys, c.out) });
          volumeKeys = keys.map(k => ({ t: c.out - k.t, v: k.v })).reverse();
        }
        dispatch({ type: 'update', track: found.track, id: c.id, patch: {
          mediaId: nextMedia.id, in: 0, out: Math.min(sourceLength, result.duration), keyframes, track, enhance: undefined,
          volumeKeys,
          reversed: { mediaId: c.mediaId, in: c.in, out: c.out, original: { keyframes: c.keyframes, track: c.track, enhance: c.enhance, volumeKeys: c.volumeKeys } },
        } });
        return after({ clip_id: c.id, reversed: true, media_id: nextMedia.id });
      }
      throw Error('Unknown extended clip operation.');
    },
  };
}
