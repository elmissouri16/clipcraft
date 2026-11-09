// The player asks a persistent sandbox for only the newest visible frame. No component code runs
// here. The normal overlay layer still owns placement, compositing, effects and z-order.
import { useCallback, useEffect, useRef } from 'react';
import { resolveGraphicFonts } from './graphicFonts.js';
import { graphicEdits } from './graphicEdits.js';

export default function LiveGraphicFrame({ project, clip, media, time, clockRef, imageRef, redraw }) {
  const latest = useRef();
  latest.current = { project, clip, time, clockRef, redraw };
  const img = useRef(null);
  const attach = useCallback(node => { img.current = node; imageRef(node); }, [imageRef]);
  useEffect(() => {
    let stopped = false, raf, side = 960, lastKey = '', slow = 0, failedInputs;
    const owner = `live-${clip.id}-${crypto.randomUUID()}`, api = window.api;
    const finish = () => { stopped = true; cancelAnimationFrame(raf); api.closeLiveGraphic?.(owner); };
    const paint = async () => {
      if (stopped) return;
      const { project: p, clip: c, time: paused, clockRef: clock } = latest.current;
      const at = clock?.current?.time ?? paused, fps = p.fps || 30;
      const frames = Math.max(1, Math.round(c.out * fps));
      const frame = Math.min(frames - 1, Math.max(0, Math.floor(((c.in || 0) + (at - c.start) * (c.speed || 1)) * fps)));
      const inputsKey = JSON.stringify(c.graphicDraft.inputs), key = `${frame}:${frames}:${inputsKey}`;
      if (at >= c.start && at < c.start + (c.out - c.in) / (c.speed || 1) && key !== lastKey && inputsKey !== failedInputs) {
        const started = performance.now(), draft = c.graphicDraft;
        const out = await api.drawLiveGraphic({ owner, frame, frames, inputs: draft.inputs, side });
        if (stopped) return;
        if (out.error) { graphicEdits.previewError(c.id, out.error); failedInputs = inputsKey; raf = requestAnimationFrame(tick); return; }
        // Do not display a stale control value that finished after a newer edit.
        if (latest.current.clip.graphicDraft === draft && img.current) {
          lastKey = key;
          img.current.dataset.session = out.session;
          img.current.dataset.frame = frame;
          img.current.dataset.renderMs = out.render_ms;
          img.current.dataset.latencyMs = performance.now() - started;
          img.current.src = out.image;
          graphicEdits.previewError(c.id, null);
        }
        const latency = performance.now() - started;
        slow = latency > 50 ? slow + 1 : Math.max(0, slow - 1);
        if (slow >= 3) { side = Math.max(320, Math.round(side * .75)); slow = 0; }
      }
      if (!stopped) raf = requestAnimationFrame(tick);
    };
    const tick = () => paint().catch(error => { if (!stopped) graphicEdits.previewError(clip.id, error.message); });
    (async () => {
      try {
        if (!api.openLiveGraphic) throw Error('Restart ClipCraft to enable live graphics.');
        const fonts = await resolveGraphicFonts(media.graphic.fonts || []);
        if (stopped) return;
        if (fonts.missing.length) throw Error(`Fonts not bundled: ${fonts.missing.join(', ')}.`);
        const out = await api.openLiveGraphic({ owner, code: media.graphic.code, fonts: fonts.fonts, width: project.width, height: project.height,
          fps: project.fps || 30, duration_sec: clip.out, inputs: {} });
        if (stopped) { api.closeLiveGraphic(owner); return; }
        if (out.error) throw Error(out.error);
        raf = requestAnimationFrame(tick);
      } catch (error) { if (!stopped) graphicEdits.previewError(clip.id, error.message); }
    })();
    return finish;
  }, [clip.id, media.id, project.width, project.height, project.fps]);
  return <img ref={attach} alt="" data-live-graphic={clip.id} style={{ display: 'none' }}
    onLoad={() => { if (img.current) img.current.dataset.ready = 'true'; latest.current.redraw(); }} />;
}
