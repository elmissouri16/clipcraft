import {assertPluginEffects} from '../plugins/effectRegistry.js';
// The animated-effects pass of the export: every frame that needs an animated effect or transition is decoded by
// FFmpeg (electron/export/fxjobs.cjs), drawn here with the preview's WebGL shaders, and stored for the final export.
import { videoLayout } from "../../state/store.js";
import { fxTransition } from "../effects/catalog.js";
import { pixelEffectRanges, isShaderFx, pixelPasses } from "../effects/apply.js";
import { fxGL } from "../effects/gl.js";
import { easeValue } from "../effects/easing.js";
import { bakeColorLut } from "./colorLut.js";
import { fxRead, fxWrite } from "./fxChannel.js";

const fxTr = (c) => c.transition && fxTransition(c.transition.type,c.transition);
const cacheEpoch = Date.now(); // invalidate session renders after renderer code reloads
const lutDigests = new WeakMap();
const passSignature = async passes => Promise.all(passes.map(async pass => {
  if (!pass.lut) return pass;
  let digest = lutDigests.get(pass.lut);
  if (!digest) {
    digest = crypto.subtle.digest('SHA-256', pass.lut.data).then(bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join(''));
    lutDigests.set(pass.lut, digest);
  }
  return { lut: await digest, size: pass.lut.size, K: pass.K };
}));
const activeEffects = (project, from, to) => (project.effectClips || []).filter(e => e.start < to && e.start + e.duration > from);
const unwrap = (r) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

// Picture clips to send through the effects pass: [{ track, clip, start, len }].
function fxClipsOf(project) {
  const out = [], fps = project.renderSize?.fps || project.fps;
  for (const l of videoLayout(project.videoClips)) {
    if (!l.clip.gap) for (const [from, to] of pixelEffectRanges(project, l.clip, l.start, l.end - l.start, fps)) out.push({ track: 'video', clip: l.clip, start: l.start, len: to - from, from, to });
  }
  for (const c of project.overlayClips || []) {
    const len = (c.out - c.in) / (c.speed || 1);
    for (const [from, to] of pixelEffectRanges(project, c, c.start, len, fps)) out.push({ track: 'overlay', clip: c, start: c.start, len: to - from, from, to });
  }
  return out;
}

// What the last effects pass did (clips baked into a LUT, clips shaded frame by frame, transitions).
export let lastFxStats = null;

// Returns the frames to render, so the export can show progress (0 when the project has no animated effect).
export function fxWork(project) {
  const fps = project.renderSize?.fps || project.fps;
  let frames = fxClipsOf(project).reduce((n, j) => n + Math.max(1,Math.round(j.len * fps)), 0);
  for (const l of videoLayout(project.videoClips)) if (l.trans > 0 && fxTr(l.clip)) frames += Math.max(1,Math.round(l.trans * fps));
  return frames;
}

// Returns the project to export: clips with animated effects point at their rendered files, animated transitions
// at their rendered segments. Returns null when canceled.
export async function renderFxPass(projectIn, onProgress, isCanceled) {
  assertPluginEffects(projectIn);
  const total = fxWork(projectIn);
  if (!total) return projectIn;
  const gl = fxGL();
  let done = 0;
  const stats = lastFxStats = { lutClips: 0, shaderClips: 0, transitions: 0 };
  let project = { ...projectIn, fxSegments: {} };
  const step = () => { done++; if (done % 4 === 0) onProgress(Math.min(1, done / total)); };

  // 1) Picture clips under animated effects (their own, or effects on the Effects track), main track and overlays.
  // Bounded batches amortize IPC while the next decode overlaps GPU work and
  // encoder backpressure. Cancellation still checks every frame; writes stay ordered.
  const pump = async (job, draw, streams = 1) => {
    if (isCanceled()) return false;
    if (job.cached) { done += job.frames;onProgress(Math.min(1, done / total),{cached:true});return true; }
    const batch = Math.max(1, Math.min(4, Math.floor(16 * 1024 * 1024 / (job.width * job.height * 4 * streams))));
    // Output buffers travel to the main process and come back with the reply (fxChannel).
    const size = job.width * job.height * 4, pool = [];
    const take = () => pool.pop() || new Uint8Array(size);
    const read = () => fxRead(job.id, batch).catch(error => ({ ok: false, error: error.message }));
    // Writes stay in flight while the next frames are drawn (the arguments are copied when
    // the call is made, so the output buffers are free again at once); the main process
    // queues them in order. Waiting for each write made every frame pay both transfers.
    // Each drawn frame's pixels are collected one frame later (gl.readAsync), so the GPU
    // copy overlaps the next upload and draw.
    const writes = [], IN_FLIGHT = 2, drawn = [];
    const write = (output) => {
      const sent = fxWrite(job.id, output).then(({ result, buffers }) => {
        for (const b of buffers) if (b?.byteLength === size && pool.length < batch * 4) pool.push(b);
        return unwrap(result);
      });
      // The loop awaits every write from `writes` and reports its failure there. A write that fails
      // while the loop is still waiting on a read must not also be logged as an unhandled rejection.
      sent.catch(() => {});
      return sent;
    };
    let pending = read(), count = 0, finished = 0, output = [];
    const settle = async () => {
      output.push(await gl.finish(drawn.shift(), take()));finished++;step();
      if (output.length === batch || finished === job.frames) {
        writes.push(write(batch > 1 ? output : output[0]));output = [];
        if (writes.length >= IN_FLIGHT) await writes.shift();
      }
    };
    try {
      while (count < job.frames) {
        if (isCanceled()) return false;
        const value = unwrap(await pending), frames = value?.frames || (value ? [value] : []);
        if (!frames.length) throw new Error('The effect decoder ended before all requested frames were rendered.');
        const used = frames.slice(0, job.frames - count);
        if (count + used.length < job.frames) pending = read();
        for (const frame of used) {
          if (isCanceled()) return false;
          drawn.push(draw(frame, count++));
          if (drawn.length > 1) await settle();
        }
      }
      while (drawn.length) await settle();
      while (writes.length) await writes.shift();
    } finally { writes.forEach(w => w.catch(() => {})); }
    unwrap(await window.api.fxEnd(job.id));return true;
  };
  // A colour-only look on the whole clip (filter, LUT, Adjust) becomes one 3D LUT that FFmpeg
  // applies in the encode (src/features/export/colorLut.js): no frames make the round trip.
  const lutRun = async ({ track, clip, start, from, to, len }) => {
    const length = (clip.out - clip.in) / (clip.speed || 1);
    if (from !== 0 || Math.abs(to - length) > 1e-6) return false;
    if (activeEffects(projectIn, start, start + length).some(e => !e.disabled && e.strength !== 0 && isShaderFx(e.fx))) return false;
    let baked;
    try { baked = bakeColorLut(gl, pixelPasses(projectIn, clip, start, 0)); } catch { return false; }
    if (!baked) return false;
    const { id } = unwrap(await window.api.fxLut(baked.size, baked.table));
    const key = track === 'overlay' ? 'overlayClips' : 'videoClips';
    project = { ...project, [key]: project[key].map(c => c.id === clip.id ? { ...clip, colorLut: { job: id } } : c) };
    stats.lutClips++;done += Math.max(1, Math.round(len * (projectIn.renderSize?.fps || projectIn.fps)));onProgress(Math.min(1, done / total));
    return true;
  };
  const run = async ({ track, clip, start, from, to }) => {
    const cacheKey = JSON.stringify({epoch:cacheEpoch,clip,start,from,to,effects:activeEffects(projectIn,start+from,start+to),
      passes:await passSignature(pixelPasses(projectIn,clip,start,from))});
    const job = unwrap(await window.api.fxBegin(project, { kind: 'clip', track, clipId: clip.id, from, to, cacheKey }));
    if (!(await pump(job, (frame, k) => {
      assertPluginEffects(projectIn);
      const passes = pixelPasses(projectIn, clip, start, from + k / job.fps);
      if (!passes.length) return { bytes: frame };
      gl.effects({ data: frame }, job.width, job.height, passes);
      return gl.readAsync(job.width, job.height);
    }))) return false;
    const key = track === 'overlay' ? 'overlayClips' : 'videoClips';
    const old = project[key].find(c => c.id === clip.id), length = (clip.out - clip.in) / (clip.speed || 1);
    const override = from === 0 && to === length ? { job: job.id, start: 0, end: job.len }
      : { start: 0, end: length, sourceIn: clip.in, sourceSpeed: clip.speed || 1,
        segments: [...(old.videoOverride?.segments || []), { from, to, job: job.id }] };
    const baked = { ...clip, effects: (clip.effects || []).filter(id => !isShaderFx(id)), videoOverride: override };
    project = { ...project, [key]: project[key].map(c => c.id === clip.id ? baked : c) };
    return true;
  };
  for (const j of fxClipsOf(projectIn)) {
    if (isCanceled()) return null;
    if (await lutRun(j)) continue;
    stats.shaderClips++;
    if (!(await run(j))) return null;
  }
  // Effects on the Effects track are now inside the clips' pictures (shader effects and the
  // classic effects' shader forms alike); particle/light overlays stay for their own pass.
  project = { ...project, effectClips: (project.effectClips || []).filter((e) => !isShaderFx(e.fx)) };

  // 2) Animated transitions, from the clips as they now look.
  const originalLayout = videoLayout(projectIn.videoClips);
  for (const l of videoLayout(project.videoClips)) {
    const t = l.trans > 0 && fxTr(l.clip);
    if (!t) continue;
    const incoming = originalLayout.find(item => item.clip.id === l.clip.id), outgoing = originalLayout[incoming.index - 1];
    const clips = [outgoing, incoming];
    const cacheKey = JSON.stringify({epoch:cacheEpoch,background:projectIn.background,
      clips:await Promise.all(clips.map(async item => ({clip:item.clip,start:item.start,motion:projectIn.motion?.[item.clip.id],
        mask:projectIn.maskImages?.[item.clip.id],custom:projectIn.customMaskImages?.[item.clip.id],deco:projectIn.decoImages?.[item.clip.id],
        passes:await passSignature(pixelPasses(projectIn,item.clip,item.start,Math.max(0,l.start-item.start)))}))),
      effects:activeEffects(projectIn,l.start,l.start+l.trans)});
    stats.transitions++;
    const job = unwrap(await window.api.fxBegin(project, { kind: 'transition', clipId: l.clip.id, cacheKey }));
    if (!(await pump(job, (pair, k) => {
      assertPluginEffects(projectIn);
      gl.transition({ data: pair.a }, { data: pair.b }, job.width, job.height, easeValue(l.clip.transition?.ease, k / job.fps / job.len), t.expr);
      return gl.readAsync(job.width, job.height);
    }, 2))) return null;
    project = { ...project, fxSegments: { ...project.fxSegments, [l.clip.id]: job.id } };
  }
  onProgress(1);
  return project;
}
