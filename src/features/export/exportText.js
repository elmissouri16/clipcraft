// Renders the text layer for the export (same renderer as the preview). FFmpeg packs the frames into a lossless
// file while the next ones are drawn (electron/export/textstream.cjs). Only what changed since the previous frame is sent:
// the rectangle around the changed pixels, or a count for runs of transparent or unchanged frames.
import { drawTextLayer } from "../text/render.js";
import { createTextFrameState } from '../text/frameState.js';
import { fontsReady, getFontRevision } from "../text/fonts.js";
import { exportDuration } from "../../state/store.js";
import { overlayRanges } from "../effects/apply.js";
import { drawFxOverlays } from "../preview/components/Preview.jsx";
import { changedRect, cutRect } from "../preview/frameDiff.js";
const cacheEpoch = Date.now();

// Returns the number of frames written (0 when the project has no text), or -1 when canceled.
// onProgress(0..1); isCanceled() is polled between frames.
export async function renderTextFrames(project, frameDir, onProgress, isCanceled) {
  const fxClips = overlayRanges(project);
  if (!project.textClips.length && !fxClips.length) return 0;
  await fontsReady();
  const { width: W, height: H, fps } = project.renderSize || project;
  const count = Math.ceil(exportDuration(project) * fps);
  const cacheKey = JSON.stringify({epoch:cacheEpoch,fonts:getFontRevision(),width:project.width,height:project.height,
    text:project.textClips,video:project.videoClips,overlays:project.overlayClips,effects:project.effectClips,
    media:project.media.map(({id,width,height})=>({id,width,height}))});
  const cached = await window.api.exportTextCached?.(frameDir,W,H,fps,count,cacheKey);
  if (isCanceled()) return -1;
  if(cached) { onProgress(1,{cached:true});return count; }
  // A bounded number of changed surfaces benefits from timestamped holds.
  // Dense animation stays on the raw-frame path, avoiding PNG-per-frame work.
  const predict = createTextFrameState(project, fxClips), limit = Math.min(128, Math.floor(count * .2));
  let sparse = true, changes = 0, lastKey = null;
  for (let i = 0; i < count; i++) {
    if (i % 2048 === 0) { await new Promise(resolve => setTimeout(resolve, 0));if (isCanceled()) return -1; }
    const key = predict(i / fps).key;
    if (key !== lastKey) { changes++;lastKey = key;if (changes > limit) { sparse = false;break; } }
  }
  const canvas = new OffscreenCanvas(W, H);
  // The pixels are read back every frame: keep the canvas in memory rather than on the GPU.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await window.api.exportTextBegin(frameDir, W, H, fps, { sparse, cacheKey, count });
  const clear = new Uint32Array(W * H);
  let prev = clear; // the last frame FFmpeg got (transparent at first and after transparent frames)
  let run = null; // { blank: n } or { same: n } not sent yet
  const stateAt = createTextFrameState(project, fxClips);
  let previousState = null;
  const send = async (frame) => {
    if (run) await window.api.exportTextFrame(frameDir, run);
    run = null;
    if (frame) await window.api.exportTextFrame(frameDir, frame);
  };
  for (let i = 0; i < count; i++) {
    // Cached/blank spans have no IPC awaits. Yield periodically so Cancel and
    // paint events can run even on very long, mostly unchanged timelines.
    if (i % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    if (isCanceled()) return -1;
    const t = i / fps;
    const state = stateAt(t);
    if (state.blank) {
      if (run?.blank) run.blank++;
      else { await send(); run = { blank: 1 }; }
      prev = clear;
      previousState = null;
      continue;
    }
    if (state.key === previousState) {
      if (run?.same) run.same++;
      else if (run?.blank) run.blank++;
      else { await send(); run = { same: 1 }; }
      continue;
    }
    previousState = state.key;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(W / project.width, 0, 0, H / project.height, 0, 0);
    drawFxOverlays(ctx, project, t, project.width, project.height);
    drawTextLayer(ctx, { ...project, textClips: state.clips }, t, project.width, project.height);
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
  if (isCanceled()) return -1;
  onProgress(1);
  return written;
}
