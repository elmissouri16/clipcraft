// Motion graphics as project media, shared by CraftAI's graphics tools, the inspector's Graphic tab
// and the automatic re-render. A graphic is transparent video (electron/graphics/) that keeps the
// code, inputs, fonts and input schema it was drawn from, so it can be drawn again with new data,
// a new length or a new canvas size. Swapping in a new render is one batch action: one Undo step.
import { uid } from '../../state/store.js';
import { bundledGraphicFamilies, resolveGraphicFonts } from './graphicFonts.js';

export const isGraphicMedia = (m) => !!m?.graphic;

// The media item for a render result.
export function graphicMediaItem(result, { id = uid(), name = 'Graphic', code, inputs = {}, fonts = [] }) {
  return { ...result.media, id, type: 'video', name: String(name).slice(0, 120), path: result.file, duration: result.duration_sec, fps: result.fps,
    width: result.width, height: result.height, hasAudio: false,
    // The transparent VP9 copy at every playback quality: generated H.264 copies would lose the alpha.
    proxy: result.preview, proxies: { high: result.preview, medium: result.preview, low: result.preview },
    graphic: { code, inputs, fonts, key: result.key, ...(result.schema ? { schema: result.schema } : {}) } };
}

// Render a graphic at the project's size and frame rate. agent: { requestId, revision } renders
// through the agent job (sample frames registered for the model); otherwise the editor's render.
// Resolves { media, result } or { error }.
// requestId (editor renders): renders with the same id replace each other ('editor', 'auto-<media>').
export async function renderGraphicMedia({ api, project, code, inputs = {}, fonts = [], duration_sec, start_sec = 0, name, agent = null, requestId = 'editor' }) {
  if (!(agent ? api?.agentRenderGraphic : api?.renderGraphic)) return { error: 'Motion graphics require an updated ClipCraft.' };
  if (typeof code !== 'string' || !code.trim()) return { error: 'code must be the graphic component (see graphics_guide toolkit).' };
  if (!(Number.isFinite(duration_sec) && duration_sec >= 0.2 && duration_sec <= 60)) return { error: 'duration_sec must be from 0.2 to 60.' };
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) return { error: 'inputs must be an object.' };
  const resolved = await resolveGraphicFonts(fonts);
  // A family that is not bundled would fall back to the SVG default (a serif): refuse it up front.
  if (resolved.missing.length) {
    const available = bundledGraphicFamilies();
    return { error: `Fonts not bundled: ${resolved.missing.join(', ')}. Use bundled families${available.length ? `: ${available.join(', ')}` : ' (list_options fonts)'}.` };
  }
  const req = { code, inputs, fonts: resolved.fonts, width: project.width, height: project.height, fps: project.fps || 30, duration_sec, start_sec };
  const result = agent ? await api.agentRenderGraphic({ ...req, requestId: agent.requestId, revision: agent.revision }) : await api.renderGraphic({ ...req, requestId });
  if (result?.canceled) return { error: 'Graphic render stopped.', canceled: true };
  if (!result?.ok) return { error: result?.error || 'The graphic did not render.' };
  return { media: graphicMediaItem(result, { name, code, inputs, fonts }), result };
}

// The clip shows the new render; the old render leaves the library when no other clip uses it; an
// empty or shorter main track is padded to cover it. As one batch: one Undo step.
export function swapGraphicActions(project, track, clip, media) {
  const actions = [{ type: 'addMedia', items: [media] }, { type: 'update', track, id: clip.id, patch: { mediaId: media.id, in: 0, out: media.duration, graphicDraft: undefined } }];
  const others = [...project.videoClips, ...(project.overlayClips || [])].some((c) => c.id !== clip.id && c.mediaId === clip.mediaId);
  if (!others && clip.mediaId !== media.id) actions.push({ type: 'removeMedia', id: clip.mediaId });
  if (track === 'overlay') actions.push({ type: 'extendVideoTo', end: clip.start + media.duration, gapId: uid() });
  return { type: 'batch', actions };
}

// A graphic needs drawing again when the canvas size or frame rate changed since it was rendered.
export const graphicOutdated = (m, project) => isGraphicMedia(m) && (m.width !== project.width || m.height !== project.height || Math.abs((m.fps || 0) - (project.fps || 30)) > 1e-6);

// The same graphic drawn again (new canvas size or frame rate, or lost files): every clip that showed
// the old render shows the new one, keeping its timing; the old render leaves the library.
export function redrawGraphicAction(project, old, media) {
  const actions = [{ type: 'addMedia', items: [{ ...media, name: old.name }] }];
  for (const [track, list] of [['video', project.videoClips], ['overlay', project.overlayClips || []]]) {
    for (const c of list) if (c.mediaId === old.id) actions.push({ type: 'update', track, id: c.id, patch: { mediaId: media.id } });
  }
  actions.push({ type: 'removeMedia', id: old.id });
  return { type: 'batch', actions };
}
