// CraftAI tools: what the AI model can ask the editor to do.
// Every editing tool goes through the same reducer actions as the buttons, so Undo, the timeline and the
// export all behave exactly as for a manual edit. Tools return small JSON results (or { error }) so the
// model can read them and correct itself.
import { clipLen, projectDuration, videoLayout, uid, isLayerLocked, renderable, exportDuration, actionLocked, cutRanges, retimeVideoClip, retimeTransition, prepareProjectAction } from "../../state/store.js";
import { FILTERS, EFFECTS, TRANSITIONS, RATIOS, DEFAULT_ADJUST, sizeFor } from "../effects/effects.js";
import { ANIM_IN, ANIM_LOOP, ANIM_OUT, BUBBLES, HIGHLIGHTS, TEXT_EFFECTS, TEXT_TEMPLATES } from '../text/catalog.js';
import { ANIMATIONS, KEY_EASINGS, KEY_PROPS, baseAt, hasKeys } from "../timeline/anim.js";
import { motionQuality } from '../timeline/motionQuality.js';
import { stateAtPinned } from '../timeline/track.js';
import { BLEND_MODES, cropOf, frameCrop, framingPatch, transformOf, opacityOf } from "../preview/visual.js";
import { MOTION_GUIDE, MOTION_TOPICS } from './motionGuide.js';
import { projectRevision, audioRevision } from './context.js';
import { regroupSegments } from "../text/subtitles.js";
import { validateAgentProject, verifyActionResults } from './validation.js';
import { projectScenes, filterScenes, storyboardSamples } from './sceneMap.js';
import { cropWordTiming } from '../text/timing.js';
import { EDITING_DECLARATIONS, createEditingTools } from './editingTools.js';
import { FILE_DECLARATIONS, createFileTools } from './fileTools.js';
import { CAPTION_DECLARATIONS, createCaptionTools } from './captionTools.js';
import { AUDIO_DECLARATIONS, createAudioTools } from './audioTools.js';
import { TRACKING_DECLARATIONS, createTrackingTools } from './trackingTools.js';
import { REVIEW_DECLARATIONS, createReviewTools } from './reviewTools.js';
import { EDITORIAL_DECLARATIONS, createEditorialTools } from './editorialTools.js';
import { REFERENCE_DECLARATIONS, createReferenceTools } from './referenceTools.js';
import { PATH_DECLARATIONS, createPathTools } from './pathTools.js';
import { GRAPHICS_DECLARATIONS, createGraphicsTools } from './graphicsTools.js';

const r2 = (n) => Math.round(n * 100) / 100;
const HEX = /^#[0-9a-f]{6}$/i;
const ids = (list) => list.map((x) => x.id).join(', ');
// An option id from a list, accepting the spellings agents use for the same thing: any case, spaces,
// - or _ between words, and the in/out suffix one vocabulary has and the other lacks (title fade vs
// clip fade_in, zoomIn vs zoom_in, "Montserrat" vs montserrat). Exact ids always win.
const squash = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function matchName(value, list) {
  if (list.some((x) => x.id === value)) return value;
  const n = squash(value);
  if (!n) return null;
  for (const candidate of [n, `${n}in`, n.replace(/(in|out)$/, '')]) {
    const hit = list.find((x) => squash(x.id) === candidate);
    if (hit) return hit.id;
  }
  return null;
}
const CAPTION_STYLES = TEXT_TEMPLATES.filter((t) => t.caption);

const S = { type: 'STRING' };
const N = { type: 'NUMBER' };
const B = { type: 'BOOLEAN' };
const SPEECH = { language: { ...S, description: 'en, ar, fr, es...; default auto' }, source: { ...S, enum: ['all', 'video', 'overlay', 'audio'], description: 'Audible mix by default. Select a track family or clip_ids to isolate speech from music.' },
  clip_ids: { type: 'ARRAY', items: S }, engine: { ...S, enum: ['local', 'cloud'] }, provider: { ...S, description: 'Cloud transcription: groq, openai, deepgram, elevenlabs' }, model: S };
const NON_MUTATING = new Set(['analyze_reference', 'graphics_guide', 'analyze_scenes', 'get_storyboard', 'annotate_scene', 'inspect_frames', 'get_project', 'list_options',
  'motion_guide', 'transcribe', 'search_sounds', 'list_voices', 'search_stock', 'export_video', 'review_section', 'list_local_media', 'export_subtitles', 'load_tools', 'recall_context',
  'edit_guide', 'log_footage', 'find_highlights', 'propose_edit_plan', 'critique_edit', 'get_beats']);
// Our own audio planner's message (electron/media/ffmpeg.cjs analysisAudioPlan) when nothing is audible.
const NOTHING_AUDIBLE = /^No audible clips in the selected \w+ source\./;
const REQUIRED_PROOF = new Set(['inspect_frames', 'get_storyboard', 'analyze_scenes', 'annotate_scene', 'transcribe', 'export_video', 'export_subtitles', 'review_section', 'log_footage', 'get_beats']);

// Look of a text (edit_text). Ids come from list_options, so the declarations stay short: every step sends them,
// and some free plans (Groq: 8K tokens a minute) count every token.
const TEXT_LOOK = {
  template_id: S, x: N, y: N, size: N, color: S, font: S, bold: B, italic: B, uppercase: B, align: S, rotation: N, opacity: N,
  stroke_width: N, stroke_color: S, background_color: S, effect: S, anim_in: S, anim_out: S, anim_loop: S, highlight: S, highlight_color: S,
  bubble: S, bubble_color: S,
};

// Piper voices are optional downloads (Settings > Voice): only the downloaded ones are usable.
const piperVoicesOf = (st) => (st?.installed ? (st.voices || []).filter((v) => v.downloaded) : []);
const PIPER_MISSING = (st) => !st?.supported ? 'Piper voices are not available on this computer.'
  : 'No Piper voice is downloaded. Ask the user to download the voice engine and a voice in Settings > Voice; do not retry piper until then.';

export const TOOL_DECLARATIONS = [
  ...EDITING_DECLARATIONS,
  ...FILE_DECLARATIONS,
  ...CAPTION_DECLARATIONS,
  ...AUDIO_DECLARATIONS,
  ...TRACKING_DECLARATIONS,
  ...REVIEW_DECLARATIONS,
  ...EDITORIAL_DECLARATIONS,
  ...REFERENCE_DECLARATIONS,
  ...PATH_DECLARATIONS,
  ...GRAPHICS_DECLARATIONS,
  {
    name:'inspect_frames',
    description:'Look at 1–6 actual frames with the configured vision-capable model. source timeline shows composition; clip shows raw source at timeline times_sec. source media inspects library footage using media_id and source_times_sec before insertion. Clip requires clip_id. Read-only.',
    parameters:{type:'OBJECT',properties:{source:S,clip_id:S,media_id:S,times_sec:{type:'ARRAY',items:N},source_times_sec:{type:'ARRAY',items:N}}},
  },
  {
    name: 'analyze_scenes', description: 'Detect cached visual shot boundaries, then map source shots onto the LIVE timeline. scope timeline (default) or media library. Query searches previously observed descriptions/tags and current transcript/captions, not inferred filenames. Paginated; boundaries alone do not describe scene meaning.',
    parameters: { type: 'OBJECT', properties: { scope: S, media_ids: { type: 'ARRAY', items: S }, clip_ids: { type: 'ARRAY', items: S }, threshold: N, min_scene_sec: N, start_sec: N, end_sec: N, query: S, offset: { type: 'INTEGER' }, limit: { type: 'INTEGER' } } },
  },
  {
    name: 'get_storyboard', description: 'Inspect bounded actual scene samples. Same filters as analyze_scenes; source timeline (composition), clip (raw at timeline times), media (raw source). Long shots get interval_sec samples, paged with offset/limit (max 6). Returns frame handles attached to next vision turn. Read samples before annotating or selecting footage.',
    parameters: { type: 'OBJECT', properties: { ...{ scope: S, media_ids: { type: 'ARRAY', items: S }, clip_ids: { type: 'ARRAY', items: S }, threshold: N, min_scene_sec: N, start_sec: N, end_sec: N, query: S, offset: { type: 'INTEGER' }, limit: { type: 'INTEGER' } }, source: S, scene_ids: { type: 'ARRAY', items: S }, interval_sec: N } },
  },
  {
    name: 'annotate_scene', description: 'Save a searchable observation of a source shot after its raw frames were presented in THIS request. Requires current analysis/shot/media IDs and frame_ids from inspect_frames or get_storyboard. Describe only observed content; sampled stills do not prove continuous action or audio. Does not change timeline or Undo.',
    parameters: { type: 'OBJECT', properties: { analysis_id: S, shot_id: S, media_id: S, description: S, tags: { type: 'ARRAY', items: S }, frame_ids: { type: 'ARRAY', items: S } }, required: ['analysis_id', 'shot_id', 'media_id', 'description', 'frame_ids'] },
  },
  {
    name: 'get_project',
    description: 'Read live project ids/times. Reuse a previous read when its revision matches. scope: all (default), overview, main, overlay, audio, text, captions, effects, media. clip_ids selects exact clips; offset/limit page lists (default 30, max 100). details true returns exact clip fields (also automatic for clip_ids). if_revision skips data only when the caller already has that scope. Read affected tracks after cuts or manual edits.',
    parameters: { type: 'OBJECT', properties: { scope: S, details: B, clip_ids: { type: 'ARRAY', items: S }, offset: { type: 'INTEGER' }, limit: { type: 'INTEGER' }, if_revision: S } },
  },
  {
    name: 'list_options',
    description: 'Ids you can use: what = text_templates, caption_styles, fonts, text_animations, text_effects, highlights, bubbles, filters, effects, transitions, clip_animations, blend_modes.',
    parameters: { type: 'OBJECT', properties: { what: S }, required: ['what'] },
  },
  {
    name: 'remove_silences',
    description: 'Cut silent stretches from the audible mix; related captions, overlays and audio ripple together. Default all includes detached/overlay audio. source selects all, video, overlay or audio; clip_ids selects speech clips to exclude music.',
    parameters: { type: 'OBJECT', properties: { min_silence_sec: { ...N, description: 'default 0.6' }, threshold_db: { ...N, description: 'default -35; -30 noisy, -45 quiet' }, keep_padding_sec: { ...N, description: 'default 0.12' }, source: SPEECH.source, clip_ids: SPEECH.clip_ids } },
  },
  {
    name: 'cut_range',
    description: 'Remove a timeline range, close the gap and ripple related tracks. Several cuts: start from the end, or use keep_ranges.',
    parameters: { type: 'OBJECT', properties: { start_sec: N, end_sec: N }, required: ['start_sec', 'end_sec'] },
  },
  {
    name: 'keep_ranges',
    description: 'Keep these valid timeline ranges in chronological order, rippling all tracks (highlights, shortening).',
    parameters: { type: 'OBJECT', properties: { ranges: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start_sec: N, end_sec: N }, required: ['start_sec', 'end_sec'] } } }, required: ['ranges'] },
  },
  {
    name: 'transcribe',
    description: 'Read cached speech with exact timeline and available word timestamps. Same audible content is transcribed once and reused for captions. Query and bounds filter overlapping segments; offset/limit page all results. Word timing precision is reported, never inferred as measured.',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, query: S, start_sec: N, end_sec: N, offset: { type: 'INTEGER' }, limit: { type: 'INTEGER' } } },
  },
  {
    name: 'add_captions',
    description: 'Automatic captions from the speech (replaces earlier ones). Restyle them with edit_text clip_id "captions".',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, words_per_caption: { type: 'INTEGER', description: '1–20, default 6. Uses measured word boundaries when available.' }, style_id: { ...S, description: 'caption style id, default cap-classic' } } },
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
    description: 'Split a clip at timeline time_sec. clip_id selects any track; omit it for the main-track clip at that time. Linked partners split together.',
    parameters: { type: 'OBJECT', properties: { time_sec: N, clip_id: S }, required: ['time_sec'] },
  },
  {
    name: 'set_speed',
    description: 'Speed 0.25 to 4 for main, overlay or audio clips. Main changes retime related content and ripple downstream; free-track clips keep their starts. Linked partners stay synchronized.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, speed: N }, required: ['clip_id', 'speed'] },
  },
  {
    name: 'set_volume',
    description: 'Volume (0 mute, 1 normal, 2 double) and fades of main/overlay videos or audio clips.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, volume: N, fade_in_sec: N, fade_out_sec: N }, required: ['clip_id'] },
  },
  {
    name: 'set_filter',
    description: 'Color filter of a main/overlay picture ("none" removes; ids: list_options filters).',
    parameters: { type: 'OBJECT', properties: { clip_id: S, filter_id: S }, required: ['clip_id', 'filter_id'] },
  },
  {
    name: 'set_effects',
    description: 'Effects of a main/overlay picture, replacing its list (ids: list_options effects; [] removes).',
    parameters: { type: 'OBJECT', properties: { clip_id: S, effect_ids: { type: 'ARRAY', items: S } }, required: ['clip_id', 'effect_ids'] },
  },
  {
    name: 'add_transition',
    description: 'Transition into a later main clip. Retime speech/cues before its new anchor, shift downstream cues together, and return the time map. Ids: list_options transitions.',
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
    description: 'Transform a picture. fit fill/fit resets framing keys; fill crops to canvas, fit keeps the whole source only when requested. focus_x/y: 0–1 in source; scale 1: framed base; x/y: canvas fractions.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, fit: S, focus_x: N, focus_y: N, scale: N, x: N, y: N, rotation: N, opacity: N }, required: ['clip_id'] },
  },
  {
    name: 'add_keyframes',
    description: `Keyframes of scale, x, y, rotation or opacity on a main or overlay clip (zooms, pans, fades, pops). time_sec on the timeline, inside the clip. easing (move into a key): ${KEY_EASINGS.join(', ')}. All but continuous stop (or jolt, linear) at each key; continuous flows through keys: use it after the first key for one fluid multi-point move. spring = natural arrival, back = overshoot. Returns motion: stops/jerks/reversals empty unless intended.`,
    parameters: { type: 'OBJECT', properties: { clip_id: S, property: S, easing: S, keyframes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { time_sec: N, value: N, easing: S }, required: ['time_sec', 'value'] } } }, required: ['clip_id', 'property', 'keyframes'] },
  },
  {
    name: 'set_animation',
    description: 'In / Out / Combo (all along) animation of a main or overlay clip; "none" removes. Ids: list_options clip_animations.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, in: S, in_duration_sec: N, out: S, out_duration_sec: N, combo: S }, required: ['clip_id'] },
  },
  {
    name: 'add_media',
    description: 'Add library media by exact media_id (preferred) or unambiguous media_name: main at main_index (default end), overlay/audio at start_sec. New scene pictures always fill the canvas.',
    parameters: { type: 'OBJECT', properties: { media_id: S, media_name: S, as: S, start_sec: N, main_index: N } },
  },
  {
    name: 'generate_image',
    description: 'Codex only: generate a real scene/character with imagegen. Request independent scenes together for parallel generation. Defaults to overlay at start_sec; main uses main_index. Use existing reference_media_ids for consistent characters.',
    parameters: { type: 'OBJECT', properties: { prompt: S, reference_media_ids: { type: 'ARRAY', items: S },
      as: S, start_sec: N, duration_sec: N, main_index: N, transparent_background: B }, required: ['prompt'] },
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
    description: 'Speech engines, models and voices for add_voiceover and add_narration.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_voiceover',
    description: 'Generate one speech clip on the audio track. First list_voices (Gemini default voice Kore). text verbatim, max 5000 chars.',
    parameters: { type: 'OBJECT', properties: { text: S, voice_id: S, engine: { ...S, description: 'gemini (default when set up), piper, elevenlabs' }, model: S,
      style: { ...S, description: 'Gemini tone, accent, pacing; not spoken.' },
      start_sec: N, speed: { ...N, description: 'Not Gemini (use style).' }, volume: N }, required: ['text'] },
  },
  {
    name: 'add_narration',
    description: 'Gemini TTS: 2–40 lines in one request, each its own clip. Use instead of several add_voiceover (rate limits).',
    parameters: { type: 'OBJECT', properties: {
      lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: S, start_sec: N }, required: ['text'] }, description: 'Verbatim, 5000 chars total. No start_sec: previous end + gap_sec (0.3).' },
      voice_id: S, model: S, style: S, start_sec: N, gap_sec: N, volume: N, retry_of: { type: 'ARRAY', items: S } }, required: ['lines'] },
  },
  {
    name: 'search_stock',
    description: 'Search free stock (Pixabay) for b-roll. kind video or photo, English words. Returns stock_id for add_stock.',
    parameters: { type: 'OBJECT', properties: { kind: S, query: S }, required: ['kind', 'query'] },
  },
  {
    name: 'add_stock',
    description: 'Add stock as overlay at start_sec for duration_sec (default) or main at main_index. New footage always fills the canvas.',
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
    description: 'action: duplicate, extract_audio, to_overlay (start_sec), to_main (main_index), mute, unmute, reverse (again restores original; source max 20s; unlink first), freeze (time_sec, duration_sec: hold existing picture interval, keep sound/timing), set_layer (layer), link (partner_clip_id), unlink. Layer moves need a free unlocked destination.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, action: S, start_sec: N, main_index: N, layer: { type: 'INTEGER' }, partner_clip_id: S, time_sec: N, duration_sec: N }, required: ['clip_id', 'action'] },
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
    description: 'Export only when requested. Await encoding; return actual file/metadata plus local decoded diagnostics and sampled images of its first 30 seconds (explicitly partial for longer files). No semantic audio listening. Optional file_path (.mp4); otherwise unique Downloads filename. overwrite only if requested. quality low/medium/high/ultra; codec h264/h265, resolution cap 0/480/720/1080/1440/2160, fps 0/24/25/30/50/60, crf 0–51, encoder_preset, audio_kbps 96/128/192/256/320. Settings apply to this export only. Stop cancels processing.',
    parameters: { type: 'OBJECT', properties: { file_path: S, name: S, overwrite: B, quality: S, codec: S, resolution: N, fps: N, crf: N, encoder_preset: S, audio_kbps: N } },
  },
];

// A retry explicitly identifies the failed operation it replaces. This is
// orchestration metadata; individual editor functions ignore it.
for (const tool of TOOL_DECLARATIONS) tool.parameters.properties.retry_of = { ...S, description: 'failed_operation_id being retried, if correcting a failed operation.' };

// Size, place, animations and keyframed properties of a picture clip, only when they differ from the defaults.
function motionInfo(c, media, project) {
  const t = transformOf(c);
  const out = {};
  const crop = cropOf(c);
  if (media?.width && media?.height && project?.width && project?.height) {
    const w = media.width * (1 - crop.l - crop.r), h = media.height * (1 - crop.t - crop.b);
    const k = Math.min(project.width / w, project.height / h);
    out.base_coverage_pct = [r2(100 * w * k * t.scale * (t.uniform ? 1 : t.scaleX) / project.width), r2(100 * h * k * t.scale * (t.uniform ? 1 : t.scaleY) / project.height)];
  }
  if (Object.values(crop).some(Boolean)) out.source_crop_pct = Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, r2(value * 100)]));
  if (t.scale !== 1) out.scale = r2(t.scale);
  if (t.x || t.y) out.position = [r2(t.x), r2(t.y)];
  if (t.rot) out.rotation = r2(t.rot);
  if (opacityOf(c) < 1) out.opacity = r2(opacityOf(c));
  const keyed = KEY_PROPS.filter((k) => hasKeys(c, k));
  if (keyed.length) out.keyframed = keyed.map((k) => (k === 'rot' ? 'rotation' : k));
  if (c.keyframes) { out.keyframes = c.keyframes; out.keyframe_time_basis = 'source_seconds'; }
  for (const key of ['filter', 'filterIntensity', 'effects', 'adjust', 'grade', 'blend', 'chroma', 'mask', 'audioFx', 'enhance', 'track', 'pin']) if (c[key] !== undefined) out[key] = c[key];
  if (c.anim && (c.anim.in || c.anim.out || c.anim.combo)) {
    out.animation = Object.fromEntries(['in', 'out', 'combo'].filter(k => c.anim[k]).map(k => [k, c.anim[k].type]));
    out.animation_details = c.anim;
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
const soundInfo = c => ({ volume: c.volume ?? 1,
  ...(c.volumeKeys?.length ? { volume_automation: { time_basis: 'source_seconds', points: c.volumeKeys } } : {}),
  ...(c.audioFx ? { audio_effects: c.audioFx } : {}),
  ...Object.fromEntries([['fadeIn','fade_in'],['fadeOut','fade_out'],['fadeInOffset','fade_in_offset'],['fadeOutOffset','fade_out_offset']]
    .filter(([field]) => c[field] > 0).map(([field, key]) => [key, r2(c[field])])),
});
export function summarizeProject(p) {
  const mediaById = Object.fromEntries(p.media.map((m) => [m.id, m]));
  const layout = videoLayout(p.videoClips);
  const label = (c) => (mediaById[c.mediaId] ? mediaById[c.mediaId].name : 'missing media');
  return {
    name: p.name,
    format: `${p.ratio} ${p.width}x${p.height} @ ${p.fps}fps`,
    background: p.background || '#000000',
    duration_sec: r2(exportDuration(p)),
    timeline_extent_sec: r2(projectDuration(p)),
    layer_state: p.layerState || {}, layer_names: p.layerNames || {}, layers: p.layers || {},
    markers: p.markers || [], magnet: p.magnet || {},
    main_track: layout.map((l) => (l.clip.gap
      ? { id: l.clip.id, type: 'gap', start: r2(l.start), end: r2(l.end) }
      : {
        id: l.clip.id, media_id: l.clip.mediaId, layer: 0, disabled: !!l.clip.disabled, link_id: l.clip.linkId || null, media: label(l.clip), type: mediaById[l.clip.mediaId]?.type, start: r2(l.start), end: r2(l.end),
        source_in: r2(l.clip.in), source_out: r2(l.clip.out), speed: l.clip.speed || 1, volume: l.clip.volume ?? 1,
        muted: !!l.clip.muted, filter: l.clip.filter || 'none', effects: l.clip.effects || [],
        transition_in: l.clip.transition ? l.clip.transition.type : null, transition: l.clip.transition || null,
        ...soundInfo(l.clip),
        ...motionInfo(l.clip, mediaById[l.clip.mediaId], p),
      })),
    overlay_track: (p.overlayClips || []).map((c) => ({ id: c.id, media_id: c.mediaId, layer: c.layer || 0, disabled: !!c.disabled, link_id: c.linkId || null, link_offset_sec: c.linkOff || 0, link_source_offset_sec: c.linkInOff || 0, source_in: c.in, source_out: c.out, speed: c.speed || 1, muted: !!c.muted, media: label(c), start: r2(c.start), end: r2(c.start + clipLen(c)), ...motionInfo(c, mediaById[c.mediaId], p), ...soundInfo(c) })),
    audio_track: p.audioClips.map((c) => ({
      id: c.id, media_id: c.mediaId, layer: c.layer || 0, disabled: !!c.disabled, link_id: c.linkId || null, link_offset_sec: c.linkOff || 0, link_source_offset_sec: c.linkInOff || 0, source_in: c.in, source_out: c.out, speed: c.speed || 1, muted: !!c.muted, media: label(c), start: r2(c.start), end: r2(c.start + (c.out - c.in) / (c.speed || 1)), volume: c.volume ?? 1,
      ...soundInfo(c),
    })),
    // Captions are many: listed by count and time span, their look once.
    text_track: p.textClips.filter((c) => !c.caption).map((c) => ({ id: c.id, layer: c.layer || 0, disabled: !!c.disabled, text: c.text, start: r2(c.start), end: r2(c.start + c.duration), ...textInfo(c) })),
    captions: captionInfo(p.textClips.filter((c) => c.caption)),
    effects_track: (p.effectClips || []).map((c) => ({ id: c.id, layer: c.layer || 0, disabled: !!c.disabled, effect: c.fx, start: r2(c.start), end: r2(c.start + c.duration) })),
    media_library: p.media.map((m) => ({ id: m.id, name: m.name, type: m.type, width: m.width, height: m.height, has_audio: !!m.hasAudio, duration_sec: r2(m.duration || 0) })),
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
export function describeImageProgress({ completed = 0, total = 1, active = 0, failed = 0, inserted = 0, elapsed_sec = 0 }) {
  const elapsed = `${Math.floor(elapsed_sec / 60)}:${String(elapsed_sec % 60).padStart(2, '0')}`;
  if (total === 1) return `${completed && !failed ? 'Image ready' : 'Generating image'} · ${elapsed}`;
  return `Images: ${completed - failed}/${total} ready · ${inserted} placed · ${active} running${failed ? ` · ${failed} failed` : ''} · ${elapsed}`;
}

export function createToolRunner(ctx) {
  // Electron freezes contextBridge APIs. A separate facade can wrap their
  // functions safely and still observe APIs supplied later by test/host adapters.
  const api = new Proxy({}, { get(_target, key) {
    const value = ctx.api?.[key];
    return typeof value === 'function' ? (...args) => {
      if (ctx.isCanceled?.()) throw new Error('Editing stopped.');
      const result = value.apply(ctx.api, args);
      return result && typeof result.then === 'function' ? result.then(output => {
        if (ctx.isCanceled?.()) throw new Error('Editing stopped.');
        return output;
      }) : result;
    } : value;
  } });
  let operation = null;
  const validate = p => {
    if (operation?.validation?.has(p)) return operation.validation.get(p);
    const result = validateAgentProject(p);
    operation?.validation?.set(p, result);
    return result;
  };
  const dispatch = action => {
    action = { ...action, coverExport: true };
    if (ctx.isCanceled?.()) throw new Error('Editing stopped.');
    if (ctx.editActive && !ctx.editActive()) throw new Error('The project changed outside this request. Refresh before editing again.');
    if (operation && !operation.wrote && projectRevision(ctx.getProject()) !== operation.revision) throw new Error('The project changed while this operation was running. Its stale result was not applied.');
    if (actionLocked(ctx.getProject(), action)) throw new Error('The requested edit is blocked by a locked layer. Unlock it first.');
    // Simulate the same reducer before writing. Invalid mutations must never be
    // reported as applied, or leave the timeline broken until completion checks.
    const before = ctx.getProject();
    const planned = prepareProjectAction(before, action), candidate = planned.project;
    const oldIssues = new Set(validate(before).issues);
    const issues = validate(candidate).issues.filter(issue => !oldIssues.has(issue));
    if (issues.length) throw new Error(`Edit validation failed: ${issues.join(' ')}`);
    operation?.actions.push(action);
    if (operation) operation.wrote = true;
    ctx.dispatch(planned.action);
  };
  const addProbed = result => {
    if (ctx.isCanceled?.()) throw new Error('Editing stopped.');
    if (operation && !operation.wrote && projectRevision(ctx.getProject()) !== operation.revision) throw new Error('The project changed while media was being prepared. Its stale result was not applied.');
    if (ctx.editActive && !ctx.editActive()) throw new Error('The editor request no longer owns this edit.');
    if (operation) operation.wrote = true;
    return ctx.addProbed?.(result);
  };
  const project = () => ctx.getProject();
  const after = async (extra = {}) => {
    await ctx.settle();
    return { ok: true, duration_sec: r2(exportDuration(project())), timeline_extent_sec: r2(projectDuration(project())), revision: projectRevision(project()), ...extra };
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
  const needPicture = (id, tool) => {
    const f = findClip(id);
    if (!f) return { error: `No clip with id "${id}". Call get_project to see the real ids.` };
    if (!(f.track === 'video' || f.track === 'overlay') || f.clip.gap) {
      const what = f.clip.gap ? 'a gap' : { text: 'a title', audio: 'an audio clip', effect: 'an effect layer' }[f.track] || 'not a picture';
      const instead = f.track === 'text' ? (tool === 'set_animation' ? ' Titles animate with edit_text (anim_in, anim_out, anim_loop).' : ' Titles are placed and styled with edit_text (x, y, size, rotation, opacity).')
        : f.track === 'audio' ? ' It has no picture; set_volume and set_audio_effects change audio.' : '';
      return { error: `Clip "${id}" is ${what}, not a main-track or overlay video / photo.${instead}` };
    }
    const p = project();
    f.start = f.track === 'overlay' ? f.clip.start : videoLayout(p.videoClips).find((l) => l.clip.id === id).start;
    f.len = clipLen(f.clip);
    return f;
  };
  const PROP = { scale: 'scale', x: 'x', y: 'y', rotation: 'rot', rot: 'rot', opacity: 'opacity' };
  // How smooth a picture clip's motion is, frame by frame (src/features/timeline/motionQuality.js).
  const clipMotion = (f, clip) => {
    const p = project();
    return motionQuality((lt) => stateAtPinned(p, { clip, track: f.track }, lt, f.len), { len: f.len, fps: p.fps || 30, width: p.width || 1920, height: p.height || 1080, start: f.start, entrance: f.track === 'overlay' });
  };
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
  // (at main_index, default the end) or as an overlay at start_sec. Visuals fill
  // the current canvas. Whole-source fit is a separate framing edit, never an
  // accidental insertion default (legacy fit arguments are intentionally ignored).
  // Returns { clip_id, track } or { error }.
  const place = async (m, { as = 'main', start_sec = 0, main_index, name } = {}) => {
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
    } else {
      track = 'video';
      const n = Number(main_index);
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, preserveCanvas: true, ...(Number.isInteger(n) && n >= 0 ? { index: n } : {}) });
    }
    if (m.type !== 'audio') dispatch({ type: 'update', track, id: clipId, patch: {
      crop: frameCrop(m, project().width, project().height),
      transform: transformOf({}),
    } });
    await ctx.settle();
    if (!findClip(clipId)) return { error: `Could not put "${name || m.name}" on the timeline.` };
    return { clip_id: clipId, track, added: name || m.name };
  };

  // Prepare native jobs from one snapshot. Stream completed results, importing
  // only the ready prefix so scene order survives out-of-order generation.
  const mainImageEnd = () => videoLayout(project().videoClips).at(-1)?.end || 0;
  function prepareImageScene({ prompt, reference_media_ids = [], as = 'overlay', start_sec = 0, duration_sec = 5, main_index, transparent_background = false }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) return { error: 'Provide an image prompt of 1–16000 characters.' };
    if (!['overlay', 'main', 'library'].includes(as)) return { error: 'as must be overlay, main or library.' };
    const at = Number(start_sec), length = Number(duration_sec);
    if (!Number.isFinite(at) || at < 0 || !Number.isFinite(length) || length < 0.2 || length > 3600) return { error: 'Use a nonnegative start_sec and duration_sec between 0.2 and 3600.' };
    if (main_index !== undefined && (!Number.isInteger(Number(main_index)) || Number(main_index) < 0)) return { error: 'main_index must be a nonnegative integer.' };
    if (as === 'main' && at !== 0 && main_index === undefined) return { error: 'Use main_index for main-track insertion, or overlay for placement at an exact start_sec.' };
    if (!Array.isArray(reference_media_ids) || reference_media_ids.length > 3) return { error: 'Use at most three reference_media_ids.' };
    const p = project(), references = reference_media_ids.map(id => p.media.find(m => m.id === id && m.type === 'image'));
    if (references.some(m => !m?.path)) return { error: 'Reference IDs must name existing images in the project media library.' };
    if ((as === 'main' || (as === 'overlay' && at + length > mainImageEnd())) && isLayerLocked(p, 'video', 0)) return { error: 'Unlock the main track before adding this generated scene.' };
    return { request: { prompt: prompt.trim(), ratio: p.ratio || `${p.width}:${p.height}`, width: p.width, height: p.height,
      referencePaths: references.map(m => m.path), transparentBackground: transparent_background === true }, as, at, length, main_index };
  }
  async function insertImageScene({ as, at, length, main_index }, res) {
    if (res.error) return { error: res.error };
    if (res.canceled || ctx.isCanceled?.()) return { error: 'Image generation stopped.' };
    if (res.type !== 'image' || !res.path) return { error: 'No readable generated image was returned.' };
    const m = addProbed(res);
    if (!m) return { error: 'Could not add the generated image to the project.' };
    if (as === 'library') return after({ media_id: m.id, added: m.name });
    const added = await place(m, { as, start_sec: at, main_index, name: m.name });
    if (added.error) return added;
    dispatch({ type: 'update', track: added.track, id: added.clip_id, patch: { in: 0, out: length } });
    if (as === 'overlay' && at + length > mainImageEnd()) {
      dispatch({ type: 'extendVideoTo', end: at + length, gapId: uid() });
      await ctx.settle();
      if (mainImageEnd() + 0.001 < at + length) return { error: 'The image was added, but the main track is locked and could not extend to cover its scene.' };
    }
    return after({ ...added, media_id: m.id, length_sec: length, width: res.width, height: res.height });
  }
  async function runImages(scenes) {
    if (!Array.isArray(scenes) || !scenes.length || scenes.length > 12) throw new Error('Use 1–12 image scenes per batch.');
    let expectedRevision = projectRevision(project()), stale = false;
    const prepared = scenes.map(args => {
      try { return prepareImageScene(args || {}); } catch (e) { return { error: e.message }; }
    });
    const jobIndices = prepared.flatMap((scene, i) => scene.error ? [] : [i]);
    const results = new Array(scenes.length), received = new Map();
    prepared.forEach((scene, i) => { if (scene.error) received.set(i, scene); });
    const batchId = uid();
    let next = 0, queue = Promise.resolve(), latest;
    const report = progress => {
      latest = progress;
      try { ctx.onImageProgress?.({ ...progress, inserted: results.filter(result => result?.changed).length }); } catch {}
    };
    const insert = async (scene, image) => {
      if (ctx.isCanceled?.()) return { error:'Image generation stopped.', changed:false };
      if (stale || projectRevision(project()) !== expectedRevision || (ctx.editActive && !ctx.editActive())) {
        stale = true;
        return { error:'The project changed while images were generating. Stale scene insertions were not applied.', changed:false };
      }
      const before = project(), active = { revision: projectRevision(before), actions: [], wrote: false, validation: new WeakMap() };
      operation = active;
      let result;
      try { result = await insertImageScene(scene, image); await ctx.settle(); }
      catch (error) { result = { error:error.message }; }
      finally { operation = null; }
      const errors = verifyActionResults(project(), active.actions, before);
      if (errors.length && !result.error) result = { ...result, error: errors.join(' ') };
      const changed = active.wrote && projectRevision(project()) !== active.revision;
      expectedRevision = projectRevision(project());
      if (ctx.editActive && !ctx.editActive()) stale = true;
      return { ...result, ok: !result.error, changed, status: result.error ? 'blocked' : changed ? 'applied' : 'unchanged', revision: expectedRevision };
    };
    const drain = async () => {
      while (received.has(next)) {
        const i = next++, image = received.get(i);
        try { results[i] = prepared[i].error ? { error:prepared[i].error } : await insert(prepared[i], image); }
        catch (error) { stale = true; results[i] = { error:error.message, changed:false }; }
        if (latest) report(latest);
      }
    };
    const receive = (index, image) => {
      if (received.has(index)) return; // Streaming events and final reply overlap.
      received.set(index, image);
      queue = queue.then(drain);
    };
    const off = jobIndices.length ? api.onAgentImageProgress?.(progress => {
      if (progress.requestId !== ctx.requestId || progress.batchId !== batchId) return;
      report(progress);
      if (Number.isInteger(progress.index) && progress.index >= 0 && progress.index < jobIndices.length && progress.result) receive(jobIndices[progress.index], progress.result);
    }) : null;
    try {
      let response;
      try { response = jobIndices.length ? await api.agentGenerateImages?.({ requestId:ctx.requestId, batchId, scenes:jobIndices.map(i => prepared[i].request) }) : { results:[] }; }
      catch (error) { response = { error:error.message }; }
      const images = response?.results;
      jobIndices.forEach((i, job) => receive(i, Array.isArray(images) && images.length === jobIndices.length ? images[job] : { error:response?.error || 'Parallel image generation requires an updated ClipCraft.' }));
      await queue;
      await drain();
      return results;
    } finally { off?.(); }
  }

  // Volume, fades and length of a new audio clip.
  // A speech provider's request limit, as a result CraftAI can act on instead of retrying blindly.
  const speechFailure = (res, model) => {
    const l = res.limit;
    if (!l) return { error: res.error };
    const next = l.kind === 'daily'
      ? `Do not call Gemini TTS with ${l.model || model || 'this model'} again in this request: it is out of requests until ${l.resets}. ${l.other_model ? `Retry the missing lines with model "${l.other_model}" (its own limit), passing retry_of. ` : ''}If that fails too, finish the rest of the edit and tell the user which lines are missing and when the limit resets. Use piper or elevenlabs only if a different voice is acceptable, and say so.`
      : 'Gemini is over its per-minute request limit even after waiting. Do other edits first, then send the remaining lines together in one add_narration call.';
    return { error: res.error, provider_limit: l, next };
  };
  const speechWaitNote = (res) => res.waited_sec ? { rate_limit_wait_sec: res.waited_sec, note_limit: `Gemini's per-minute request limit delayed this by ${res.waited_sec} s. Send further narration lines together in one add_narration call.` } : {};
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
      const font = known ? matchName(a.font, known.map((id) => ({ id }))) : a.font;
      if (!font) return bad(`Unknown font "${a.font}". Some fonts: ${known.slice(0, 40).join(', ')}.`);
      patch.font = font;
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
      const id = matchName(a[k], list);
      if (!id) return bad(`${k} must be one of: ${ids(list)}.`);
      patch[key] = { ...dflt, ...(cur[key] || {}), id };
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

  const transcriptReads = new Map();
  let latestTranscript = null;
  const validateSpeechSelection = ({ source = 'all', clip_ids, engine = 'local' }) => {
    if (!['all', 'video', 'overlay', 'audio'].includes(source)) throw new Error('source must be all, video, overlay or audio.');
    if (!['local', 'cloud'].includes(engine)) throw new Error('engine must be local or cloud.');
    if (clip_ids !== undefined && (!Array.isArray(clip_ids) || !clip_ids.length || clip_ids.some(id => typeof id !== 'string' || !findClip(id)))) throw new Error('clip_ids must name existing clips.');
  };
  const speech = async ({ language = 'auto', source = 'all', clip_ids, engine = 'local', provider, model, verbatim = false } = {}) => {
    validateSpeechSelection({ source, clip_ids, engine });
    if (ctx.isCanceled?.()) return { error: 'Transcription stopped.' };
    const p = renderable(project()), selected = { source, clip_ids }, revision = audioRevision(p, selected);
    // verbatim (local engine) keeps hesitations for editorial analysis; captions use the clean transcript.
    const options = { language, source, clip_ids, engine, provider, model, maxLen: 0, requestId: ctx.requestId, ...(verbatim && engine === 'local' ? { verbatim: true } : {}) };
    const key = JSON.stringify([revision, language, engine, provider, model, !!options.verbatim]);
    const cached = transcriptReads.get(key);
    if (cached) { latestTranscript = { ...cached, source, clip_ids, audio_fingerprint: revision }; return { ...structuredClone(cached), cached: true }; }
    const method = engine === 'cloud' ? api.runCaptionsCloud : api.runCaptions;
    if (!method) return { error: 'The selected speech engine is unavailable.' };
    const res = await method(p, options);
    if (ctx.isCanceled?.() || res.canceled) return { error: 'Transcription stopped.' };
    if (!res.ok) return { error: String(res.error || 'Transcription failed.').split('\n')[0] };
    if (audioRevision(renderable(project()), selected) !== revision) return { error: 'The audible timeline changed during transcription. Retry with the current audio.' };
    const result = { ...res, audio_revision: res.audio_revision || revision };
    latestTranscript = { ...result, source, clip_ids, audio_fingerprint: revision };
    // The main service checks source-file mtimes on every invocation. Only cache
    // legacy/injected API results here; durable responses have audio_revision.
    if (!res.audio_revision) {
      if (transcriptReads.size >= 8) transcriptReads.delete(transcriptReads.keys().next().value);
      transcriptReads.set(key, structuredClone(result));
    }
    return result;
  };

  // Replace 2–6 frames by one contact sheet for transport; cells keep their IDs
  // and times. If the sheet cannot be built, the separate frames are sent.
  const withSheet = async result => {
    if (result?.error || !Array.isArray(result?.frames) || result.frames.length < 2 || !api.agentFrameSheet) return result;
    const sheet = await api.agentFrameSheet({ frame_ids: result.frames.map(f => f.id), revision: result.revision });
    if (!sheet || sheet.error) return result;
    return { ...result, sheet_id: sheet.id, sheet_cells: sheet.cells.map(({ cell, id, time_sec, source_time_sec }) => ({ cell, id, ...(Number.isFinite(time_sec) ? { time_sec } : {}), ...(Number.isFinite(source_time_sec) ? { source_time_sec } : {}) })),
      note: `${result.frames.length} frames are attached as one numbered contact sheet (${sheet.width}×${sheet.height}). Inspect a single frame on its own when fine detail matters.` };
  };
  const sceneData = async (a = {}) => {
    const { scope = 'timeline', media_ids, clip_ids, threshold = 10, min_scene_sec = 0.2 } = a;
    if (!['timeline', 'media'].includes(scope)) throw new Error('Scene scope must be timeline or media.');
    for (const [name, values] of Object.entries({ media_ids, clip_ids })) if (values !== undefined && (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string'))) throw new Error(`${name} must be a nonempty list of IDs.`);
    if ((a.start_sec !== undefined && (!Number.isFinite(a.start_sec) || a.start_sec < 0)) || (a.end_sec !== undefined && (!Number.isFinite(a.end_sec) || a.end_sec <= (a.start_sec || 0)))) throw new Error('Use valid nonnegative scene timeline bounds.');
    if (!api.agentAnalyzeScenes) throw new Error('Scene analysis requires an updated ClipCraft.');
    const p = project(), revision = projectRevision(p);
    if (clip_ids?.some(id => !findClip(id))) throw new Error('A selected clip no longer exists.');
    const selected = clip_ids ? new Set(clip_ids) : null;
    const used = scope === 'media' ? p.media.filter(m => ['video', 'image'].includes(m.type)).map(m => m.id)
      : [...p.videoClips, ...(p.overlayClips || [])].filter(c => !c.gap && (!selected || selected.has(c.id))).map(c => c.mediaId);
    const sourceIds = [...new Set(media_ids || used)];
    if (!sourceIds.length) return { revision, rows: [], analyses: [] };
    const result = await api.agentAnalyzeScenes({ project: { media: p.media, videoClips: p.videoClips, overlayClips: p.overlayClips, audioClips: p.audioClips, layerState: p.layerState }, audio_selection: latestTranscript ? { source: latestTranscript.source, clip_ids: latestTranscript.clip_ids } : undefined, media_ids: sourceIds, options: { threshold, min_scene_sec }, requestId: ctx.requestId });
    if (result.error) throw new Error(result.error);
    if (ctx.isCanceled?.() || result.canceled) throw new Error('Scene analysis stopped.');
    if (projectRevision(project()) !== revision) throw new Error('The timeline changed during analysis. Cached source analysis is available; read its current mapping again.');
    let transcript = renderable(p).textClips.filter(c => c.caption).map(c => ({ start: c.start, end: c.start + c.duration, text: c.text }));
    let speechSource = 'current_captions';
    if (latestTranscript?.source_audio_key && latestTranscript.source_audio_key === result.audio_key && latestTranscript.audio_fingerprint === audioRevision(renderable(p), { source: latestTranscript.source, clip_ids: latestTranscript.clip_ids })) { transcript = latestTranscript.segments; speechSource = 'current_transcript'; }
    const rows = filterScenes(projectScenes(p, new Map(result.analyses.map(index => [index.media_id, index])), { scope, media_ids, clip_ids, transcript }), a);
    return { revision, rows, analyses: result.analyses, speechSource };
  };
  const page = (a, max = 100, fallback = 30) => {
    const offset = a.offset ?? 0, limit = a.limit ?? fallback;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > max) throw new Error(`offset must be nonnegative and limit from 1 to ${max}.`);
    return { offset, limit };
  };

  const normalizedRange = (start, end, total) => {
    const a = Number(start), b = Number(end), fps = project().fps || 30;
    const tolerance = Math.max(0.005, 0.5 / fps);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a || b > total + tolerance || a >= total) return { error: `Use 0 <= start_sec < end_sec <= ${r2(total)}.` };
    const snap = t => Math.abs(total - t) <= tolerance ? total : Math.round(t * fps) / fps;
    const from = Math.max(0, snap(a)), to = Math.min(total, snap(b));
    if (to - from < 1 / fps - 1e-7) return { error: 'The range must contain at least one output frame.' };
    return { start: from, end: to };
  };

  const extended = createEditingTools({ project, dispatch, after, findClip, api, addProbed, settle: ctx.settle,
    requestId: ctx.requestId, setMainSpeed: args => tools.set_speed(args) });
  const fileTools = createFileTools({ project, after, findClip, api, addProbed, place, settle: ctx.settle,
    requestId: ctx.requestId, revision: projectRevision });
  const captionTools = createCaptionTools({ project, dispatch, after, findClip, api, splitClip: extended.splitClip,
    requestId: ctx.requestId, revision: projectRevision });
  const audioTools = createAudioTools({ project, dispatch, after, findClip, api, requestId: ctx.requestId });
  const trackingTools = createTrackingTools({ project, dispatch, after, findClip, api, requestId: ctx.requestId });
  const reviewTools = createReviewTools({ project, revision: projectRevision, startExport: ctx.startExport, api, requestId: ctx.requestId, isCanceled: ctx.isCanceled, editActive: ctx.editActive, onProgress:ctx.onToolProgress });
  const editorialTools = createEditorialTools({ project, dispatch, after, api, requestId: ctx.requestId, speech, sceneData, settle: ctx.settle, isCanceled: ctx.isCanceled });
  const pathTools = createPathTools({ project, dispatch, after, needPicture });
  const graphicsTools = createGraphicsTools({ project, dispatch, after, api, requestId: ctx.requestId, isCanceled: ctx.isCanceled, settle: ctx.settle });
  const referenceTools = createReferenceTools({ project, api, requestId: ctx.requestId, isCanceled: ctx.isCanceled });
  const tools = {
    ...editorialTools,
    ...referenceTools,
    ...pathTools,
    ...graphicsTools,
    ...reviewTools,
    ...trackingTools,
    ...audioTools,
    ...fileTools,
    ...captionTools,
    layer_tools: extended.layer_tools,
    // sheet (host-only, not in the declaration): overview checks receive one
    // numbered contact sheet instead of separate full-size frames.
    async inspect_frames({source='timeline',clip_id,media_id,times_sec,source_times_sec,sheet=false}){
      if(!api.agentInspectFrames)return {error:'Frame inspection requires an updated ClipCraft.'};
      const p=project(),revision=projectRevision(p);
      const {craftAI,...snapshot}=source==='timeline'?renderable(p):p;
      const result=await api.agentInspectFrames({project:snapshot,revision,source,clip_id,media_id,times_sec,source_times_sec,requestId:ctx.requestId});
      if(ctx.isCanceled?.()||result.canceled)return {error:'Frame inspection stopped.'};
      return sheet ? withSheet(result) : result;
    },
    async analyze_scenes(a = {}) {
      const { offset, limit } = page(a), data = await sceneData(a);
      return { revision: data.revision, scope: a.scope || 'timeline', total_scenes: data.rows.length, offset,
        next_offset: offset + limit < data.rows.length ? offset + limit : null, scenes: data.rows.slice(offset, offset + limit),
        sources: data.analyses.map(index => ({ media_id: index.media_id, analysis_id: index.analysis_id, source_fingerprint: index.fingerprint, source_shots: index.shots.length, cached: index.cached })),
        speech_source: data.speechSource, note: 'These are visual shot candidates. Inspect source/composed storyboard samples before describing content or selecting semantic highlights.' };
    },
    async get_storyboard(a = {}) {
      const { offset, limit } = page(a, 6, 6), data = await sceneData(a);
      const source = a.source || (a.scope === 'media' ? 'media' : 'timeline');
      if (a.scope === 'media' && source !== 'media') return { error: 'Library storyboards use source media.' };
      const samples = storyboardSamples(filterScenes(data.rows, a), { source, interval_sec: a.interval_sec ?? 10, start_sec: a.start_sec, end_sec: a.end_sec });
      const chosen = samples.slice(offset, offset + limit), frames = [];
      for (const sample of chosen) {
        const result = await tools.inspect_frames({ source, clip_id: sample.clip_id, media_id: sample.media_id,
          ...(source === 'media' ? { source_times_sec: [sample.time_sec] } : { times_sec: [sample.time_sec] }) });
        if (result.error) return result;
        const scene = data.rows.find(row => row.scene_id === sample.scene_id);
        if (result.frames.some(frame => source !== 'timeline' && frame.fingerprint !== scene.source_fingerprint)) return { error: 'Source changed since analysis. Rebuild the storyboard.' };
        frames.push(...result.frames.map(frame => ({ ...frame, scene_id: sample.scene_id, shot_id: sample.shot_id })));
      }
      if (projectRevision(project()) !== data.revision) return { error: 'The timeline changed during storyboard capture. Inspect the new mapping.' };
      const board = { revision: data.revision, frames, total_samples: samples.length, offset, next_offset: offset + limit < samples.length ? offset + limit : null,
        note: 'Actual image samples are attached to the next turn. Page remaining samples for long shots; source views omit composition edits.' };
      // A storyboard is an overview: one numbered sheet. Describing a scene from it is allowed;
      // tracking a subject still needs that frame inspected on its own.
      const sheeted = await withSheet(board);
      return sheeted.sheet_id ? { ...sheeted, note: `${sheeted.note} ${board.note}` } : board;
    },
    async annotate_scene(a) {
      if (!api.agentAnnotateScene) return { error: 'Scene observations require an updated ClipCraft.' };
      return api.agentAnnotateScene({ ...a, project: { media: project().media }, requestId: ctx.requestId });
    },
    async get_project({ scope = 'all', details = false, clip_ids, offset = 0, limit = 30, if_revision } = {}) {
      const p = project();
      const revision = projectRevision(p);
      if (if_revision === revision) return { revision, unchanged: true, ...(ctx.getEditorState ? { editor: ctx.getEditorState() } : {}) };
      const summary = summarizeProject(p);
      const fields = { main: 'main_track', overlay: 'overlay_track', audio: 'audio_track', text: 'text_track', effects: 'effects_track', media: 'media_library' };
      if (!['all', 'overview', 'captions', ...Object.keys(fields)].includes(scope)) return { error: `Unknown scope "${scope}".` };
      const out = { revision, timeline_extent_sec: summary.timeline_extent_sec, layer_state: summary.layer_state, layer_names: summary.layer_names, layers: summary.layers, markers: summary.markers, magnet: summary.magnet, ...(ctx.getEditorState ? { editor: ctx.getEditorState() } : {}), name: summary.name, format: summary.format, background: summary.background, duration_sec: summary.duration_sec,
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
      if (details || selected) {
        out.clip_details = [];
        const tracks = { main: ['video','videoClips'], overlay: ['overlay','overlayClips'], audio: ['audio','audioClips'], text: ['text','textClips'], effects: ['effect','effectClips'] };
        const safe = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' && /^data:[^;]+;base64,/.test(item) ? '[image data omitted]' : item));
        for (const [name,[track,key]] of Object.entries(tracks)) {
          const shown = name === 'text' ? [...(out.text_track || []), ...(out.caption_lines || [])] : out[fields[name]] || [];
          const ids = new Set(shown.map(c => c.id));
          for (const clip of p[key] || []) if (ids.has(clip.id)) out.clip_details.push({ track, id: clip.id, fields: safe(clip), keyframe_time_basis: 'source_seconds' });
        }
      }
      return out;
    },

    async remove_silences({ min_silence_sec = 0.6, threshold_db = -35, keep_padding_sec = 0.12, source = 'all', clip_ids } = {}) {
      const p = project(), total = exportDuration(p);
      if (!total) return { error: 'The main track is empty.' };
      const minDur = Number(min_silence_sec), noiseDb = Number(threshold_db), pad = Number(keep_padding_sec);
      if (!Number.isFinite(minDur) || minDur < 0.05 || minDur > 60 || !Number.isFinite(noiseDb) || noiseDb < -100 || noiseDb > 0 || !Number.isFinite(pad) || pad < 0 || pad > 10) return { error: 'Use min_silence_sec 0.05–60, threshold_db -100–0 and keep_padding_sec 0–10.' };
      validateSpeechSelection({ source, clip_ids });
      const res = await api.agentSilences(renderable(p), { minDur, noiseDb, source, clip_ids, requestId: ctx.requestId });
      if (ctx.isCanceled?.() || res.canceled) return { error: 'Silence analysis stopped.' };
      if (!res.ok) return { error: res.error };
      const fps = p.fps || 30;
      // Only real pauses inside selected, audible clips are removable. Outside them the
      // analysis mix is silent because nothing selected plays there (other clips, a photo,
      // silent b-roll, or pieces of a clip split by earlier cuts that now have new IDs).
      const audible = Array.isArray(res.audible) ? res.audible : null;
      const within = s => !audible ? [s] : audible.map(a => ({ start: Math.max(s.start, a.start), end: Math.min(s.end, a.end) })).filter(x => x.end > x.start);
      const padded = res.silences.flatMap(s => within({ start: s.start + pad, end: s.end - pad }));
      const ranges = padded.map(s => ({ start: Math.max(0, Math.round(s.start * fps) / fps), end: Math.min(total, Math.round(s.end * fps) / fps) }))
        .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= 1 / fps - 1e-7);
      const coveredSec = audible ? audible.reduce((n, a) => n + Math.max(0, Math.min(total, a.end) - Math.max(0, a.start)), 0) : total;
      const scope = audible && coveredSec < total - 0.05 ? { analyzed_sec: r2(coveredSec), note: `Only pauses inside the ${r2(coveredSec)} s where the selected audio plays were considered; the rest of the timeline was left untouched.` } : {};
      if (!ranges.length) return { ok: true, removed_count: 0, removed_sec: 0, ...scope, note: scope.note || 'No silence long enough was found.' };
      if (cutRanges(project(), ranges, { ripple: true }) === project()) return { error: 'The range edit is blocked by a locked related track or has no editable footage.' };
      dispatch({ type: 'cutRanges', ranges, ripple: true });
      await ctx.settle();
      return after({ removed_count: ranges.length, removed_sec: r2(total - exportDuration(project())), source, ...scope });
    },

    async cut_range({ start_sec, end_sec }) {
      const total = exportDuration(project()), range = normalizedRange(start_sec, end_sec, total);
      if (range.error) return range;
      const ranges = [range];
      if (cutRanges(project(), ranges, { ripple: true }) === project()) return { error: 'The range edit is blocked by a locked related track.' };
      dispatch({ type: 'cutRanges', ranges, ripple: true });
      await ctx.settle();
      return after({ removed_sec: r2(total - exportDuration(project())) });
    },

    async keep_ranges({ ranges }) {
      const total = exportDuration(project());
      if (!Array.isArray(ranges) || !ranges.length) return { error: 'Give at least one valid range.' };
      const list = ranges.map(r => normalizedRange(r.start_sec, r.end_sec, total));
      const invalid = list.find(r => r.error); if (invalid) return invalid;
      const cuts = complementRanges(list, total);
      if (cuts.length) {
        if (cutRanges(project(), cuts, { ripple: true }) === project()) return { error: 'The range edit is blocked by a locked related track.' };
        dispatch({ type: 'cutRanges', ranges: cuts, ripple: true });
      }
      return after({ kept_ranges: list.length });
    },

    async transcribe(a = {}) {
      const start = a.start_sec === undefined ? 0 : Number(a.start_sec), end = a.end_sec === undefined ? Infinity : Number(a.end_sec);
      if (!Number.isFinite(start) || start < 0 || !(end > start) || (a.end_sec !== undefined && !Number.isFinite(end))) return { error: 'Use 0 <= start_sec < end_sec.' };
      const offset = a.offset ?? 0, limit = a.limit ?? 30;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'offset must be nonnegative and limit from 1 to 100.' };
      const res = await speech(a);
      if (res.error) return res;
      const query = String(a.query || '').toLocaleLowerCase();
      const segments = res.segments.filter(s => s.end > start && s.start < end && (!query || s.text.toLocaleLowerCase().includes(query)));
      return { audio_revision: res.audio_revision, source: a.source || 'all', cached: res.cached, total_segments: res.segments.length,
        matched_segments: segments.length, offset, next_offset: offset + limit < segments.length ? offset + limit : null,
        segments: segments.slice(offset, offset + limit), word_timing: res.segments.some(s => s.words?.length) ? 'See words timing fields; estimated timings are marked.' : 'unavailable' };
    },

    async add_captions(a = {}) {
      const { style_id = 'cap-classic', words_per_caption = 6 } = a;
      const tpl = CAPTION_STYLES.find(t => t.id === style_id);
      if (!tpl) return { error: `Unknown style_id "${style_id}". Use one of: ${ids(CAPTION_STYLES)}.` };
      if (!Number.isInteger(words_per_caption) || words_per_caption < 1 || words_per_caption > 20) return { error: 'words_per_caption must be from 1 to 20.' };
      const res = await speech(a);
      if (res.error) return res;
      const segments = regroupSegments(res.segments, words_per_caption);
      dispatch({ type: 'setCaptions', style: { ...tpl.patch, template: tpl.id }, segments: segments.map(s => ({ ...s, id: uid() })) });
      return after({ captions: segments.length, style: tpl.id, audio_revision: res.audio_revision, cached_transcript: res.cached });
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

    async split_at({ time_sec, clip_id }) {
      if (clip_id) return extended.splitClip({ clip_id, time_sec });
      const t = num(time_sec, 'time_sec');
      if (t.error) return t;
      const hit = videoLayout(project().videoClips).find((l) => !l.clip.gap && t > l.start && t < l.end);
      if (!hit) return { error: `No main-track clip plays at ${t}s.` };
      if (t - hit.start < 0.1 || hit.end - t < 0.1) return { error: 'The split point is too close to the edge of the clip.' };
      dispatch({ type: 'split', track: 'video', id: hit.clip.id, t, newId: uid() });
      return after({ split_clip: hit.clip.id });
    },

    async set_speed({ clip_id, speed }) {
      if (['overlay', 'audio'].includes(findClip(clip_id)?.track)) return extended.freeSpeed({ clip_id, speed });
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      const sp = Number(speed);
      if (!(sp >= 0.25 && sp <= 4)) return { error: 'speed must be between 0.25 and 4.' };
      const plan = retimeVideoClip(project(), clip_id, sp);
      if (plan.error) return { error: plan.error };
      if (plan.project === project()) return after({ clip_length_sec: r2(clipLen(f.clip)), note: 'The clip already has this speed.' });
      dispatch({ type: 'retimeVideo', id: clip_id, speed: sp });
      await ctx.settle();
      if (projectRevision(project()) !== projectRevision(plan.project)) return { error: 'The speed edit did not reach its planned timeline mapping.' };
      return after({ clip_length_sec: r2(clipLen({ ...f.clip, speed: sp })), time_map: plan.time_map });
    },

    async set_volume({ clip_id, volume, fade_in_sec, fade_out_sec }) {
      const f = findClip(clip_id);
      const media = f && project().media.find(m => m.id === f.clip.mediaId);
      if (!f || !['video', 'overlay', 'audio'].includes(f.track) || f.clip.gap || (f.track !== 'audio' && media?.type === 'image')) return { error: `Clip "${clip_id}" has no editable audio.` };
      const patch = {};
      if (volume !== undefined) {
        const v = Number(volume);
        if (!(v >= 0 && v <= 2)) return { error: 'volume must be between 0 and 2.' };
        Object.assign(patch, { volume: v, muted: v === 0 });
      }
      if (fade_in_sec !== undefined || fade_out_sec !== undefined) {
        if (fade_in_sec !== undefined) patch.fadeIn = clamp(fade_in_sec, 0, 30, 0);
        if (fade_out_sec !== undefined) patch.fadeOut = clamp(fade_out_sec, 0, 30, 0);
      }
      if (!Object.keys(patch).length) return { error: 'Give volume and / or fades.' };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch });
      return after();
    },

    async set_filter({ clip_id, filter_id }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      if (!FILTERS.some((x) => x.id === filter_id)) return { error: `Unknown filter_id "${filter_id}". Use one of: ${ids(FILTERS)}.` };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { filter: filter_id } });
      return after();
    },

    async set_effects({ clip_id, effect_ids }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const bad = (effect_ids || []).find((e) => !EFFECTS.some((x) => x.id === e));
      if (bad) return { error: `Unknown effect "${bad}". Use: ${ids(EFFECTS)}.` };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { effects: effect_ids || [] } });
      return after();
    },

    async add_transition({ clip_id, type, duration_sec = 0.5 }) {
      const f = needVideoClip(clip_id);
      if (f.error) return f;
      if (project().videoClips[0].id === clip_id) return { error: 'The first clip has nothing before it. Pick a later clip.' };
      if (type !== 'none' && !TRANSITIONS.some((x) => x.id === type)) return { error: `Unknown transition "${type}". Use none or one of: ${ids(TRANSITIONS)}.` };
      const transition = type === 'none' ? null : { type, duration: Math.min(2, Math.max(0.2, Number(duration_sec) || 0.5)) };
      const plan = retimeTransition(project(), clip_id, transition);
      if (plan.error) return { error: plan.error };
      dispatch({ type: 'retimeTransition', id: clip_id, transition });
      await ctx.settle();
      if (projectRevision(project()) !== projectRevision(plan.project)) return { error: 'The transition edit did not reach its planned timeline mapping.' };
      return after({ time_map: plan.time_map, note: 'Speech and free-track cues follow the mapped timeline clock; detached audio stays with its picture.' });
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

    async set_transform({ clip_id, fit, focus_x, focus_y, scale, x, y, rotation, opacity }) {
      const f = needPicture(clip_id);
      if (f.error) return f;
      const t = { ...transformOf(f.clip) };
      const keyframes = { ...(f.clip.keyframes || {}) };
      const patch = {};
      if (fit !== undefined || focus_x !== undefined || focus_y !== undefined) {
        const mode = fit ?? 'fill', fx = focus_x === undefined ? 0.5 : focus_x, fy = focus_y === undefined ? 0.5 : focus_y;
        if (!['fill', 'fit'].includes(mode)) return { error: 'fit must be fill or fit.' };
        if (![fx, fy].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) return { error: 'focus_x/y must be source coordinates between 0 and 1.' };
        const m = project().media.find(media => media.id === f.clip.mediaId);
        if (!m?.width || !m?.height) return { error: 'Source dimensions are unavailable for framing.' };
        const framed = framingPatch(f.clip, m, project().width, project().height, mode, fx, fy);
        patch.crop = framed.crop;
        Object.assign(t, framed.transform);
        for (const key of ['scale', 'x', 'y', 'rot']) delete keyframes[key];
      }
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
      const f = needPicture(clip_id, 'add_keyframes');
      if (f.error) return f;
      const prop = PROP[property];
      if (!prop) return { error: 'property must be scale, x, y, rotation or opacity.' };
      const badEase = [easing, ...(keys || []).map((k) => k.easing)].find((e) => e !== undefined && e !== null && !KEY_EASINGS.includes(e));
      if (badEase !== undefined) return { error: `easing must be one of: ${KEY_EASINGS.join(', ')}.` };
      const pairs = (keys || []).map((k) => [Number(k.time_sec) - f.start, Number(k.value), k.easing ?? easing]).filter(([lt, v]) => Number.isFinite(lt) && Number.isFinite(v));
      if (!pairs.length) return { error: 'Give at least one keyframe with time_sec and value.' };
      const outside = pairs.find(([lt]) => lt < -0.01 || lt > f.len + 0.01);
      if (outside) {
        // Times counted from the clip's start instead of the timeline: say how to convert them.
        const fromClipStart = f.start > 0.01 && pairs.every(([lt]) => lt + f.start >= -0.01 && lt + f.start <= f.len + 0.01);
        return { error: `A keyframe at ${r2(outside[0] + f.start)}s is outside the clip (${r2(f.start)}s to ${r2(f.start + f.len)}s). time_sec is timeline time${fromClipStart ? `; these times fit if counted from the clip's start, so add ${r2(f.start)}s to each` : ''}.` };
      }
      const list = putKeys(f.clip.keyframes?.[prop], f.clip, pairs.map(([lt, v, e]) => [Math.min(f.len, Math.max(0, lt)), v, e]));
      const keyframes = { ...(f.clip.keyframes || {}), [prop]: list };
      dispatch({ type: 'update', track: f.track, id: clip_id, patch: { keyframes } });
      return after({ keyframes: list.length, motion: clipMotion(f, { ...f.clip, keyframes }) });
    },

    async set_animation({ clip_id, in: inId, in_duration_sec = 0.5, out: outId, out_duration_sec = 0.5, combo }) {
      const f = needPicture(clip_id, 'set_animation');
      if (f.error) return f;
      const anim = { ...(f.clip.anim || {}) };
      const pick = (kind, id, dur) => {
        if (id === undefined || id === null || id === '') return null;
        if (id === 'none') {
          delete anim[kind];
          return null;
        }
        const type = matchName(id, ANIMATIONS[kind]);
        if (!type) return `Unknown ${kind} animation "${id}". Use one of: ${ids(ANIMATIONS[kind])}.`;
        anim[kind] = kind === 'combo' ? { type } : { type, duration: Math.min(5, Math.max(0.1, Number(dur) || 0.5)) };
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

    async add_media({ media_id, media_name, as = 'main', start_sec = 0, main_index }) {
      const p = project();
      if (!media_id && !String(media_name || '').trim()) return { error: 'Provide media_id or an unambiguous media_name.' };
      const q = String(media_name || '').toLowerCase();
      const exact = p.media.filter(m => m.name.toLowerCase() === q);
      const matches = media_id ? p.media.filter(m => m.id === media_id) : exact.length ? exact : p.media.filter(m => m.name.toLowerCase().includes(q));
      if (matches.length !== 1) return { error: matches.length ? `Media name is ambiguous. Use media_id: ${matches.map(m => `${m.id} (${m.name})`).join(', ')}.` : 'No matching library media. Read get_project scope media for exact IDs.' };
      const m = matches[0];
      if (!['main','overlay','audio'].includes(as) || (as === 'audio' && m.type !== 'audio')) return { error: 'Use main/overlay for pictures, or audio for audio sources.' };
      return place(m, { as, start_sec, main_index, name: m.name });
    },

    async search_sounds({ kind, query }) {
      const lib = { music: 'music', sfx: 'sfxall', meme: 'trolls', memes: 'trolls', troll: 'trolls', trolls: 'trolls' }[String(kind || '').toLowerCase()];
      if (!lib) return { error: 'kind must be "music", "sfx" or "meme".' };
      const res = await api.librarySearch({ requestId: ctx.requestId, kind: lib, q: String(query || ''), category: '', page: 1 });
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
      const res = await api.libraryAdd(item, { requestId: ctx.requestId });
      if (res.error) return { error: res.error };
      const added = await place(addProbed(res), { start_sec, name: item.title });
      if (added.error) return added;
      return shapeAudio(added.clip_id, { duration_sec, volume, fade_in_sec, fade_out_sec }, added);
    },

    async list_voices() {
      const st = await api.ttsStatus();
      const piper = piperVoicesOf(st);
      const out = { default_engine: st.geminiKey ? 'gemini' : piper.length ? 'piper' : st.elevenKey ? 'elevenlabs' : null,
        piper: piper.length ? piper.map((v) => ({ voice_id: v.id, name: v.name, language: v.lang, gender: v.gender })) : PIPER_MISSING(st),
        gemini: st.geminiKey ? { models: st.gemini?.models || [], default_voice: st.gemini?.defaultVoice || 'Kore',
          voices: (st.gemini?.voices || []).map((v) => ({ voice_id: v.id, name: v.name, delivery: v.style })),
          language: 'Detected from the spoken text. Put accent and pacing instructions in style.' }
          : 'Add a Gemini TTS key in Settings > Speech generation.' };
      if (st.elevenKey) {
        const ev = await api.ttsElevenVoices({ requestId: ctx.requestId });
        out.elevenlabs = ev.error ? { error: ev.error } : (ev.voices || []).slice(0, 30).map((v) => ({ voice_id: v.id, name: v.name, ...(v.labels ? { labels: v.labels } : {}) }));
      } else out.elevenlabs = 'No ElevenLabs key saved.';
      return out;
    },

    async add_voiceover({ text, voice_id, engine, model, style, start_sec = 0, speed = 1, volume = 1 }) {
      if (!String(text || '').trim()) return { error: 'text is empty.' };
      const st = await api.ttsStatus();
      const piper = piperVoicesOf(st);
      const chosen = engine || (st.geminiKey ? 'gemini' : piper.length ? 'piper' : st.elevenKey ? 'elevenlabs' : null);
      if (!chosen) return { error: `No speech engine is set up. ${PIPER_MISSING(st)} Or add a Gemini or ElevenLabs key in Settings.` };
      const normalized = chosen === 'elevenlabs' ? 'eleven' : chosen;
      if (!['gemini', 'eleven', 'piper'].includes(normalized)) return { error: 'engine must be gemini, piper or elevenlabs.' };
      if (normalized === 'piper' && !piper.length) return { error: PIPER_MISSING(st) };
      if (normalized === 'piper' && voice_id && !piper.some((v) => v.id === voice_id)) return { error: `The Piper voice ${voice_id} is not downloaded. Downloaded: ${piper.map((v) => v.id).join(', ')}. Ask the user to download others in Settings > Voice.` };
      const voiceId = voice_id || (normalized === 'gemini' ? 'Kore' : normalized === 'piper' ? piper[0].id : undefined);
      const res = await api.ttsSpeak({ ...(ctx.requestId ? { requestId: ctx.requestId } : {}), engine: normalized, voiceId, voiceName: voiceId, text: String(text), speed: Number(speed) || 1, model, style });
      if (res.error) return speechFailure(res, model);
      const added = await place(addProbed({ ...res, origin: 'tts' }), { start_sec, name: res.name });
      if (added.error) return added;
      return shapeAudio(added.clip_id, { volume }, { ...added, ...speechWaitNote(res) });
    },

    async add_narration({ lines, voice_id, model, style, start_sec = 0, gap_sec = 0.3, volume = 1 } = {}) {
      if (!api.ttsSpeakLines) return { error: 'add_narration requires an updated ClipCraft; use add_voiceover per line.' };
      const list = (Array.isArray(lines) ? lines : []).map((l) => (typeof l === 'string' ? { text: l } : l || {}));
      if (list.length < 2) return { error: 'Give at least two lines; use add_voiceover for one.' };
      if (list.some((l) => !String(l.text || '').trim())) return { error: 'Every line needs text.' };
      const st = await api.ttsStatus();
      if (!st.geminiKey) return { error: 'add_narration uses Gemini TTS, which has no key in Settings > Speech generation. Use add_voiceover per line with piper or elevenlabs.' };
      const res = await api.ttsSpeakLines({ ...(ctx.requestId ? { requestId: ctx.requestId } : {}), lines: list.map((l) => String(l.text).trim()), voiceId: voice_id, model, style });
      if (res.error) return speechFailure(res, model);
      const gap = clamp(gap_sec, 0, 10, 0.3), clips = [];
      let at = Math.max(0, Number(start_sec) || 0);
      for (let i = 0; i < res.items.length; i++) {
        const want = Number(list[i].start_sec);
        if (Number.isFinite(want) && want >= 0) at = want;
        const added = await place(addProbed(res.items[i]), { start_sec: at, name: res.items[i].name });
        if (added.error) return { ...added, placed_clip_ids: clips.map((c) => c.clip_id) };
        dispatch({ type: 'update', track: 'audio', id: added.clip_id, patch: { volume: clamp(volume, 0, 2, 1) } });
        const len = res.items[i].duration || 0;
        clips.push({ clip_id: added.clip_id, start_sec: r2(at), length_sec: r2(len), text: String(list[i].text).slice(0, 40) });
        at += len + gap;
      }
      await ctx.settle();
      return after({ clips, requests: res.requests, ...(res.mode === 'per_line' ? { note: 'The voice ran lines together, so each line was spoken on its own request.' } : {}), ...speechWaitNote(res) });
    },

    async generate_image(args) {
      if (!api.agentGenerateImage) return { error: 'Image generation requires an updated ClipCraft with Codex SDK selected.' };
      const scene = prepareImageScene(args);
      if (scene.error) return scene;
      const batchId = uid();
      const off = api.onAgentImageProgress?.(progress => {
        if (progress.requestId === ctx.requestId && progress.batchId === batchId) ctx.onImageProgress?.(progress);
      });
      try {
        const res = await api.agentGenerateImage({ requestId: ctx.requestId, batchId, ...scene.request });
        return await insertImageScene(scene, res);
      } finally { off?.(); }
    },

    async search_stock({ kind = 'video', query }) {
      const k = String(kind).toLowerCase().startsWith('p') ? 'photo' : 'video';
      const res = await api.stockSearch({ requestId: ctx.requestId, kind: k, q: String(query || '') });
      if (res.error) return { error: res.error };
      const items = (res.results || []).slice(0, 10).map((it) => ({
        stock_id: keep(k === 'video' ? 'v' : 'p', it), tags: it.tags, ...(it.duration ? { duration_sec: it.duration } : {}), size: `${it.width}x${it.height}`,
      }));
      return items.length ? { items } : { items, note: 'Nothing found; try other English words.' };
    },

    async add_stock({ stock_id, as = 'overlay', start_sec = 0, duration_sec, main_index }) {
      const item = found.get(stock_id);
      if (!item || !/^[vp]/.test(String(stock_id))) return { error: `Unknown stock_id "${stock_id}". Use an id from search_stock.` };
      const res = await api.stockAdd(item, { requestId: ctx.requestId });
      if (res.error) return { error: res.error };
      const added = await place(addProbed(res), { as, start_sec, main_index, name: res.name });
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
      const end = start + (f.track === 'video' || f.track === 'overlay' || f.track === 'audio' ? clipLen(c) : c.duration);
      const ns = start_sec === undefined ? start : Number(start_sec);
      const ne = end_sec === undefined ? end : Number(end_sec);
      if (!Number.isFinite(ns) || !Number.isFinite(ne) || ns < 0 || ne - ns < 0.1) return { error: 'The new end must be at least 0.1 s after the new start.' };
      let patch;
      if (f.track === 'text' || f.track === 'effect') patch = { start: Math.max(0, ns), duration: ne - Math.max(0, ns),
        ...(f.track === 'text' ? cropWordTiming(c, ns - start, ne - start) : {}) };
      else {
        // Media: move the source in / out points (speed-scaled for picture clips).
        const sp = c.speed || 1;
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

    async clip_tools({ clip_id, action, start_sec = 0, main_index, layer, partner_clip_id, time_sec, duration_sec }) {
      if (['reverse', 'freeze', 'set_layer', 'link', 'unlink'].includes(action)) return extended.clipOperation({ clip_id, action, layer, partner_clip_id, time_sec, duration_sec });
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

    async add_scene({ color, color2, direction = 'diagonal', duration_sec = 3, main_index }) {
      if (!HEX.test(String(color)) || (color2 !== undefined && !HEX.test(String(color2)))) return { error: 'color and color2 must be #rrggbb.' };
      if (!['horizontal', 'vertical', 'diagonal'].includes(direction)) return { error: 'direction must be horizontal, vertical or diagonal.' };
      if (!api.makeScene) return { error: 'Scenes are not available here.' };
      const p = project();
      const res = await api.makeScene({ color, color2, direction, width: p.width, height: p.height });
      if (res.error) return { error: res.error };
      const added = await place(addProbed(res), { main_index, name: res.name });
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

    async export_video(args = {}) {
      if (ctx.isCanceled?.() || ctx.editActive?.() === false) return { error: 'Export stopped because this request no longer owns the edit.' };
      if (!ctx.startExport) return { error: 'Export is not available here.' };
      if (!(exportDuration(project()) > 0)) return { error: 'The timeline is empty.' };
      const before = projectRevision(project());
      const result = await ctx.startExport(args, { requestId: ctx.requestId, revision: before, isCanceled: () => ctx.isCanceled?.() || ctx.editActive?.() === false || projectRevision(project()) !== before, onProgress:ctx.onToolProgress });
      if (result?.canceled) return { error: 'Export canceled.', canceled: true };
      if (!result?.ok || !result.file || !result.size || !result.metadata) return { error: result?.error || 'Export did not return a verified output file.' };
      if (ctx.isCanceled?.() || ctx.editActive?.() === false) return { error: 'The file was saved, but this request stopped before delivery. The completed output was kept.', completed: true, file: result.file, size: result.size, metadata: result.metadata, revision: before };
      let inspection;
      if (api.agentReviewRendered) {
        ctx.onToolProgress?.({progress:1,phase:'verify',stage:'Checking the exported video',remainingSeconds:null});
        try {
          inspection = await api.agentReviewRendered({ requestId: ctx.requestId, file: result.file, revision: before });
          if (inspection?.error || !inspection?.video || !inspection?.frames?.length) throw Error(inspection?.error || 'No decoded output evidence was returned.');
        } catch (error) { return { ...result, ok: false, completed: true, error: `The file was saved, but local output inspection did not complete: ${error.message}`, ...(ctx.isCanceled?.() ? { canceled: true } : {}), revision: before }; }
      }
      const { frames, ...output_review } = inspection || {};
      return { ...result, ...(inspection ? { frames, output_review } : { warning: 'Output metadata was verified; local decoded review is unavailable in this host.' }), artifact: { type: 'video', path: result.file, bytes: result.size, mime_type: 'video/mp4', ...result.metadata }, revision: before, ...(projectRevision(project()) !== before ? { warning: 'This file represents the earlier project revision; the live edit changed during export.' } : {}) };
    },
  };

  const readCache = new Map();
  const cachedTools = new Set(['list_options', 'motion_guide', 'edit_guide']);
  return {
    runImages,
    async run(name, args) {
      const fn = Object.hasOwn(tools, name) ? tools[name] : null;
      if (!fn) return { error: `Unknown tool "${name}".` };
      const before = project(), revision = projectRevision(before);
      const edits = !NON_MUTATING.has(name);
      const active = { revision, actions: [], wrote: false, validation: new WeakMap() };
      operation = edits ? active : null;
      let result;
      try {
        const key = cachedTools.has(name) ? JSON.stringify([name, args || {}, revision]) : null;
        if (key && readCache.has(key)) return structuredClone(readCache.get(key));
        result = await fn(args || {});
        if (key && !result.error) {
          if (readCache.size >= 32) readCache.delete(readCache.keys().next().value);
          readCache.set(key, structuredClone(result));
        }
      } catch (e) { result = { error: e.message || String(e) }; }
      finally { operation = null; }
      // Nothing to analyse (no audible clip: an empty, silent or fully muted timeline) is an answer,
      // not a failed operation: the completion gate must not wait for a retry that cannot succeed.
      if (result?.error && NOTHING_AUDIBLE.test(result.error)) result.not_applicable = true;
      if (!edits) return result;
      if (name === 'undo' && !result.error) active.wrote = true;
      await ctx.settle();
      const now = project(), nextRevision = projectRevision(now), changed = active.wrote && revision !== nextRevision;
      if (!result.error) {
        const errors = verifyActionResults(now, active.actions, before);
        if (errors.length) result = { ...result, error: errors.join(' ') };
      }
      const validation = changed ? active.validation.get(now) || validateAgentProject(now) : null;
      const existing = new Set((active.validation.get(before) || validateAgentProject(before)).issues);
      const issues = validation?.issues.filter(issue => !existing.has(issue)) || [];
      if (issues.length) result = { ...result, error: `Edit validation failed: ${issues.join(' ')}` };
      return { ...result, ok: !result.error, changed, status: result.error ? 'blocked' : changed ? 'applied' : 'unchanged', before_revision: revision, revision: nextRevision,
        ...(validation ? { validation } : {}) };
    },
    // True for tools that change the project (used to decide whether there is anything to undo).
    mutates: name => !NON_MUTATING.has(name),
    requiresSuccess: name => !NON_MUTATING.has(name) || REQUIRED_PROOF.has(name),
  };
}
