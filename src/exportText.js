// Renders the text layer for the export (same renderer as the preview). FFmpeg packs the frames into a lossless
// file while the next ones are drawn (electron/textstream.cjs). Only what changed since the previous frame is sent:
// the rectangle around the changed pixels, or a count for runs of transparent or unchanged frames.
import { drawTextLayer, textVisible } from './text/render.js';
import { fontsReady } from './fonts.js';
import { exportDuration } from './store.js';
import { overlayRanges } from './fx/apply.js';
import { drawFxOverlays } from './components/Preview.jsx';
import { changedRect, cutRect } from './frameDiff.js';

// Returns the number of frames written (0 when the project has no text), or -1 when canceled.
// onProgress(0..1); isCanceled() is polled between frames.
export async function renderTextFrames(project, frameDir, onProgress, isCanceled) {
  const fxClips = overlayRanges(project);
  if (!project.textClips.length && !fxClips.length) return 0;
  await fontsReady();
  const { width: W, height: H, fps } = project;
  const count = Math.ceil(exportDuration(project) * fps);
  const canvas = new OffscreenCanvas(W, H);
  // The pixels are read back every frame: keep the canvas in memory rather than on the GPU.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await window.api.exportTextBegin(frameDir, W, H, fps);
  const clear = new Uint32Array(W * H);
  let prev = clear; // the last frame FFmpeg got (transparent at first and after transparent frames)
  let run = null; // { blank: n } or { same: n } not sent yet
  const send = async (frame) => {
    if (run) await window.api.exportTextFrame(frameDir, run);
    run = null;
    if (frame) await window.api.exportTextFrame(frameDir, frame);
  };
  for (let i = 0; i < count; i++) {
    if (isCanceled()) return -1;
    const t = i / fps;
    if (!project.textClips.some((c) => textVisible(c, t)) && !fxClips.some(([a, b]) => t >= a && t < b)) {
      if (run?.blank) run.blank++;
      else { await send(); run = { blank: 1 }; }
      prev = clear;
      continue;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawFxOverlays(ctx, project, t, W, H);
    drawTextLayer(ctx, project.textClips, t, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const cur = new Uint32Array(px.buffer, px.byteOffset, W * H);
    const r = changedRect(prev, cur, W, H);
    if (!r) {
      if (run?.same) run.same++;
      else if (run?.blank) run.blank++; // still transparent
      else { await send(); run = { same: 1 }; }
    } else {
      await send({ ...r, data: cutRect(px, W, r) });
      prev = cur;
    }
    if (i % 5 === 0) onProgress(i / count);
  }
  await send();
  const written = await window.api.exportTextEnd(frameDir);
  onProgress(1);
  return written;
}
