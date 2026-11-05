// CraftAI tools: what the AI model can ask the editor to do.
// Every editing tool goes through the same reducer actions as the buttons, so Undo, the timeline and the
// export all behave exactly as for a manual edit. Tools return small JSON results (or { error }) so the
// model can read them and correct itself.
import { clipLen, projectDuration, videoLayout, uid } from '../store.js';
import { FILTERS, EFFECTS, TRANSITIONS, RATIOS, DEFAULT_ADJUST, sizeFor } from '../effects.js';
import { ANIM_IN, ANIM_LOOP, ANIM_OUT, BUBBLES, HIGHLIGHTS, TEXT_EFFECTS, TEXT_TEMPLATES } from '../text/catalog.js';
import { ANIMATIONS, EASINGS, KEY_PROPS, baseAt, hasKeys } from '../anim.js';
import { BLEND_MODES, cropOf, transformOf, opacityOf } from '../visual.js';
import { EDIT_STYLES, MOTION_GUIDE, MOTION_TOPICS, STYLE_NAMES, findStyle } from './motionGuide.js';
import { projectRevision } from './context.js';

const r2 = (n) => Math.round(n * 100) / 100;
const HEX = /^#[0-9a-f]{6}$/i;
const ids = (list) => list.map((x) => x.id).join(', ');
const CAPTION_STYLES = TEXT_TEMPLATES.filter((t) => t.caption);

const S = { type: 'STRING' };
const N = { type: 'NUMBER' };
const B = { type: 'BOOLEAN' };

// Look of a text (edit_text). Ids come from list_options, so the declarations stay short: every step sends them,
// and some free plans (Groq: 8K tokens a minute) count every token.
const TEXT_LOOK = {
  template_id: S, x: N, y: N, size: N, color: S, font: S, bold: B, italic: B, uppercase: B, align: S, rotation: N, opacity: N,
  stroke_width: N, stroke_color: S, background_color: S, effect: S, anim_in: S, anim_out: S, anim_loop: S, highlight: S, highlight_color: S,
  bubble: S, bubble_color: S,
};

export const TOOL_DECLARATIONS = [
  {
    name: 'get_project',
    description: 'Read live project ids/times. Reuse a previous read when its revision matches. scope: all (default), overview, main, overlay, audio, text, captions, effects, media. clip_ids selects exact clips; offset/limit page lists (default 30, max 100). if_revision skips unchanged data. Read affected tracks after cuts or manual edits.',
    parameters: { type: 'OBJECT', properties: { scope: S, clip_ids: { type: 'ARRAY', items: S }, offset: { type: 'INTEGER' }, limit: { type: 'INTEGER' }, if_revision: S } },
  },
  {
    name: 'list_options',
    description: 'Ids you can use: what = text_templates, caption_styles, fonts, text_animations, text_effects, highlights, bubbles, filters, effects, transitions, clip_animations, blend_modes.',
    parameters: { type: 'OBJECT', properties: { what: S }, required: ['what'] },
  },
  {
    name: 'remove_silences',
    description: 'Cut silent stretches out of the main track (only the main track moves).',
    parameters: { type: 'OBJECT', properties: { min_silence_sec: { ...N, description: 'default 0.6' }, threshold_db: { ...N, description: 'default -35; -30 noisy, -45 quiet' }, keep_padding_sec: { ...N, description: 'default 0.12' } } },
  },
  {
    name: 'cut_range',
    description: 'Remove a timeline range from the main track and close the gap. Several cuts: start from the end, or use keep_ranges.',
    parameters: { type: 'OBJECT', properties: { start_sec: N, end_sec: N }, required: ['start_sec', 'end_sec'] },
  },
  {
    name: 'keep_ranges',
    description: 'Keep only these timeline ranges of the main track, joined in order (highlights, shortening).',
    parameters: { type: 'OBJECT', properties: { ranges: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start_sec: N, end_sec: N }, required: ['start_sec', 'end_sec'] } } }, required: ['ranges'] },
  },
  {
    name: 'transcribe',
    description: 'Speech of the project with timeline timestamps. Slow on long videos: once per request.',
    parameters: { type: 'OBJECT', properties: { language: { ...S, description: 'en, ar, fr, es... (auto is unreliable)' } } },
  },
  {
    name: 'add_captions',
    description: 'Automatic captions from the speech (replaces earlier ones). Restyle them with edit_text clip_id "captions".',
    parameters: { type: 'OBJECT', properties: { language: S, style_id: { ...S, description: 'caption style id, default cap-classic' } } },
  },
  {
    name: 'add_text',
    description: 'Add a text (title, hook, label). Returns its clip_id; edit_text changes its look further.',
    parameters: { type: 'OBJECT', properties: { text: S, start_sec: N, duration_sec: { ...N, description: 'default 3' }, template_id: S, y: { ...N, description: '0 top, 1 bottom' }, size: N, color: S, font: S }, required: ['text'] },
  },
  {
    name: 'edit_text',
    description: 'Change a text (or all automatic captions with clip_id "captions"): words, timing, look. Only given fields change. x / y 0-1, size in px, colors #rrggbb, align left / center / right, background_color "none" removes the box, other ids from list_options.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, text: S, start_sec: N, duration_sec: N, ...TEXT_LOOK }, required: ['clip_id'] },
  },
  {
    name: 'delete_clip',
    description: 'Delete a clip of any track.',
    parameters: { type: 'OBJECT', properties: { clip_id: S }, required: ['clip_id'] },
  },
  {
    name: 'split_at',
    description: 'Split the main-track clip playing at this time.',
    parameters: { type: 'OBJECT', properties: { time_sec: N }, required: ['time_sec'] },
  },
  {
    name: 'set_speed',
    description: 'Speed of a main-track clip, 0.25 to 4.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, speed: N }, required: ['clip_id', 'speed'] },
  },
  {
    name: 'set_volume',
    description: 'Volume (0 mute, 1 normal, 2 double) of a main or audio clip; fades for audio clips.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, volume: N, fade_in_sec: N, fade_out_sec: N }, required: ['clip_id'] },
  },
  {
    name: 'set_filter',
    description: 'Color filter of a main-track clip ("none" removes; ids: list_options filters).',
    parameters: { type: 'OBJECT', properties: { clip_id: S, filter_id: S }, required: ['clip_id', 'filter_id'] },
  },
  {
    name: 'set_effects',
    description: 'Effects of a main-track clip, replacing its list (ids: list_options effects; [] removes).',
    parameters: { type: 'OBJECT', properties: { clip_id: S, effect_ids: { type: 'ARRAY', items: S } }, required: ['clip_id', 'effect_ids'] },
  },
  {
    name: 'add_transition',
    description: 'Transition into a main-track clip from the one before (not the first). Ids: list_options transitions.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, type: S, duration_sec: { ...N, description: 'default 0.5' } }, required: ['clip_id', 'type'] },
  },
  {
    name: 'set_aspect_ratio',
    description: `Project format: ${Object.keys(RATIOS).join(', ')}.`,
    parameters: { type: 'OBJECT', properties: { ratio: S }, required: ['ratio'] },
  },
  {
    name: 'zoom',
    description: 'Punch-in zoom on the main track over a time range, then back out.',
    parameters: {
      type: 'OBJECT',
      properties: { start_sec: N, end_sec: N, scale: { ...N, description: '1.05-3, default 1.3' }, style: { ...S, description: 'cut (default) or smooth' }, ramp_sec: N, focus_x: { ...N, description: '0-1, default 0.5' }, focus_y: { ...N, description: '0-1, default 0.45' } },
      required: ['start_sec', 'end_sec'],
    },
  },
  {
    name: 'set_transform',
    description: 'Size / position / rotation / opacity of a main or overlay clip, for its whole length. scale 1 = fitted; x / y in frame fractions from the center; rotation degrees; opacity 0-1.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, scale: N, x: N, y: N, rotation: N, opacity: N }, required: ['clip_id'] },
  },
  {
    name: 'add_keyframes',
    description: `Keyframes of scale, x, y, rotation or opacity on a main or overlay clip (zooms, pans, fades, pops). time_sec on the timeline, inside the clip. easing (how the value moves into a keyframe): ${Object.keys(EASINGS).join(', ')}; spring = natural motion, back = small overshoot.`,
    parameters: { type: 'OBJECT', properties: { clip_id: S, property: S, easing: S, keyframes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { time_sec: N, value: N, easing: S }, required: ['time_sec', 'value'] } } }, required: ['clip_id', 'property', 'keyframes'] },
  },
  {
    name: 'set_animation',
    description: 'In / Out / Combo (all along) animation of a main or overlay clip; "none" removes. Ids: list_options clip_animations.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, in: S, in_duration_sec: N, out: S, out_duration_sec: N, combo: S }, required: ['clip_id'] },
  },
  {
    name: 'add_media',
    description: 'Put a library file on the timeline by name: video / photo on the main track (end, or main_index) or as "overlay" at start_sec; audio on the audio track at start_sec.',
    parameters: { type: 'OBJECT', properties: { media_name: S, as: S, start_sec: N, main_index: N }, required: ['media_name'] },
  },
  {
    name: 'search_sounds',
    description: 'Search sounds. kind: music, sfx (whoosh, pop, impact...) or meme (bruh, vine boom...). English words. Returns sound_id for add_sound.',
    parameters: { type: 'OBJECT', properties: { kind: S, query: S }, required: ['kind', 'query'] },
  },
  {
    name: 'add_sound',
    description: 'Add a found sound to the audio track. Music under speech: volume about 0.2 with fades.',
    parameters: { type: 'OBJECT', properties: { sound_id: S, start_sec: N, duration_sec: N, volume: N, fade_in_sec: N, fade_out_sec: N }, required: ['sound_id'] },
  },
  {
    name: 'list_voices',
    description: 'Voices for add_voiceover: free "piper" voices (one Arabic) and "elevenlabs" ones when the user has that key.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_voiceover',
    description: 'Text to speech onto the audio track.',
    parameters: { type: 'OBJECT', properties: { text: S, voice_id: S, engine: { ...S, description: 'piper (default) or elevenlabs' }, start_sec: N, speed: N, volume: N }, required: ['text', 'voice_id'] },
  },
  {
    name: 'search_stock',
    description: 'Search free stock (Pixabay) for b-roll. kind video or photo, English words. Returns stock_id for add_stock.',
    parameters: { type: 'OBJECT', properties: { kind: S, query: S }, required: ['kind', 'query'] },
  },
  {
    name: 'add_stock',
    description: 'Add a found stock file: as "overlay" (default, full frame over the video at start_sec, for duration_sec) or "main" (main track at main_index, default the end).',
    parameters: { type: 'OBJECT', properties: { stock_id: S, as: S, start_sec: N, duration_sec: N, main_index: N }, required: ['stock_id'] },
  },
  {
    name: 'add_effect',
    description: 'Effect over everything for a time range (ids: list_options effects).',
    parameters: { type: 'OBJECT', properties: { effect_id: S, start_sec: N, duration_sec: { ...N, description: 'default 3' } }, required: ['effect_id', 'start_sec'] },
  },
  {
    name: 'move_clip',
    description: 'Main-track clip: new order to_index (0 first). Other tracks: new start_sec.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, to_index: N, start_sec: N }, required: ['clip_id'] },
  },
  {
    name: 'trim_clip',
    description: 'New timeline start and / or end of a clip (media cannot go past its source).',
    parameters: { type: 'OBJECT', properties: { clip_id: S, start_sec: N, end_sec: N }, required: ['clip_id'] },
  },
  {
    name: 'clip_tools',
    description: 'action: duplicate, extract_audio (sound to the audio track, clip muted), to_overlay (main clip above the main track at start_sec), to_main (overlay back at main_index), mute, unmute.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, action: S, start_sec: N, main_index: N }, required: ['clip_id', 'action'] },
  },
  {
    name: 'set_color',
    description: 'Color of a main / overlay clip, or clip_id "all". brightness -1..1 (0), contrast 0..2 (1), saturation 0..3 (1), hue -180..180, blur 0..20.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, brightness: N, contrast: N, saturation: N, hue: N, blur: N }, required: ['clip_id'] },
  },
  {
    name: 'set_compositing',
    description: 'Green screen (chroma_key true / false, key_color #rrggbb default #00ff00, key_strength 0-100), blend mode (list_options blend_modes) and crop (crop_left / crop_top / crop_right / crop_bottom, percent of the source cut away per edge, 0-90) of a clip.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, chroma_key: B, key_color: S, key_strength: N, blend: S, crop_left: N, crop_top: N, crop_right: N, crop_bottom: N }, required: ['clip_id'] },
  },
  {
    name: 'set_project',
    description: 'background #rrggbb, resolution 480 / 720 / 1080 / 1440 / 2160, fps 24 / 25 / 30 / 50 / 60, name.',
    parameters: { type: 'OBJECT', properties: { background: S, resolution: N, fps: N, name: S } },
  },
  {
    name: 'motion_guide',
    description: `Motion design recipes (timing, easing, layouts, sound) as tool calls. Read the topic before building it. topic: ${MOTION_TOPICS.join(', ')}.`,
    parameters: { type: 'OBJECT', properties: { topic: S }, required: ['topic'] },
  },
  {
    name: 'edit_style',
    description: `A whole edit in a named style. When the user names a style ("edit it Moon Drift", "App Story style", "Tube TV"), call this with the name and apply the recipe to the whole video. Styles: ${STYLE_NAMES.join(', ')}.`,
    parameters: { type: 'OBJECT', properties: { name: S }, required: ['name'] },
  },
  {
    name: 'add_scene',
    description: 'Background without footage (intro, title card, end card): one color, or a gradient to color2 (direction horizontal / vertical / diagonal), on the main track at main_index (default the end) for duration_sec. Put texts and overlays on it.',
    parameters: { type: 'OBJECT', properties: { color: S, color2: S, direction: S, duration_sec: N, main_index: N }, required: ['color'] },
  },
  {
    name: 'undo',
    description: "Undo your own last change (never the user's earlier edits).",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'export_video',
    description: 'Open the export (the user picks where to save). Only when asked.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

// Size, place, animations and keyframed properties of a picture clip, only when they differ from the defaults.
function motionInfo(c) {
  const t = transformOf(c);
  const out = {};
  if (t.scale !== 1) out.scale = r2(t.scale);
  if (t.x || t.y) out.position = [r2(t.x), r2(t.y)];
  if (t.rot) out.rotation = r2(t.rot);
  if (opacityOf(c) < 1) out.opacity = r2(opacityOf(c));
  const keyed = KEY_PROPS.filter((k) => hasKeys(c, k));
  if (keyed.length) out.keyframed = keyed.map((k) => (k === 'rot' ? 'rotation' : k));
  if (c.anim && (c.anim.in || c.anim.out || c.anim.combo)) {
    out.animation = Object.fromEntries(['in', 'out', 'combo'].filter((k) => c.anim[k]).map((k) => [k, c.anim[k].type]));
  }
  return out;
}

// Look of a text clip, only what differs from the defaults.
function textInfo(c) {
  const out = {};
  for (const k of ['template', 'font', 'size', 'color', 'x', 'y', 'rotation', 'opacity', 'effect']) if (c[k] !== undefined) out[k] = typeof c[k] === 'number' ? r2(c[k]) : c[k];
  for (const [k, name] of [['animIn', 'anim_in'], ['animOut', 'anim_out'], ['animLoop', 'anim_loop']]) if (c[k]?.id && c[k].id !== 'none') out[name] = c[k].id;
  if (c.highlight?.mode && c.highlight.mode !== 'none') out.highlight = c.highlight.mode;
  return out;
}

function captionInfo(caps) {
  if (!caps.length) return { count: 0 };
  return {
    count: caps.length, start: r2(caps[0].start), end: r2(Math.max(...caps.map((c) => c.start + c.duration))),
    first_lines: caps.slice(0, 3).map((c) => ({ id: c.id, text: c.text.slice(0, 60), start: r2(c.start) })), look: textInfo(caps[0]),
  };
}

// Compact description of the project for the model.
export function summarizeProject(p) {
  const mediaById = Object.fromEntries(p.media.map((m) => [m.id, m]));
  const layout = videoLayout(p.videoClips);
  const label = (c) => (mediaById[c.mediaId] ? mediaById[c.mediaId].name : 'missing media');
  return {
    name: p.name,
    format: `${p.ratio} ${p.width}x${p.height} @ ${p.fps}fps`,
    background: p.background || '#000000',
    duration_sec: r2(projectDuration(p)),
    main_track: layout.map((l) => (l.clip.gap
      ? { id: l.clip.id, type: 'gap', start: r2(l.start), end: r2(l.end) }
      : {
        id: l.clip.id, media: label(l.clip), type: mediaById[l.clip.mediaId]?.type, start: r2(l.start), end: r2(l.end),
        source_in: r2(l.clip.in), source_out: r2(l.clip.out), speed: l.clip.speed || 1, volume: l.clip.volume ?? 1,
        muted: !!l.clip.muted, filter: l.clip.filter || 'none', effects: l.clip.effects || [],
        transition_in: l.clip.transition ? l.clip.transition.type : null,
        ...motionInfo(l.clip),
      })),
    overlay_track: (p.overlayClips || []).map((c) => ({ id: c.id, media: label(c), start: r2(c.start), end: r2(c.start + clipLen(c)), ...motionInfo(c) })),
    audio_track: p.audioClips.map((c) => ({
      id: c.id, media: label(c), start: r2(c.start), end: r2(c.start + (c.out - c.in) / (c.speed || 1)), volume: c.volume ?? 1,
      ...(c.fadeIn ? { fade_in: r2(c.fadeIn) } : {}), ...(c.fadeOut ? { fade_out: r2(c.fadeOut) } : {}),
    })),
    // Captions are many: listed by count and time span, their look once.
    text_track: p.textClips.filter((c) => !c.caption).map((c) => ({ id: c.id, text: c.text.slice(0, 80), start: r2(c.start), end: r2(c.start + c.duration), ...textInfo(c) })),
    captions: captionInfo(p.textClips.filter((c) => c.caption)),
    effects_track: (p.effectClips || []).map((c) => ({ id: c.id, effect: c.fx, start: r2(c.start), end: r2(c.start + c.duration) })),
    media_library: p.media.map((m) => ({ id: m.id, name: m.name, type: m.type, duration_sec: r2(m.duration || 0) })),
  };
}

// Gaps between the kept ranges, within [0, total]: what keep_ranges has to remove.
export function complementRanges(keep, total) {
  const sorted = keep.map((r) => ({ start: Math.max(0, r.start), end: Math.min(total, r.end) })).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const r of sorted) {
    if (r.start > at) out.push({ start: at, end: r.start });
    at = Math.max(at, r.end);
  }
  if (at < total) out.push({ start: at, end: total });
  return out;
}

// ctx: { getProject(), dispatch(action), api, settle() }. settle() waits for the UI state to catch up after dispatches.
export function createToolRunner(ctx) {
  const { dispatch, api } = ctx;
  const project = () => ctx.getProject();
  const after = async (extra = {}) => {
    await ctx.settle();
    return { ok: true, duration_sec: r2(projectDuration(project())), revision: projectRevision(project()), ...extra };
  };
  const findClip = (id) => {
    const p = project();
    for (const [track, key] of [['video', 'videoClips'], ['overlay', 'overlayClips'], ['audio', 'audioClips'], ['text', 'textClips'], ['effect', 'effectClips']]) {
      const clip = (p[key] || []).find((c) => c.id === id);
      if (clip) return { track, clip };
    }
    return null;
  };
  const needVideoClip = (id) => {
    const f = findClip(id);
    if (!f) return { error: `No clip with id "${id}". Call get_project to see the real ids.` };
    if (f.track !== 'video' || f.clip.gap) return { error: `Clip "${id}" is not a main-track media clip.` };
    return f;
  };
  const num = (v, name) => (Number.isFinite(Number(v)) ? Number(v) : { error: `${name} must be a number.` });
  // A main-track or overlay picture clip, with where it starts on the timeline and how long it lasts.
  const needPicture = (id) => {
    const f = findClip(id);
    if (!f) return { error: `No clip with id "${id}". Call get_project to see the real ids.` };
    if (!(f.track === 'video' || f.track === 'overlay') || f.clip.gap) return { error: `Clip "${id}" is not a main-track or overlay video / photo.` };
    const p = project();
    f.start = f.track === 'overlay' ? f.clip.start : videoLayout(p.videoClips).find((l) => l.clip.id === id).start;
    f.len = clipLen(f.clip);
    return f;
  };
  const PROP = { scale: 'scale', x: 'x', y: 'y', rotation: 'rot', rot: 'rot', opacity: 'opacity' };
  const srcTime = (clip, lt) => (clip.in || 0) + lt * (clip.speed || 1);
  // A keyframe list ({ t: source time, v }) with values set at the given local times (same times replaced).
  // pairs: [localTime, value, easing?] (easing of the move arriving at that keyframe; see EASINGS in anim.js).
  const putKeys = (list, clip, pairs) => {
    const ts = pairs.map(([lt]) => srcTime(clip, lt));
    const kept = (list || []).filter((k) => !ts.some((t) => Math.abs(k.t - t) < 1e-4));
    const key = ([lt, v, e]) => ({ t: srcTime(clip, lt), v, ...(e && e !== 'linear' ? { e } : {}) });
    return [...kept, ...pairs.map(key)].sort((a, b) => a.t - b.t);
  };

  const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  // Items from search_sounds / search_stock, by the short id the model sees (s1, v2, p3...).
  const found = new Map();
  const keep = (prefix, item) => {
    const id = `${prefix}${found.size + 1}`;
    found.set(id, item);
    return id;
  };

  // Puts a media item on the timeline: audio on the audio track at start_sec; a video / photo on the main track
  // (at main_index, default the end) or as an overlay at start_sec (fullFrame: covering the frame, for b-roll).
  // Returns { clip_id, track } or { error }.
  const place = async (m, { as = 'main', start_sec = 0, main_index, name, fullFrame } = {}) => {
    if (!m) return { error: 'Could not add the file to the project.' };
    const clipId = uid();
    const at = Math.max(0, Number(start_sec) || 0);
    let track;
    if (m.type === 'audio') {
      track = 'audio';
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at });
    } else if (as === 'overlay') {
      track = 'overlay';
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at });
      if (fullFrame) dispatch({ type: 'update', track, id: clipId, patch: { transform: { ...transformOf({}), scale: 1, x: 0, y: 0 } } });
    } else {
      track = 'video';
      const n = Number(main_index);
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, ...(Number.isInteger(n) && n >= 0 ? { index: n } : {}) });
    }
    await ctx.settle();
    if (!findClip(clipId)) return { error: `Could not put "${name || m.name}" on the timeline.` };
    return { clip_id: clipId, track, added: name || m.name };
  };

  // Volume, fades and length of a new audio clip.
  const shapeAudio = async (id, { duration_sec, volume = 1, fade_in_sec = 0, fade_out_sec = 0 }, extra) => {
    const c = findClip(id).clip;
    const patch = { volume: clamp(volume, 0, 2, 1), fadeIn: clamp(fade_in_sec, 0, 30, 0), fadeOut: clamp(fade_out_sec, 0, 30, 0) };
    if (Number(duration_sec) > 0) patch.out = Math.min(c.out, c.in + Number(duration_sec));
    dispatch({ type: 'update', track: 'audio', id, patch });
    await ctx.settle();
    const now = findClip(id).clip;
    return after({ ...extra, length_sec: r2(now.out - now.in) });
  };

  // edit_text with clip_id "captions": the look of every automatic caption (their words and timing stay).
  const restyleCaptions = (a) => {
    const caps = project().textClips.filter((c) => c.caption);
    if (!caps.length) return { error: 'There are no automatic captions; use add_captions first.' };
    if (a.text !== undefined || a.start_sec !== undefined || a.duration_sec !== undefined) return { error: 'For "captions" only the look can change, not the words or timing.' };
    const look = textLook(a, caps[0]);
    if (look.error) return look;
    dispatch({ type: 'styleCaptions', patch: look.patch });
    return after({ captions: caps.length });
  };

  // The text look from tool arguments as a clip patch; nested parts (outline, box, animations) are merged onto
  // `clip`. Returns { patch } or { error }.
  const textLook = (a, clip = {}) => {
    const patch = {};
    if (a.template_id !== undefined) {
      const tpl = TEXT_TEMPLATES.find((t) => t.id === a.template_id);
      if (!tpl) return { error: `Unknown template_id "${a.template_id}". Use one of: ${ids(TEXT_TEMPLATES)}.` };
      Object.assign(patch, tpl.patch, { template: tpl.id });
    }
    const cur = { ...clip, ...patch };
    const bad = (msg) => ({ error: msg });
    const numIn = (k, lo, hi) => {
      if (a[k] === undefined || a[k] === null) return null;
      const n = Number(a[k]);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : bad(`${k} must be between ${lo} and ${hi}.`);
    };
    for (const [k, key, lo, hi] of [['x', 'x', 0, 1], ['y', 'y', 0, 1], ['size', 'size', 8, 400], ['rotation', 'rotation', -360, 360], ['opacity', 'opacity', 0, 1]]) {
      const v = numIn(k, lo, hi);
      if (v?.error) return v;
      if (v !== null) patch[key] = v;
    }
    for (const k of ['color', 'stroke_color', 'background_color', 'highlight_color']) {
      if (a[k] !== undefined && !(k === 'background_color' && a[k] === 'none') && !HEX.test(String(a[k]))) return bad(`${k} must be #rrggbb.`);
    }
    if (a.color !== undefined) patch.color = a.color;
    if (a.font !== undefined) {
      const known = ctx.fontIds?.();
      if (known && !known.includes(a.font)) return bad(`Unknown font "${a.font}". Some fonts: ${known.slice(0, 40).join(', ')}.`);
      patch.font = a.font;
    }
    for (const k of ['bold', 'italic', 'uppercase']) if (a[k] !== undefined) patch[k] = !!a[k];
    if (a.align !== undefined) {
      if (!['left', 'center', 'right'].includes(a.align)) return bad('align must be left, center or right.');
      patch.align = a.align;
    }
    if (a.stroke_width !== undefined || a.stroke_color !== undefined) {
      const w = numIn('stroke_width', 0, 40);
      if (w?.error) return w;
      patch.stroke = { ...(cur.stroke || {}), ...(w !== null ? { width: w } : {}), ...(a.stroke_color !== undefined ? { color: a.stroke_color } : {}) };
    }
    if (a.background_color !== undefined) {
      patch.bg = a.background_color === 'none' ? { ...(cur.bg || {}), on: false } : { ...(cur.bg || {}), on: true, color: a.background_color };
    }
    if (a.effect !== undefined) {
      if (!TEXT_EFFECTS.some((x) => x.id === a.effect)) return bad(`effect must be one of: ${ids(TEXT_EFFECTS)}.`);
      patch.effect = a.effect;
    }
    for (const [k, key, list, dflt] of [['anim_in', 'animIn', ANIM_IN, { dur: 0.4 }], ['anim_out', 'animOut', ANIM_OUT, { dur: 0.3 }], ['anim_loop', 'animLoop', ANIM_LOOP, { speed: 1 }]]) {
      if (a[k] === undefined) continue;
      if (!list.some((x) => x.id === a[k])) return bad(`${k} must be one of: ${ids(list)}.`);
      patch[key] = { ...dflt, ...(cur[key] || {}), id: a[k] };
    }
    if (a.bubble !== undefined) {
      if (!BUBBLES.some((x) => x.id === a.bubble)) return bad(`bubble must be one of: ${ids(BUBBLES)}.`);
      patch.bubble = a.bubble;
    }
    if (a.bubble_color !== undefined) {
      if (!HEX.test(String(a.bubble_color))) return bad('bubble_color must be #rrggbb.');
      patch.bubbleColor = a.bubble_color;
    }
    if (a.highlight !== undefined || a.highlight_color !== undefined) {
      if (a.highlight !== undefined && !HIGHLIGHTS.some((x) => x.id === a.highlight)) return bad(`highlight must be one of: ${ids(HIGHLIGHTS)}.`);
      patch.highlight = { ...(cur.highlight || {}), ...(a.highlight !== undefined ? { mode: a.highlight } : {}), ...(a.highlight_color !== undefined ? { color: a.highlight_color } : {}) };
    }
    return { patch };
  };

  const tools = {
    async get_project({ scope = 'all', clip_ids, offset = 0, limit = 30, if_revision } = {}) {
      const p = project();
      const revision = projectRevision(p);
      if (if_revision === revision) return { revision, unchanged: true };
      const summary = summarizeProject(p);
      const fields = { main: 'main_track', overlay: 'overlay_track', audio: 'audio_track', text: 'text_track', effects: 'effects_track', media: 'media_library' };
      if (!['all', 'overview', 'captions', ...Object.keys(fields)].includes(scope)) return { error: `Unknown scope "${scope}".` };
      const out = { revision, name: summary.name, format: summary.format, background: summary.background, duration_sec: summary.duration_sec,
        counts: Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, summary[key].length])), captions: summary.captions };
      const start = Math.max(0, Math.floor(Number(offset)) || 0);
      const count = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 30));
      const selected = Array.isArray(clip_ids) ? new Set(clip_ids) : null;
      out.pages = {};
      for (const [name, key] of Object.entries(fields)) {
        if (scope !== 'all' && scope !== name && !selected) continue;
        const rows = selected ? summary[key].filter((row) => selected.has(row.id)) : summary[key];
        out[key] = rows.slice(start, start + count);
        out.pages[name] = { total: rows.length, offset: start, next_offset: start + count < rows.length ? start + count : null };
      }
      if (scope === 'captions' || selected) {
        const lines = p.textClips.filter((c) => c.caption && (!selected || selected.has(c.id)));
        out.caption_lines = lines.slice(start, start + count).map((c) => ({ id: c.id, text: c.text, start: r2(c.start), end: r2(c.start + c.duration), ...textInfo(c) }));
        out.pages.captions = { total: lines.length, offset: start, next_offset: start + count < lines.length ? start + count : null };
      }
      return out;
    },

    async remove_silences({ min_silence_sec = 0.6, threshold_db = -35, keep_padding_sec = 0.12 } = {}) {
      const p = project();
      if (!p.videoClips.length) return { error: 'The main track is empty.' };
      const res = await api.agentSilences(p, { minDur: Number(min_silence_sec), noiseDb: Number(threshold_db) });
      if (!res.ok) return { error: res.error };
      const total = projectDuration(p);
      const pad = Math.max(0, Number(keep_padding_sec));
      const ranges = res.silences
        .map((s) => ({ start: s.start + pad, end: Math.min(s.end, total) - pad }))
        .filter((s) => s.end - s.start > 0.05);
      if (!ranges.length) return { ok: true, removed_count: 0, removed_sec: 0, note: 'No silence long enough was found.' };
      const removed = ranges.reduce((n, r) => n + (r.end - r.start), 0);
      dispatch({ type: 'cutRanges', ranges });
      return after({ removed_count: ranges.length, removed_sec: r2(removed) });
    },

    async cut_range({ start_sec, end_sec }) {
      const a = num(start_sec, 'start_sec');
      const b = num(end_sec, 'end_sec');
      if (a.error || b.error) return a.error ? a : b;
      if (b <= a) return { error: 'end_sec must be greater than start_sec.' };
      dispatch({ type: 'cutRanges', ranges: [{ start: a, end: b }] });
      return after({ removed_sec: r2(b - a) });
    },

    async keep_ranges({ ranges }) {
      const total = projectDuration(project());
      const list = (ranges || []).map((r) => ({ start: Number(r.start_sec), end: Number(r.end_sec) })).filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end));
      if (!list.length) return { error: 'Give at least one range.' };
      const cuts = complementRanges(list, total);
      if (cuts.length) dispatch({ type: 'cutRanges', ranges: cuts });
      return after({ kept_ranges: list.length });
    },

    async transcribe({ language } = {}) {
      const p = project();
      const res = await api.runCaptions(p, { language: language || 'auto', maxLen: 80, source: 'all' });
      if (!res.ok) return { error: res.error.split('\n')[0] };
      const segments = res.segments.slice(0, 400).map((s) => ({ start: r2(s.start), end: r2(s.end), text: s.text }));
      return { segments, truncated: res.segments.length > 400 };
    },

    async add_captions({ language, style_id = 'cap-classic' } = {}) {
      const p = project();
      const tpl = CAPTION_STYLES.find((t) => t.id === style_id);
      if (!tpl) return { error: `Unknown style_id "${style_id}". Use one of: ${ids(CAPTION_STYLES)}.` };
      const res = await api.runCaptions(p, { language: language || 'auto', maxLen: 42, source: 'all' });
      if (!res.ok) return { error: res.error.split('\n')[0] };
      dispatch({ type: 'setCaptions', style: { ...tpl.patch, template: tpl.id }, segments: res.segments.map((s) => ({ ...s, id: uid() })) });
      return after({ captions: res.segments.length, style: tpl.id });
    },

    async add_text(a) {
      const { text, start_sec = 0, duration_sec = 3 } = a;
      if (!String(text || '').trim()) return { error: 'text is empty.' };
      const look = textLook(a);
      if (look.error) return look;
      const clipId = uid();
      dispatch({ type: 'addText', clipId, at: Math.max(0, Number(start_sec) || 0), patch: { ...look.patch, text: String(text), duration: Math.max(0.2, Number(duration_sec) || 3) } });
      return after({ clip_id: clipId });
    },

    async delete_clip({ clip_id }) {
      const f = findClip(clip_id);
      if (!f) return { error: `No clip with id "${clip_id}". Call get_project to see the real ids.` };
      dispatch({ type: 'delete', track: f.track, id: clip_id });
      return after();
    },

    async split_at({ time_sec }) {
      const t = num(time_sec, 'time_sec');
      if (t.error) return t;
      const hit = videoLayout(project().videoClips).find((l) => !l.clip.gap && t > l.start && t < l.end);
      if (!hit) return { error: `No main-track clip plays at ${t}s.` };
      if (t - hit.start < 0.1 || hit.end - t < 0.1) return { error: 'The split point is too close to the edge of the clip.' };
      dispatch({ type: 'split', track: 'video', id: hit.clip.id, t, newId: uid() });
      return after({ split_clip: hit.clip.id });
    },

    async set_speed({ clip_id, speed }) {
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      const sp = Number(speed);
      if (!(sp >= 0.25 && sp <= 4)) return { error: 'speed must be between 0.25 and 4.' };
      dispatch({ type: 'update', track: 'video', id: clip_id, patch: { speed: sp } });
      return after({ clip_length_sec: r2(clipLen({ ...f.clip, speed: sp })) });
    },

    async set_volume({ clip_id, volume, fade_in_sec, fade_out_sec }) {
      const f = findClip(clip_id);
      if (!f || (f.track !== 'video' && f.track !== 'audio') || f.clip.gap) return { error: `Clip "${clip_id}" is not a video or audio clip.` };
      const patch = {};
      if (volume !== undefined) {
        const v = Number(volume);
        if (!(v >= 0 && v <= 2)) return { error: 'volume must be between 0 and 2.' };
        Object.assign(patch, f.track === 'video' ? { volume: v, muted: v === 0 } : { volume: v });
      }
      if (fade_in_sec !== undefined || fade_out_sec !== undefined) {
        if (f.track !== 'audio') return { error: 'Fades are for audio-track clips.' };
        if (fade_in_sec !== undefined) patch.fadeIn = clamp(fade_in_sec, 0, 30, 0);
        if (fade_out_sec !== undefined) patch.fadeOut = clamp(fade_out_sec, 0, 30, 0);
      }
      if (!Object.keys(patch).length) return { error: 'Give volume and / or fades.' };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch });
      return after();
    },

    async set_filter({ clip_id, filter_id }) {
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      if (!FILTERS.some((x) => x.id === filter_id)) return { error: `Unknown filter_id "${filter_id}". Use one of: ${ids(FILTERS)}.` };
      dispatch({ type: 'update', track: 'video', id: clip_id, patch: { filter: filter_id } });
      return after();
    },

    async set_effects({ clip_id, effect_ids }) {
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      const bad = (effect_ids || []).find((e) => !EFFECTS.some((x) => x.id === e));
      if (bad) return { error: `Unknown effect "${bad}". Use: ${ids(EFFECTS)}.` };
      dispatch({ type: 'update', track: 'video', id: clip_id, patch: { effects: effect_ids || [] } });
      return after();
    },

    async add_transition({ clip_id, type, duration_sec = 0.5 }) {
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      if (project().videoClips[0].id === clip_id) return { error: 'The first clip has nothing before it. Pick a later clip.' };
      if (!TRANSITIONS.some((x) => x.id === type)) return { error: `Unknown transition "${type}". Use one of: ${ids(TRANSITIONS)}.` };
      dispatch({ type: 'update', track: 'video', id: clip_id, patch: { transition: { type, duration: Math.min(2, Math.max(0.2, Number(duration_sec) || 0.5)) } } });
      return after();
    },

    async set_aspect_ratio({ ratio }) {
      if (!RATIOS[ratio]) return { error: `Unknown ratio "${ratio}". Use one of: ${Object.keys(RATIOS).join(', ')}.` };
      const p = project();
      dispatch({ type: 'setProject', patch: { ratio, ratioLocked: true, ...sizeFor(ratio, p.resolution) } });
      return after({ size: `${sizeFor(ratio, p.resolution).width}x${sizeFor(ratio, p.resolution).height}` });
    },

    async zoom({ start_sec, end_sec, scale = 1.3, style = 'cut', ramp_sec = 0.4, focus_x = 0.5, focus_y = 0.45 }) {
      const a = num(start_sec, 'start_sec');
      const b = num(end_sec, 'end_sec');
      if (a.error || b.error) return a.error ? a : b;
      if (b - a < 0.1) return { error: 'The zoom range must last at least 0.1 s.' };
      const clampN = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
      const s = clampN(scale, 1.05, 3, 1.3);
      const fx = clampN(focus_x, 0, 1, 0.5);
      const fy = clampN(focus_y, 0, 1, 0.45);
      const smooth = style === 'smooth';
      const p = project();
      const eps = 1 / (p.fps || 30);
      const hits = videoLayout(p.videoClips).filter((l) => !l.clip.gap && l.end > a + 0.05 && l.start < b - 0.05);
      if (!hits.length) return { error: `No main-track clip plays between ${a}s and ${b}s.` };
      for (const l of hits) {
        const c = l.clip;
        const len = l.end - l.start;
        const la = Math.max(0, a - l.start);
        const lb = Math.min(len, b - l.start);
        // Local times and whether the picture is zoomed there: a one-frame jump for "cut", ramps for "smooth".
        const r = Math.min(clampN(ramp_sec, 0.05, 5, 0.4), (lb - la) / 2);
        const marks = smooth
          ? [[la, false], [la + r, true, 'spring'], [lb - r, true], [lb, false, 'inout']]
          : [...(la - eps >= 0 ? [[la - eps, false]] : []), [la, true], [lb, true], ...(lb + eps <= len ? [[lb + eps, false]] : [])];
        // Zoom about the focus point, so that point stays where it is on screen.
        const values = marks.map(([lt, zoomed, e]) => {
          const v = baseAt(c, lt);
          return [lt, zoomed ? { scale: v.scale * s, x: s * v.x + (fx - 0.5) * (1 - s), y: s * v.y + (fy - 0.5) * (1 - s) } : v, e];
        });
        const keyframes = { ...(c.keyframes || {}) };
        for (const prop of ['scale', 'x', 'y']) {
          const pairs = values.map(([lt, v, e]) => [lt, v[prop], e]);
          // x / y only need keyframes when they move.
          if (prop !== 'scale' && !hasKeys(c, prop) && pairs.every(([, v]) => Math.abs(v - pairs[0][1]) < 1e-6)) continue;
          keyframes[prop] = putKeys(keyframes[prop], c, pairs);
        }
        dispatch({ type: 'update', track: 'video', id: c.id, patch: { keyframes } });
      }
      return after({ zoomed_clips: hits.map((l) => l.clip.id), scale: s, style: smooth ? 'smooth' : 'cut' });
    },

    async set_transform({ clip_id, scale, x, y, rotation, opacity }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const t = { ...transformOf(f.clip) };
      const keyframes = { ...(f.clip.keyframes || {}) };
      const patch = {};
      const set = (name, v, lo, hi) => {
        if (v === undefined || v === null) return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < lo || n > hi) return `${name} must be between ${lo} and ${hi}.`;
        delete keyframes[PROP[name]];
        if (name === 'opacity') patch.opacity = n;
        else t[PROP[name]] = n;
        return null;
      };
      const err = set('scale', scale, 0.05, 10) || set('x', x, -2, 2) || set('y', y, -2, 2) || set('rotation', rotation, -360, 360) || set('opacity', opacity, 0, 1);
      if (err) return { error: err };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { ...patch, transform: t, keyframes } });
      return after();
    },

    async add_keyframes({ clip_id, property, easing, keyframes: keys }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const prop = PROP[property];
      if (!prop) return { error: 'property must be scale, x, y, rotation or opacity.' };
      const badEase = [easing, ...(keys || []).map((k) => k.easing)].find((e) => e !== undefined && e !== null && !EASINGS[e]);
      if (badEase !== undefined) return { error: `easing must be one of: ${Object.keys(EASINGS).join(', ')}.` };
      const pairs = (keys || []).map((k) => [Number(k.time_sec) - f.start, Number(k.value), k.easing ?? easing]).filter(([lt, v]) => Number.isFinite(lt) && Number.isFinite(v));
      if (!pairs.length) return { error: 'Give at least one keyframe with time_sec and value.' };
      const outside = pairs.find(([lt]) => lt < -0.01 || lt > f.len + 0.01);
      if (outside) return { error: `A keyframe at ${r2(outside[0] + f.start)}s is outside the clip (${r2(f.start)}s to ${r2(f.start + f.len)}s).` };
      const list = putKeys(f.clip.keyframes?.[prop], f.clip, pairs.map(([lt, v, e]) => [Math.min(f.len, Math.max(0, lt)), v, e]));
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { keyframes: { ...(f.clip.keyframes || {}), [prop]: list } } });
      return after({ keyframes: list.length });
    },

    async set_animation({ clip_id, in: inId, in_duration_sec = 0.5, out: outId, out_duration_sec = 0.5, combo }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const anim = { ...(f.clip.anim || {}) };
      const pick = (kind, id, dur) => {
        if (id === undefined || id === null || id === '') return null;
        if (id === 'none') {
          delete anim[kind];
          return null;
        }
        if (!ANIMATIONS[kind].some((x) => x.id === id)) return `Unknown ${kind} animation "${id}". Use one of: ${ids(ANIMATIONS[kind])}.`;
        anim[kind] = kind === 'combo' ? { type: id } : { type: id, duration: Math.min(5, Math.max(0.1, Number(dur) || 0.5)) };
        if (kind === 'combo') {
          delete anim.in;
          delete anim.out;
        } else delete anim.combo;
        return null;
      };
      const err = pick('in', inId, in_duration_sec) || pick('out', outId, out_duration_sec) || pick('combo', combo);
      if (err) return { error: err };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { anim } });
      return after({ animation: Object.fromEntries(Object.entries(anim).map(([k, v]) => [k, v.type])) });
    },

    async add_media({ media_name, as = 'main', start_sec = 0, main_index }) {
      const p = project();
      const q = String(media_name || '').toLowerCase();
      const m = p.media.find((x) => x.name.toLowerCase() === q) || p.media.find((x) => x.name.toLowerCase().includes(q));
      if (!m) return { error: `No media named "${media_name}". Library: ${p.media.map((x) => x.name).join(', ') || 'empty'}.` };
      return place(m, { as, start_sec, main_index, name: m.name });
    },

    async search_sounds({ kind, query }) {
      const lib = { music: 'music', sfx: 'sfxall', meme: 'trolls', memes: 'trolls', troll: 'trolls', trolls: 'trolls' }[String(kind || '').toLowerCase()];
      if (!lib) return { error: 'kind must be "music", "sfx" or "meme".' };
      const res = await api.librarySearch({ kind: lib, q: String(query || ''), category: '', page: 1 });
      if (res.error) return { error: res.error };
      const sounds = (res.results || []).slice(0, 12).map((it) => ({
        sound_id: keep('s', it), title: it.title, duration_sec: it.duration ? r2(it.duration) : undefined, by: it.creator,
        ...(it.license === 'by' ? { needs_credit: true } : {}),
      }));
      return sounds.length ? { sounds } : { sounds, note: 'Nothing found; try other or simpler English words.' };
    },

    async add_sound({ sound_id, start_sec = 0, duration_sec, volume = 1, fade_in_sec = 0, fade_out_sec = 0 }) {
      const item = found.get(sound_id);
      if (!item || !String(sound_id).startsWith('s')) return { error: `Unknown sound_id "${sound_id}". Use an id from search_sounds.` };
      const res = await api.libraryAdd(item);
      if (res.error) return { error: res.error };
      const added = await place(ctx.addProbed?.(res), { start_sec, name: item.title });
      if (added.error) return added;
      return shapeAudio(added.clip_id, { duration_sec, volume, fade_in_sec, fade_out_sec }, added);
    },

    async list_voices() {
      const st = await api.ttsStatus();
      const out = { piper: (st.voices || []).map((v) => ({ voice_id: v.id, name: v.name, language: v.lang, gender: v.gender })) };
      if (st.elevenKey) {
        const ev = await api.ttsElevenVoices();
        out.elevenlabs = ev.error ? { error: ev.error } : (ev.voices || []).slice(0, 30).map((v) => ({ voice_id: v.id, name: v.name, ...(v.labels ? { labels: v.labels } : {}) }));
      } else out.elevenlabs = 'No ElevenLabs key saved.';
      return out;
    },

    async add_voiceover({ text, voice_id, engine = 'piper', start_sec = 0, speed = 1, volume = 1 }) {
      if (!String(text || '').trim()) return { error: 'text is empty.' };
      const eleven = /eleven/i.test(String(engine));
      const res = await api.ttsSpeak({ engine: eleven ? 'eleven' : 'piper', voiceId: voice_id, voiceName: voice_id, text: String(text), speed: Number(speed) || 1 });
      if (res.error) return { error: res.error };
      const added = await place(ctx.addProbed?.(res), { start_sec, name: res.name });
      if (added.error) return added;
      return shapeAudio(added.clip_id, { volume }, added);
    },

    async search_stock({ kind = 'video', query }) {
      const k = String(kind).toLowerCase().startsWith('p') ? 'photo' : 'video';
      const res = await api.stockSearch({ kind: k, q: String(query || '') });
      if (res.error) return { error: res.error };
      const items = (res.results || []).slice(0, 10).map((it) => ({
        stock_id: keep(k === 'video' ? 'v' : 'p', it), tags: it.tags, ...(it.duration ? { duration_sec: it.duration } : {}), size: `${it.width}x${it.height}`,
      }));
      return items.length ? { items } : { items, note: 'Nothing found; try other English words.' };
    },

    async add_stock({ stock_id, as = 'overlay', start_sec = 0, duration_sec, main_index }) {
      const item = found.get(stock_id);
      if (!item || !/^[vp]/.test(String(stock_id))) return { error: `Unknown stock_id "${stock_id}". Use an id from search_stock.` };
      const res = await api.stockAdd(item);
      if (res.error) return { error: res.error };
      const added = await place(ctx.addProbed?.(res), { as, start_sec, main_index, name: res.name, fullFrame: true });
      if (added.error) return added;
      if (added.track === 'overlay' && Number(duration_sec) > 0) {
        const c = findClip(added.clip_id).clip;
        dispatch({ type: 'update', track: 'overlay', id: c.id, patch: { out: c.in + Number(duration_sec) * (c.speed || 1) } });
      }
      return after({ clip_id: added.clip_id, track: added.track });
    },

    async list_options({ what }) {
      const named = (list) => list.map((x) => (x.name && x.name !== x.id ? `${x.id} (${x.name})` : x.id));
      const lists = {
        text_templates: () => named(TEXT_TEMPLATES),
        caption_styles: () => named(CAPTION_STYLES),
        fonts: () => ctx.fontIds?.() || ['montserrat', 'poppins', 'anton', 'bebas', 'cairo', 'tajawal', 'almarai', 'amiri'],
        text_animations: () => ({ anim_in: ANIM_IN.map((x) => x.id), anim_out: ANIM_OUT.map((x) => x.id), anim_loop: ANIM_LOOP.map((x) => x.id) }),
        text_effects: () => TEXT_EFFECTS.map((x) => x.id),
        highlights: () => HIGHLIGHTS.map((x) => x.id),
        bubbles: () => BUBBLES.map((x) => x.id),
        filters: () => named(FILTERS),
        effects: () => named(EFFECTS),
        transitions: () => named(TRANSITIONS),
        clip_animations: () => ({ in: ANIMATIONS.in.map((x) => x.id), out: ANIMATIONS.out.map((x) => x.id), combo: ANIMATIONS.combo.map((x) => x.id) }),
        blend_modes: () => BLEND_MODES.map((b) => b.id),
      };
      const fn = lists[String(what || '').toLowerCase()];
      if (!fn) return { error: `what must be one of: ${Object.keys(lists).join(', ')}.` };
      return { [what]: fn() };
    },

    async edit_text(a) {
      if (a.clip_id === 'captions') return restyleCaptions(a);
      const f = findClip(a.clip_id);
      if (!f || f.track !== 'text') return { error: `No text clip with id "${a.clip_id}". Call get_project to see the real ids.` };
      const look = textLook(a, f.clip);
      if (look.error) return look;
      const patch = { ...look.patch };
      if (a.text !== undefined) {
        if (!String(a.text).trim()) return { error: 'text is empty; use delete_clip to remove a text.' };
        patch.text = String(a.text);
      }
      if (a.start_sec !== undefined) patch.start = Math.max(0, Number(a.start_sec) || 0);
      if (a.duration_sec !== undefined) patch.duration = Math.max(0.2, Number(a.duration_sec) || 0.2);
      dispatch({ type: 'update', track: 'text', id: f.clip.id, patch });
      return after();
    },

    async add_effect({ effect_id, start_sec, duration_sec = 3 }) {
      if (!EFFECTS.some((x) => x.id === effect_id)) return { error: `Unknown effect "${effect_id}". Use one of: ${ids(EFFECTS)}.` };
      const clipId = uid();
      dispatch({ type: 'addEffectClip', clipId, fx: effect_id, at: Math.max(0, Number(start_sec) || 0), duration: Math.max(0.2, Number(duration_sec) || 3) });
      return after({ clip_id: clipId });
    },

    async move_clip({ clip_id, to_index, start_sec }) {
      const f = findClip(clip_id);
      if (!f) return { error: `No clip with id "${clip_id}". Call get_project to see the real ids.` };
      if (f.track === 'video') {
        const i = Number(to_index);
        if (!Number.isInteger(i) || i < 0) return { error: 'to_index (0 = first) is needed to move a main-track clip.' };
        dispatch({ type: 'moveVideo', id: clip_id, toIndex: i });
      } else {
        const t = num(start_sec, 'start_sec');
        if (t.error) return t;
        dispatch({ type: 'update', track: f.track, id: clip_id, patch: { start: Math.max(0, t) } });
      }
      return after();
    },

    async trim_clip({ clip_id, start_sec, end_sec }) {
      const f = findClip(clip_id);
      if (!f || f.clip.gap) return { error: `No clip with id "${clip_id}". Call get_project to see the real ids.` };
      const p = project();
      const c = f.clip;
      const start = f.track === 'video' ? videoLayout(p.videoClips).find((l) => l.clip.id === clip_id).start : c.start;
      const end = start + (f.track === 'video' || f.track === 'overlay' || f.track === 'audio' ? (f.track === 'audio' ? c.out - c.in : clipLen(c)) : c.duration);
      const ns = start_sec === undefined ? start : Number(start_sec);
      const ne = end_sec === undefined ? end : Number(end_sec);
      if (!Number.isFinite(ns) || !Number.isFinite(ne) || ne - ns < 0.1) return { error: 'The new end must be at least 0.1 s after the new start.' };
      let patch;
      if (f.track === 'text' || f.track === 'effect') patch = { start: Math.max(0, ns), duration: ne - Math.max(0, ns) };
      else {
        // Media: move the source in / out points (speed-scaled for picture clips).
        const sp = f.track === 'audio' ? 1 : c.speed || 1;
        const m = p.media.find((x) => x.id === c.mediaId);
        const max = m?.type === 'image' ? Infinity : m?.duration ?? c.out;
        const inP = c.in + (ns - start) * sp;
        const outP = c.out + (ne - end) * sp;
        if (inP < -1e-3) return { error: `The clip cannot start earlier: its source begins ${r2((start - ns) - c.in / sp)} s later than asked.` };
        if (outP > max + 1e-3) return { error: `The clip cannot end later: its source runs out at ${r2(end + (max - c.out) / sp)} s.` };
        patch = { in: Math.max(0, inP), out: Math.min(max, outP), ...(f.track === 'video' ? {} : { start: Math.max(0, ns) }) };
      }
      dispatch({ type: 'update', track: f.track, id: clip_id, patch });
      return after();
    },

    async clip_tools({ clip_id, action, start_sec = 0, main_index }) {
      const f = findClip(clip_id);
      if (!f || f.clip.gap) return { error: `No clip with id "${clip_id}". Call get_project to see the real ids.` };
      const newId = uid();
      switch (action) {
        case 'duplicate':
          if (f.track === 'effect' && !project().effectClips.some((x) => x.id === clip_id)) return { error: 'This effect is part of a clip; duplicate the clip.' };
          dispatch({ type: 'duplicate', track: f.track, id: clip_id, newId });
          return after({ new_clip_id: newId });
        case 'extract_audio':
          if (f.track !== 'video' && f.track !== 'overlay') return { error: 'Only main-track and overlay videos have sound to extract.' };
          dispatch({ type: 'extractAudio', track: f.track, id: clip_id, newId });
          await ctx.settle();
          if (!project().audioClips.some((x) => x.id === newId)) return { error: 'Nothing to extract: the clip has no sound, is already muted, or plays at another speed.' };
          return after({ audio_clip_id: newId });
        case 'to_overlay':
          if (f.track !== 'video') return { error: 'Only main-track clips can move to the overlay track.' };
          dispatch({ type: 'moveToOverlay', id: clip_id, at: Math.max(0, Number(start_sec) || 0) });
          return after();
        case 'to_main':
          if (f.track !== 'overlay') return { error: 'Only overlay clips can move to the main track.' };
          dispatch({ type: 'moveToMain', id: clip_id, index: Number.isInteger(Number(main_index)) ? Number(main_index) : undefined });
          return after();
        case 'mute':
        case 'unmute':
          if (f.track !== 'video' && f.track !== 'overlay') return { error: 'mute / unmute is for main-track and overlay videos; use set_volume for the audio track.' };
          dispatch({ type: 'update', track: f.track, id: clip_id, patch: { muted: action === 'mute' } });
          return after();
        default:
          return { error: 'action must be duplicate, extract_audio, to_overlay, to_main, mute or unmute.' };
      }
    },

    async set_color({ clip_id, ...vals }) {
      const p = project();
      const targets = clip_id === 'all'
        ? [...p.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', clip: c })), ...(p.overlayClips || []).map((c) => ({ track: 'overlay', clip: c }))]
        : [needPicture(clip_id)];
      if (targets[0]?.error) return targets[0];
      if (!targets.length) return { error: 'There are no video or photo clips.' };
      const RANGE = { brightness: [-1, 1], contrast: [0, 2], saturation: [0, 3], hue: [-180, 180], blur: [0, 20] };
      const set = {};
      for (const [k, [lo, hi]] of Object.entries(RANGE)) {
        if (vals[k] === undefined || vals[k] === null) continue;
        const n = Number(vals[k]);
        if (!Number.isFinite(n) || n < lo || n > hi) return { error: `${k} must be between ${lo} and ${hi}.` };
        set[k] = n;
      }
      if (!Object.keys(set).length) return { error: 'Give at least one of brightness, contrast, saturation, hue, blur.' };
      dispatch({ type: 'updateMany', updates: targets.map((t) => ({ track: t.track, id: t.clip.id, patch: { adjust: { ...DEFAULT_ADJUST, ...(t.clip.adjust || {}), ...set } } })) });
      return after({ clips: targets.length });
    },

    async set_compositing({ clip_id, chroma_key, key_color, key_strength, blend, crop_left, crop_top, crop_right, crop_bottom }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const patch = {};
      if (chroma_key !== undefined || key_color !== undefined || key_strength !== undefined) {
        if (key_color !== undefined && !HEX.test(String(key_color))) return { error: 'key_color must be #rrggbb.' };
        patch.chroma = {
          ...(f.clip.chroma || {}),
          on: chroma_key === undefined ? true : !!chroma_key,
          ...(key_color !== undefined ? { color: String(key_color) } : {}),
          ...(key_strength !== undefined ? { intensity: clamp(key_strength, 0, 100, 20) } : {}),
        };
      }
      if (blend !== undefined) {
        if (!BLEND_MODES.some((b) => b.id === blend)) return { error: `blend must be one of: ${BLEND_MODES.map((b) => b.id).join(', ')}.` };
        patch.blend = blend;
      }
      const cropIn = { l: crop_left, t: crop_top, r: crop_right, b: crop_bottom };
      if (Object.values(cropIn).some((v) => v !== undefined)) {
        const next = { ...cropOf(f.clip) };
        for (const [k, v] of Object.entries(cropIn)) {
          if (v === undefined) continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 90) return { error: 'crop values are percent of the source, 0 to 90.' };
          next[k] = n / 100;
        }
        patch.crop = cropOf({ crop: next }); // re-clamped (opposite edges keep 5% of the picture)
      }
      if (!Object.keys(patch).length) return { error: 'Give chroma_key / key_color / key_strength, blend and / or crop_*.' };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch });
      return after();
    },

    async set_project({ background, resolution, fps, name }) {
      const p = project();
      const patch = {};
      if (background !== undefined) {
        if (!HEX.test(String(background))) return { error: 'background must be #rrggbb.' };
        patch.background = String(background);
      }
      if (resolution !== undefined) {
        const r = Number(resolution);
        if (![480, 720, 1080, 1440, 2160].includes(r)) return { error: 'resolution must be 480, 720, 1080, 1440 or 2160.' };
        Object.assign(patch, { resolution: r, ...sizeFor(p.ratio, r) });
      }
      if (fps !== undefined) {
        const r = Number(fps);
        if (![24, 25, 30, 50, 60].includes(r)) return { error: 'fps must be 24, 25, 30, 50 or 60.' };
        patch.fps = r;
      }
      if (name !== undefined && String(name).trim()) patch.name = String(name).trim().slice(0, 120);
      if (!Object.keys(patch).length) return { error: 'Nothing to change.' };
      dispatch({ type: 'setProject', patch });
      return after({ format: `${project().width}x${project().height} @ ${project().fps}fps` });
    },

    async motion_guide({ topic }) {
      const t = String(topic || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (!MOTION_GUIDE[t]) return { error: `topic must be one of: ${MOTION_TOPICS.join(', ')}.` };
      return { topic: t, recipe: MOTION_GUIDE[t] };
    },

    async edit_style({ name }) {
      const id = findStyle(name);
      if (!id) {
        const all = STYLE_NAMES.map((k) => `${k} (${EDIT_STYLES[k].look})`);
        return { error: `No style named "${name}". Pick the closest of these and tell the user which one you used: ${all.join('; ')}` };
      }
      const st = EDIT_STYLES[id];
      return {
        style: st.title, look: st.look, recipe: st.recipe,
        how: 'Call get_project first; adapt the recipe to the video (its length, language, format) and apply it to the whole video; keep what the user asked for on top of the style.',
      };
    },

    async add_scene({ color, color2, direction = 'diagonal', duration_sec = 3, main_index }) {
      if (!HEX.test(String(color)) || (color2 !== undefined && !HEX.test(String(color2)))) return { error: 'color and color2 must be #rrggbb.' };
      if (!['horizontal', 'vertical', 'diagonal'].includes(direction)) return { error: 'direction must be horizontal, vertical or diagonal.' };
      if (!api.makeScene) return { error: 'Scenes are not available here.' };
      const p = project();
      const res = await api.makeScene({ color, color2, direction, width: p.width, height: p.height });
      if (res.error) return { error: res.error };
      const added = await place(ctx.addProbed?.(res), { main_index, name: res.name });
      if (added.error) return added;
      const c = findClip(added.clip_id).clip;
      dispatch({ type: 'update', track: 'video', id: c.id, patch: { out: (c.in || 0) + clamp(duration_sec, 0.2, 600, 3) } });
      await ctx.settle();
      const l = videoLayout(project().videoClips).find((x) => x.clip.id === c.id);
      return after({ clip_id: c.id, start: r2(l.start), end: r2(l.end) });
    },

    async undo() {
      if (!ctx.undoOwn) return { error: 'Undo is not available here.' };
      if (!ctx.undoOwn()) return { error: 'Nothing of yours to undo in this request.' };
      return after();
    },

    async export_video() {
      if (!ctx.startExport) return { error: 'Export is not available here.' };
      if (!project().videoClips.some((c) => !c.gap)) return { error: 'The main track is empty.' };
      ctx.startExport();
      return { ok: true, note: 'The save window is open for the user; the export runs in its own window after they choose where.' };
    },
  };

  const readCache = new Map();
  const cachedTools = new Set(['get_project', 'list_options', 'motion_guide', 'edit_style', 'transcribe']);
  return {
    async run(name, args) {
      const fn = Object.hasOwn(tools, name) ? tools[name] : null;
      if (!fn) return { error: `Unknown tool "${name}".` };
      try {
        const key = cachedTools.has(name) ? JSON.stringify([name, args || {}, projectRevision(project())]) : null;
        if (key && readCache.has(key)) return structuredClone(readCache.get(key));
        const result = await fn(args || {});
        if (key && !result.error) {
          if (readCache.size >= 32) readCache.delete(readCache.keys().next().value);
          readCache.set(key, structuredClone(result));
        }
        return result;
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
    // True for tools that change the project (used to decide whether there is anything to undo).
    mutates: (name) => !['get_project', 'list_options', 'motion_guide', 'edit_style', 'transcribe', 'search_sounds', 'list_voices', 'search_stock', 'export_video'].includes(name),
  };
}
