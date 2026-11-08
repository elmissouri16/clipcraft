// Motion graphics for CraftAI: the agent writes a graphic component (any chart, button, callout,
// lower third, diagram…) and add_graphic renders it in the locked-down sandbox
// (electron/graphics/) into a transparent video placed as an overlay clip. The overlay keeps the
// graphic's code and inputs, so edit_graphic can change data or design and render again; placement,
// keyframes, fades and pinning work as on any overlay. The render returns sample frames, so the
// agent sees what it drew. Plan: docs/design/motion-graphics.md.
import { clipLen, uid } from '../../state/store.js';
import { projectRevision } from './context.js';
import { graphicsGuide, GRAPHICS_TOPICS } from './graphicsGuide.js';
import { bundledGraphicFamilies } from '../graphics/graphicFonts.js';
import { renderGraphicMedia, swapGraphicActions } from '../graphics/graphicMedia.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' };
const FONTS = { type: 'ARRAY', items: S, description: 'Bundled font families the graphic uses, e.g. ["Montserrat 800", "Inter"] (weight optional)' };
export const GRAPHICS_DECLARATIONS = [
  { name: 'graphics_guide', description: `How to write motion graphics (custom charts, buttons, callouts, lower thirds, diagrams, anything drawable): component format, toolkit, design rules, reference examples. Read toolkit first. topic: ${GRAPHICS_TOPICS.join(', ')}.`,
    parameters: { type: 'OBJECT', properties: { topic: S }, required: ['topic'] } },
  { name: 'add_graphic', description: 'Render a motion graphic you wrote (JavaScript component returning SVG per frame; see graphics_guide) and place it as a transparent overlay over the whole frame. Returns sample frames of the result: check them, and fix the code if anything is off. Errors name the component line.',
    parameters: { type: 'OBJECT', properties: { code: S, inputs: { type: 'OBJECT', description: 'Values for the component inputs (data, text, colours)' }, fonts: FONTS,
      start_sec: N, duration_sec: N, name: S }, required: ['code', 'duration_sec'] } },
  { name: 'edit_graphic', description: 'Change a graphic added with add_graphic and render it again in place: new inputs (merged unless replace_inputs), new code, fonts or duration. The clip keeps its position, keyframes and effects.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, inputs: { type: 'OBJECT' }, replace_inputs: { type: 'BOOLEAN' }, code: S, fonts: FONTS, duration_sec: N }, required: ['clip_id'] } },
];

const r3 = (n) => Math.round(n * 1000) / 1000;
// What the render measured, as advice the agent acts on: text too small for a phone, the picture
// standing still for long, a graphic far longer than most land.
export function designWarnings({ stats = {}, width, fps, duration_sec }) {
  const warnings = [], minText = Math.round(width * 0.03);
  if (stats.min_font_px && stats.min_font_px < minText) warnings.push(`Text as small as ${r3(stats.min_font_px)} px is hard to read on a phone; use at least ${minText} px (labels about ${Math.round(width * 0.04)} px).`);
  const still = (stats.longest_still_frames || 0) / fps;
  if (still > 2.5) warnings.push(`The picture stands still for ${r3(still)} s (from ${r3((stats.longest_still_from || 0) / fps)} s): keep something moving (highlight, slow push, next item) or shorten the graphic.`);
  if (duration_sec > 15) warnings.push(`${r3(duration_sec)} s is long for one graphic; most land in 4–12 s. Show fewer items or split it.`);
  return warnings;
}

export function createGraphicsTools({ project, dispatch, after, api, requestId, isCanceled, settle }) {
  // Render through the agent job (sample frames for the model); returns { media, result } or { error }.
  const render = async (args) => {
    const out = await renderGraphicMedia({ api, project: project(), ...args, agent: { requestId, revision: projectRevision(project()) } });
    return isCanceled?.() && !out.error ? { error: 'Graphic render stopped.', canceled: true } : out;
  };
  // Sample frames as one contact sheet for the model.
  const evidence = async (result) => {
    const frames = result.frames || [];
    if (frames.length < 2 || !api.agentFrameSheet) return { frames };
    const sheet = await api.agentFrameSheet({ frame_ids: frames.map((f) => f.id), revision: projectRevision(project()) });
    return sheet && !sheet.error ? { frames, sheet_id: sheet.id } : { frames, sheet_error: sheet?.error || 'No contact sheet.' };
  };
  const design = (result) => { const w = designWarnings(result); return w.length ? { design_warnings: w } : {}; };
  const report = async (out, extra) => after({ ...extra, media_id: out.media.id, duration_sec_graphic: r3(out.result.duration_sec), cached: out.result.cached,
    render_ms: out.result.stats?.total_ms, ...design(out.result),
    ...(await evidence(out.result)),
    note: 'The attached frames show the graphic over grey (grey = transparent). Check sizes, overlaps, cut-off text and timing; fix design_warnings and anything else off with edit_graphic. Position/scale/fade it like any overlay.' });

  return {
    async graphics_guide({ topic } = {}) {
      const guide = graphicsGuide(topic), fonts = bundledGraphicFamilies();
      return topic === 'toolkit' && fonts.length ? { ...guide, fonts_available: fonts } : guide;
    },

    async add_graphic({ code, inputs, fonts, start_sec = 0, duration_sec, name } = {}) {
      const start = Math.max(0, Number(start_sec) || 0);
      const out = await render({ code, inputs: inputs ?? {}, fonts: fonts ?? [], duration_sec, start_sec: start, name: name || 'Graphic' });
      if (out.error) return out;
      // One step: the graphic in the library, over the whole frame at start, the main track covering it.
      const clipId = uid();
      dispatch({ type: 'batch', actions: [{ type: 'addMedia', items: [out.media] }, { type: 'addOverlayClip', mediaId: out.media.id, clipId, at: start },
        { type: 'extendVideoTo', end: start + out.result.duration_sec, gapId: uid() }] });
      await settle?.();
      if (!(project().overlayClips || []).some((c) => c.id === clipId)) return { error: 'Could not put the graphic on the timeline (is the overlay layer locked?).' };
      return report(out, { clip_id: clipId, start_sec: start });
    },

    async edit_graphic({ clip_id, inputs, replace_inputs = false, code, fonts, duration_sec } = {}) {
      const p = project(), found = [['overlay', p.overlayClips || []], ['video', p.videoClips]].map(([track, list]) => [track, list.find((c) => c.id === clip_id)]).find(([, c]) => c);
      const [track, clip] = found || [];
      const old = clip && p.media.find((m) => m.id === clip.mediaId);
      if (!clip || !old?.graphic) return { error: `Clip "${clip_id}" is not a graphic added with add_graphic. Call get_project to see the real ids.` };
      const g = old.graphic;
      const out = await render({ code: code ?? g.code, inputs: replace_inputs ? inputs || {} : { ...g.inputs, ...(inputs || {}) }, fonts: fonts ?? g.fonts,
        duration_sec: duration_sec ?? clipLen(clip), start_sec: clip.start || 0, name: old.name });
      if (out.error) return out;
      dispatch(swapGraphicActions(project(), track, clip, out.media));
      await settle?.();
      return report(out, { clip_id: clip.id, start_sec: clip.start || 0 });
    },
  };
}
