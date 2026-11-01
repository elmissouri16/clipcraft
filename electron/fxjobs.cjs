// The animated-effects pass of the export. FFmpeg decodes the frames an effect or a transition needs and sends them
// to the interface, which draws them with the same WebGL shaders as the preview (src/fxExport.js); the results come
// back and FFmpeg stores them losslessly. The final export then uses those files (clip.videoOverride and
// project.fxSegments) instead of rendering the effects itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, buildExportArgs, fitSize, graphFile, narrowClip, stillInput, toSdr } = require('./ffmpeg.cjs');
const { shiftCurves } = require('./layers.cjs');

const clipLen = (c) => (c.out - c.in) / (c.speed || 1);
function transitionDur(clips, i) {
  const t = clips[i] && clips[i].transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}
const num = (n) => Number(n).toFixed(3);

// Reads fixed-size frames from a process's stdout, pausing the process while frames wait to be used.
class FrameReader {
  constructor(proc, size) {
    this.proc = proc;
    this.size = size;
    this.chunks = [];
    this.bytes = 0;
    this.ended = false;
    this.waiters = [];
    this.err = '';
    proc.stderr.on('data', (d) => { this.err = (this.err + d).slice(-3000); });
    proc.stdout.on('data', (d) => {
      this.chunks.push(d);
      this.bytes += d.length;
      if (this.bytes > size * 3) proc.stdout.pause();
      this.wake();
    });
    proc.stdout.on('end', () => { this.ended = true; this.wake(); });
    proc.on('error', (e) => { this.err = e.message; this.ended = true; this.wake(); });
  }

  wake() {
    while (this.waiters.length && (this.bytes >= this.size || this.ended)) this.waiters.shift()();
  }

  async next() {
    while (this.bytes < this.size && !this.ended) await new Promise((r) => this.waiters.push(r));
    if (this.bytes < this.size) return null;
    const all = Buffer.concat(this.chunks);
    const frame = all.subarray(0, this.size);
    const rest = all.subarray(this.size);
    this.chunks = rest.length ? [rest] : [];
    this.bytes = rest.length;
    if (this.bytes <= this.size * 3) this.proc.stdout.resume();
    return Buffer.from(frame);
  }
}

function encoder(file, w, h, fps) {
  const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`,
    '-r', String(fps), '-i', 'pipe:0', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', file], { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(file) : reject(new Error(err || `encoder exited with ${code}`))));
  });
  p.stdin.on('error', () => {});
  done.catch(() => {}); // awaited in end(); a canceled job must not raise an unhandled rejection
  return { p, done };
}

const decoder = (args) => spawn(ffmpegPath, args, { windowsHide: true });

class FxJobs {
  constructor() {
    this.jobs = new Map();
    this.dir = null;
    this.n = 0;
  }

  tmp() {
    if (!this.dir) this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-fx-'));
    return this.dir;
  }

  // Replaces job ids in a project by the files they produced (only finished jobs of this session).
  resolve(project) {
    const file = (id, kind) => {
      const j = this.jobs.get(id);
      if (!j || j.kind !== kind || !j.file) throw new Error('An effect render is missing; export again.');
      return j.file;
    };
    const fix = (c) => (c.videoOverride && c.videoOverride.job ? { ...c, videoOverride: { ...c.videoOverride, file: file(c.videoOverride.job, 'clip') } } : c);
    const segs = {};
    for (const [clipId, id] of Object.entries(project.fxSegments || {})) segs[clipId] = file(id, 'transition');
    return { ...project, videoClips: project.videoClips.map(fix), overlayClips: (project.overlayClips || []).map(fix), fxSegments: segs };
  }

  // spec: { kind: 'clip', track: 'video' | 'overlay', clipId } or { kind: 'transition', clipId } (the incoming clip).
  begin(projectIn, spec) {
    let project = this.resolve(projectIn);
    // Masks travel as data URLs (like for the export); transitions need them as files.
    if (project.maskImages && !project.maskFiles) {
      const maskFiles = {};
      Object.entries(project.maskImages).forEach(([clipId, dataUrl], n) => {
        const f = path.join(this.tmp(), `mask_${this.n}_${n}.png`);
        fs.writeFileSync(f, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        maskFiles[clipId] = f;
      });
      project = { ...project, maskFiles };
    }
    if (project.customMaskImages && !project.customMaskFiles) {
      const customMaskFiles = {};
      Object.entries(project.customMaskImages).forEach(([clipId, dataUrl], n) => {
        const f = path.join(this.tmp(), `cmask_${this.n}_${n}.png`);
        fs.writeFileSync(f, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        customMaskFiles[clipId] = f;
      });
      project = { ...project, customMaskFiles };
    }
    const { width: W, height: H, fps } = project;
    const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
    const id = `fx${++this.n}`;
    const out = path.join(this.tmp(), `${id}.mkv`);

    if (spec.kind === 'clip') {
      const list = spec.track === 'overlay' ? project.overlayClips || [] : project.videoClips;
      const clip = list.find((c) => c.id === spec.clipId);
      const m = clip && mediaById[clip.mediaId];
      if (!clip || !m || m.type === 'audio') throw new Error('Clip not found for the effect render.');
      const len = clipLen(clip);
      const { fw, fh } = fitSize(m, W, H);
      const input = m.type === 'image'
        ? stillInput(m.path, fps, len)
        : ['-i', m.path];
      const pre = m.type === 'image'
        ? `trim=duration=${num(len)},setpts=PTS-STARTPTS`
        : `trim=start=${num(clip.in)}:end=${num(clip.out)},setpts=(PTS-STARTPTS)/${clip.speed || 1}${toSdr(m)}`;
      const dec = decoder(['-hide_banner', '-loglevel', 'error', ...input, '-filter_complex',
        `[0:v]${pre},fps=${fps},scale=${fw}:${fh},setsar=1,format=rgba[o]`, '-map', '[o]', '-t', num(len),
        '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
      const frames = Math.max(1, Math.round(len * fps));
      const enc = encoder(out, fw, fh, fps);
      this.jobs.set(id, { kind: 'clip', readers: [new FrameReader(dec, fw * fh * 4)], decs: [dec], enc, out, frames, written: 0 });
      return { id, width: fw, height: fh, frames, fps, len };
    }

    // Transition: the last td seconds of the outgoing clip and the first td of the incoming one, as they look
    // on the main track (fitted on the background, with their look and pre-rendered effects).
    const clips = project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]);
    const i = clips.findIndex((c) => c.id === spec.clipId);
    const td = transitionDur(clips, i);
    if (i < 1 || td <= 0) throw new Error('Transition not found for the effect render.');
    const A = clips[i - 1];
    const B = clips[i];
    const lenA = clipLen(A);
    // Animated clips keep their motion: the outgoing one from where its last td seconds start.
    const mini = (clip, from) => ({
      ...project, videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], fxSegments: {},
      motion: project.motion && project.motion[clip.id] ? { [clip.id]: shiftCurves(project.motion[clip.id], from) } : {},
    });
    const decs = [[narrowClip(A, mediaById[A.mediaId], lenA - td, lenA), lenA - td], [narrowClip(B, mediaById[B.mediaId], 0, td), 0]]
      .map(([c, from]) => decoder(graphFile(buildExportArgs(mini(c, from), null, { raw: true }).args)));
    const frames = Math.max(1, Math.round(td * fps));
    const enc = encoder(out, W, H, fps);
    this.jobs.set(id, { kind: 'transition', readers: decs.map((d) => new FrameReader(d, W * H * 4)), decs, enc, out, frames, written: 0 });
    return { id, width: W, height: H, frames, fps, len: td };
  }

  async read(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    const frames = await Promise.all(j.readers.map((r) => r.next()));
    if (frames.some((f) => !f)) {
      const err = j.readers.map((r) => r.err).find(Boolean);
      if (err && j.written === 0) throw new Error(err);
      return null;
    }
    return frames.length === 1 ? frames[0] : { a: frames[0], b: frames[1] };
  }

  async write(id, bytes) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    j.written++;
    if (!j.enc.p.stdin.write(Buffer.from(bytes))) await new Promise((r) => j.enc.p.stdin.once('drain', r));
  }

  async end(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    j.decs.forEach((d) => d.kill());
    j.enc.p.stdin.end();
    j.file = await j.enc.done;
    return { ok: true, frames: j.written };
  }

  // Stops every job and deletes their files (after an export, or when it is canceled).
  clear() {
    for (const j of this.jobs.values()) {
      j.decs.forEach((d) => d.kill());
      try { j.enc.p.kill(); } catch { /* already closed */ }
    }
    this.jobs.clear();
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

module.exports = { FxJobs, FrameReader };
