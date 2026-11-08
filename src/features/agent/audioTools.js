import { clipLen, isLayerLocked, clipLayer, videoLayout, exportDuration } from '../../state/store.js';
import { AUDIO_PRESETS, normalizeAudioFx } from '../effects/audioPresets.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' };
export const AUDIO_DECLARATIONS = [
  { name: 'set_audio_effects', description: 'Audio finishing on main/overlay/audio clips: clip_id, or clip_ids (up to 200) to apply the same settings to every piece of a cut talking head in one call. preset clear-voice, podcast, warm, bright or none replaces effects; explicit fields then override it. Without preset, merge given fields. EQ dB ±15, highpass 0–1000 Hz, lowpass 0–20000 Hz, pitch ±12 semitones. Effects are heard in renders, not live HTML playback; render a section to review.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, clip_ids: { type: 'ARRAY', items: S, maxItems: 200 }, preset: S,
      eq: { type: 'OBJECT', properties: { low: N, mid: N, high: N } }, highpass: N, lowpass: N,
      comp: B, limit: B, denoise: B, loudnorm: B, pitch: N,
      echo: { type: 'OBJECT', properties: { enabled: B, delay: N, decay: N } },
    }, required: [] } },
  { name: 'set_volume_envelope', description: 'Replace a clip’s volume automation with linear points at absolute timeline time_sec, value 0–2 (multiplies base volume). Points must be strictly ordered inside the clip, max 512. [] clears automation. Source-time storage preserves the curve across split/trim/speed. Applies to preview, export and audio analysis.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, points: { type: 'ARRAY', maxItems: 512, items: { type: 'OBJECT', properties: { time_sec: N, value: N }, required: ['time_sec', 'value'] } } }, required: ['clip_id', 'points'] } },
  { name: 'duck_audio', description: 'Lower target music beneath explicitly selected speech clips using actual local silence analysis; no transcription/download. target_clip_ids and speech_clip_ids must be disjoint. Replaces targets’ volume automation, keeps base volume/fades. duck_volume 0–1 default .2, attack_sec .15, release_sec .4, threshold_db -35. Activity detection includes any sound in the speech selection; isolate dialogue, not the whole mix.',
    parameters: { type: 'OBJECT', properties: { target_clip_ids: { type: 'ARRAY', items: S }, speech_clip_ids: { type: 'ARRAY', items: S }, duck_volume: N, attack_sec: N, release_sec: N, threshold_db: N }, required: ['target_clip_ids', 'speech_clip_ids'] } },
];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const range = (value, min, max, name) => { if (!finite(value) || value < min || value > max) throw Error(`${name} must be from ${min} to ${max}.`);return value; };
export function createAudioTools({ project, dispatch, after, findClip, api, requestId }) {
  const sound = id => {
    const f = findClip(id), p = project(), m = f && p.media.find(m => m.id === f.clip.mediaId);
    if (!f || !['video', 'overlay', 'audio'].includes(f.track) || f.clip.gap || !m || m.type === 'image' || !(m.hasAudio || m.type === 'audio')) throw Error(`Clip ${id} has no source audio.`);
    return { ...f, start: f.track === 'video' ? videoLayout(p.videoClips).find(row => row.clip.id === id).start : f.clip.start };
  };
  const editable = id => { const f = sound(id);if (isLayerLocked(project(), f.track, clipLayer(f.track, f.clip))) throw Error(`Audio clip ${id} is on a locked layer.`);return f; };
  const write = (f, patch) => dispatch({ type: 'update', track: f.track, id: f.clip.id, patch });
  // Validated effect settings for one clip (preset first, then explicit fields).
  const effectsFor = (f, a) => {
    const preset = a.preset === undefined || a.preset === 'none' ? null : AUDIO_PRESETS.find(p => p.id === a.preset);
    if (a.preset !== undefined && a.preset !== 'none' && !preset) throw Error('Unknown audio preset: use clear-voice, podcast, warm, bright or none.');
    if (Object.keys(a).every(key => key === 'clip_id' || key === 'clip_ids' || key === 'retry_of')) throw Error('Give an audio preset or effect settings.');
    const fx = normalizeAudioFx(a.preset === 'none' ? null : preset?.fx || f.clip.audioFx);
    for (const key of ['comp', 'limit', 'denoise', 'loudnorm']) if (a[key] !== undefined) {
      if (typeof a[key] !== 'boolean') throw Error(`${key} must be true or false.`);fx[key] = a[key];
    }
    for (const [key, min, max] of [['highpass', 0, 1000], ['lowpass', 0, 20000], ['pitch', -12, 12]]) if (a[key] !== undefined) fx[key] = range(a[key], min, max, key);
    if (a.eq !== undefined) {
      if (!a.eq || typeof a.eq !== 'object' || Array.isArray(a.eq) || Object.keys(a.eq).some(key => !['low', 'mid', 'high'].includes(key))) throw Error('eq accepts low, mid and high dB.');
      for (const key of Object.keys(a.eq)) fx.eq[key] = range(a.eq[key], -15, 15, `eq.${key}`);
    }
    if (a.echo !== undefined) {
      if (!a.echo || typeof a.echo.enabled !== 'boolean') throw Error('echo requires enabled true or false.');
      fx.echo = a.echo.enabled ? { delay: range(a.echo.delay ?? 180, 20, 900, 'echo.delay'), decay: range(a.echo.decay ?? .3, .05, .8, 'echo.decay') } : null;
    }
    return fx;
  };
  return {
    async set_audio_effects(a) {
      if (a.clip_ids !== undefined) {
        const { clip_ids, clip_id, ...settings } = a;
        if (clip_id !== undefined || !Array.isArray(clip_ids) || !clip_ids.length || clip_ids.length > 200 || new Set(clip_ids).size !== clip_ids.length) throw Error('Give clip_id, or 1–200 distinct clip_ids.');
        // Validate every clip and setting first; then one reducer update for all of them.
        const updates = [];
        for (const id of clip_ids) {
          const f = editable(id);
          updates.push({ track: f.track, id, patch: { audioFx: effectsFor(f, settings) } });
        }
        dispatch({ type: 'updateMany', updates });
        return after({ clip_ids, clips: updates.length, audio_effects: updates[0].patch.audioFx, live_preview: false, note: 'Effects apply to rendered audio and analysis. Use a rendered section to hear the result.' });
      }
      const f = editable(a.clip_id), fx = effectsFor(f, a);
      write(f, { audioFx: fx });
      return after({ clip_id: a.clip_id, audio_effects: fx, live_preview: false, note: 'Effects apply to rendered audio and analysis. Use a rendered section to hear the result.' });
    },
    async set_volume_envelope({ clip_id, points }) {
      const f = editable(clip_id), end = f.start + clipLen(f.clip);
      if (!Array.isArray(points) || points.length > 512) throw Error('Give up to 512 volume points, or [] to clear.');
      const volumeKeys = points.map((point, i) => {
        if (!point || !finite(point.time_sec) || point.time_sec < f.start || point.time_sec > end || i && point.time_sec <= points[i - 1].time_sec) throw Error('Volume points must be strictly ordered inside the clip’s timeline range.');
        return { t: f.clip.in + (point.time_sec - f.start) * (f.clip.speed || 1), v: range(point.value, 0, 2, 'value') };
      });
      write(f, { volumeKeys: volumeKeys.length ? volumeKeys : undefined });
      return after({ clip_id, points: volumeKeys.length, time_basis: 'source_seconds' });
    },
    async duck_audio({ target_clip_ids, speech_clip_ids, duck_volume = .2, attack_sec = .15, release_sec = .4, threshold_db = -35 }) {
      const ids = list => Array.isArray(list) && list.length > 0 && list.length <= 64 && new Set(list).size === list.length;
      if (!ids(target_clip_ids) || !ids(speech_clip_ids) || target_clip_ids.some(id => speech_clip_ids.includes(id))) throw Error('Select 1–64 distinct target and speech clip IDs with no overlap.');
      range(duck_volume, 0, 1, 'duck_volume');range(attack_sec, .01, 5, 'attack_sec');range(release_sec, .01, 5, 'release_sec');range(threshold_db, -80, -5, 'threshold_db');
      const targets = target_clip_ids.map(editable);speech_clip_ids.forEach(sound);
      if (!api.agentSilences) throw Error('Local audio activity analysis is unavailable.');
      const p = project(), total = exportDuration(p);
      const result = await api.agentSilences(p, { requestId, source: 'all', clip_ids: speech_clip_ids, minDur: .12, noiseDb: threshold_db });
      if (result?.error || !Array.isArray(result?.silences)) throw Error(result?.error || 'Audio activity analysis failed.');
      let at = 0;const active = [];
      for (const silence of [...result.silences].sort((a, b) => a.start - b.start)) {
        if (!finite(silence.start) || !finite(silence.end) || silence.end < silence.start) throw Error('Invalid audio activity analysis.');
        const start = Math.min(total, Math.max(0, silence.start)), end = Math.min(total, Math.max(0, silence.end));
        if (start > at) active.push({ start: at, end: start });at = Math.max(at, end);
      }
      if (at < total) active.push({ start: at, end: total });
      // Merge close utterances so their attack/release ramps do not compete.
      const spans = [];
      for (const span of active) {
        const last = spans.at(-1);
        if (last && span.start - last.end <= attack_sec + release_sec) last.end = span.end;else spans.push({ ...span });
      }
      const updates = targets.map(f => {
        const start = f.start, end = start + clipLen(f.clip), near = spans.filter(s => s.start - attack_sec < end && s.end + release_sec > start);
        const times = [...new Set([start, end, ...near.flatMap(s => [s.start - attack_sec, s.start, s.end, s.end + release_sec]).filter(t => t > start && t < end)])].sort((a, b) => a - b);
        if (times.length > 512) throw Error('Too many speech intervals; duck a smaller section.');
        const gain = t => near.reduce((v, s) => Math.min(v, t < s.start ? 1 - (1 - duck_volume) * Math.max(0, 1 - (s.start - t) / attack_sec) : t <= s.end ? duck_volume : 1 - (1 - duck_volume) * Math.max(0, 1 - (t - s.end) / release_sec)), 1);
        return { track: f.track, id: f.clip.id, patch: { volumeKeys: times.map(t => ({ t: f.clip.in + (t - start) * (f.clip.speed || 1), v: gain(t) })) } };
      });
      dispatch({ type: 'updateMany', updates });
      return after({ clip_ids: target_clip_ids, speech_intervals: spans.length, duck_volume, detection: 'audio_activity', note: 'Detected activity in the selected speech sources; no semantic speech classification.' });
    },
  };
}
