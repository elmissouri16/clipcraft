// The animated-effects pass of the export. FFmpeg decodes the frames an effect or a transition needs and sends them
// to the interface, which draws them with the same WebGL shaders as the preview (src/features/export/fxExport.js); the results come
// back and FFmpeg stores them losslessly. The final export then uses those files (clip.videoOverride and
// project.fxSegments) instead of rendering the effects itself.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, buildExportArgs, fitSize, graphFile, narrowClip, stillInput, toSdr, effectiveExport, speedOf, positive } = require("../media/ffmpeg.cjs");
const { shiftCurves } = require('./layers.cjs');
const { RenderCache } = require('./renderCache.cjs');
const { spawnDecoder, fifoWriter, makeFifo } = require('./framePipes.cjs');

const clipLen = (c) => (c.out - c.in) / speedOf(c);
function transitionDur(clips, i) {
  const t = clips[i] && clips[i].transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  if (Number.isFinite(t.timelineOverlap)) return Math.max(0, Math.min(t.timelineOverlap, clipLen(clips[i]), clipLen(clips[i - 1])));
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}
const num = (n) => Number(n).toFixed(3);
const stopProcess = proc => {
  if (!proc) return;
  // A decoder paused on a full stdout pipe may never handle SIGTERM. These
  // processes only own temporary work; close pipes and stop them decisively.
  proc.stdin?.destroy();proc.stdout?.destroy();proc.stderr?.destroy();
  if (proc.exitCode === null) proc.kill('SIGKILL');
};
function encoderError(detail, code, signal) {
  if (/no space left|disk (?:is )?full|ENOSPC/i.test(detail)) return new Error('Not enough disk space for temporary effect renders. Free space on the system drive and try exporting again.');
  return new Error(`The effect encoder failed: ${detail.trim() || (signal ? `stopped by ${signal}` : `exit code ${code}`)}`);
}
function checkTempSpace(dir) {
  let available;
  try { const stat=fs.statfsSync(dir);available=stat.bavail*stat.bsize; } catch { return; }
  if(available<64*1024*1024)throw encoderError('No space left on device');
}
// Pin a cache hit to this export. Cache eviction must not remove an input that
// is still needed by the final encode. Same-volume links use no extra media bytes.
function pinCached(cached, out) {
  try { fs.linkSync(cached,out); }
  catch(error) { if (!['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP','EMLINK'].includes(error.code)) throw error;fs.copyFileSync(cached,out); }
  return out;
}

// Reads fixed-size frames from a process's stdout, pausing the process while frames wait to be used.
class FrameReader {
  constructor(proc, size) {
    this.proc = proc;
    this.size = size;
    this.chunks = [];
    this.head = 0;
    this.offset = 0;
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
    const ended=()=>{this.ended=true;this.wake();};
    proc.stdout.on('end', ended);proc.stdout.on('close',ended);proc.on('close',ended);
    proc.on('error', (e) => { this.err = e.message; this.ended = true; this.wake(); });
  }

  wake() {
    while (this.waiters.length && (this.bytes >= this.size || this.ended)) this.waiters.shift()();
  }

  async next() {
    while (this.bytes < this.size && !this.ended) await new Promise((r) => this.waiters.push(r));
    if (this.bytes < this.size) return null;
    // Consume exactly one frame. Concatenating the entire queued backlog on
    // every read copied future frames repeatedly, especially at export sizes.
    const frame = Buffer.allocUnsafe(this.size);
    let written = 0;
    while (written < this.size) {
      const chunk = this.chunks[this.head];
      const count = Math.min(chunk.length - this.offset, this.size - written);
      chunk.copy(frame, written, this.offset, this.offset + count);
      written += count;this.offset += count;
      if (this.offset === chunk.length) { this.head++;this.offset = 0; }
    }
    this.bytes -= this.size;
    if (this.head > 64 || this.head === this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);this.head = 0;
    }
    if (this.bytes <= this.size * 3) this.proc.stdout.resume();
    return frame;
  }
}

// Sliced, threaded FFV1: still lossless (same decoded bytes), encoded and decoded about twice as fast.
const FFV1_THREADS = ['-threads', String(Math.max(1, Math.min(8, os.cpus().length))), '-slices', '24'];
// The lossless encoder of one effect render. write(frame) resolves when FFmpeg has taken
// the frame (backpressure), end() finishes the input. Frames go through a private named pipe
// on macOS (electron/export/framePipes.cjs) and through stdin elsewhere or with spawnImpl (tests).
function encoder(file, w, h, fps, spawnImpl) {
  checkTempSpace(path.dirname(file));
  const fifo = spawnImpl ? null : makeFifo(path.dirname(file), `${path.basename(file)}.in`);
  const p = (spawnImpl || spawn)(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`,
    '-r', String(fps), '-i', fifo || 'pipe:0', '-c:v', 'ffv1', ...FFV1_THREADS, '-pix_fmt', 'bgra', file], { windowsHide: true, stdio:[fifo ? 'ignore' : 'pipe','ignore','pipe'] });
  let err = '', failure = null;
  p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
  const done = new Promise((resolve, reject) => {
    p.on('error', error => { failure=error;reject(error); });
    p.on('close', (code,signal) => {
      if (code === 0) resolve(file);
      else { failure=encoderError(err,code,signal);reject(failure); }
    });
  });
  done.catch(() => {}); // awaited in end(); a canceled job must not raise an unhandled rejection
  const ended = async () => { await done; throw new Error('The effect encoder ended before all frames were written.'); };
  if (fifo) {
    const pipe = fifoWriter(fifo, p);
    p.once('close', () => pipe.close());
    return { p, done, get failure() { return failure; },
      async write(buffer) {
        if (failure) throw failure;
        if (p.exitCode !== null || p.signalCode) return ended();
        try { await pipe.write(buffer); }
        catch (error) { if (failure) throw failure; if (error.code === 'EPIPE' || p.exitCode !== null) return ended(); throw error; }
      },
      end: () => pipe.end(), close: () => pipe.close() };
  }
  p.stdin.on('error', () => {});
  return { p, done, get failure() { return failure; },
    async write(buffer) {
      if (failure) throw failure;
      if (p.stdin.destroyed || p.exitCode !== null) return ended();
      if (!p.stdin.write(buffer)) await new Promise((resolve, reject) => {
        const cleanup=()=>{p.stdin.removeListener('drain',drained);p.removeListener('close',closed);p.stdin.removeListener('error',pipeError);};
        const drained=()=>{cleanup();resolve();};
        const closed=()=>{cleanup();reject(failure || new Error('The effect encoder ended before all frames were written.'));};
        const pipeError=()=>{cleanup();done.then(closed,reject);};
        p.stdin.once('drain',drained);p.once('close',closed);p.stdin.once('error',pipeError);
        if(p.stdin.destroyed||p.exitCode!==null)pipeError();
      });
    },
    end: async () => { p.stdin.end(); }, close: () => {} };
}

const decoder = (args) => spawnDecoder(ffmpegPath, args);

class FxJobs {
  constructor() {
    this.jobs = new Map();
    this.dir = null;
    this.n = 0;
    this.cache = new RenderCache();
  }

  tmp() {
    if (!this.dir) this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-fx-'));
    return this.dir;
  }
  createEncoder(file,w,h,fps) { return encoder(file,w,h,fps); }

  // Replaces job ids in a project by the files they produced (only finished jobs of this session).
  resolve(project) {
    const file = (id, kind) => {
      const j = this.jobs.get(id);
      if (!j || j.kind !== kind || !j.file) throw new Error('An effect render is missing; export again.');
      return j.file;
    };
    const fix = c => {
      const override = c.videoOverride;if (!override) return c;
      if (override.segments) return { ...c, videoOverride: { ...override, segments: override.segments.map(s => ({ ...s, file: s.job ? file(s.job, 'clip') : s.file })) } };
      return override.job ? { ...c, videoOverride: { ...override, file: file(override.job, 'clip') } } : c;
    };
    // A colour LUT comes from a bake of this session (its file is never taken from the interface).
    const lut = c => {
      if (!c.colorLut) return c;
      const { colorLut, ...rest } = c;
      if (colorLut.job) return { ...rest, colorLut: { file: file(colorLut.job, 'lut') } };
      return colorLut.file && this.dir && path.dirname(colorLut.file) === this.dir && fs.existsSync(colorLut.file) ? c : rest;
    };
    const segs = {};
    for (const [clipId, id] of Object.entries(project.fxSegments || {})) segs[clipId] = file(id, 'transition');
    return { ...project, videoClips: project.videoClips.map(fix).map(lut), overlayClips: (project.overlayClips || []).map(fix).map(lut), fxSegments: segs };
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
    if (project.decoImages && !project.decoFiles) {
      const decoFiles = {};
      Object.entries(project.decoImages).forEach(([clipId, dataUrl], n) => {
        const f = path.join(this.tmp(), `deco_${this.n}_${n}.png`);
        fs.writeFileSync(f, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        decoFiles[clipId] = f;
      });
      project = { ...project, decoFiles };
    }
    const eff = effectiveExport(project), W = eff.outW, H = eff.outH;
    const fps = Math.min(positive(project.fps, 30), eff.outFps);
    const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
    const id = `fx${++this.n}`;
    const out = path.join(this.tmp(), `${id}.mkv`);

    if (spec.kind === 'clip') {
      const list = spec.track === 'overlay' ? project.overlayClips || [] : project.videoClips;
      const clip = list.find((c) => c.id === spec.clipId);
      const m = clip && mediaById[clip.mediaId];
      if (!clip || !m || m.type === 'audio') throw new Error('Clip not found for the effect render.');
      const from = Math.max(0, spec.from || 0), to = Math.min(clipLen(clip), spec.to ?? clipLen(clip));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Invalid effect render range.');
      const len = to - from;
      const { fw, fh } = fitSize(m, W, H);
      const frames = Math.max(1, Math.round(len * fps));
      const cacheKey = spec.cacheKey ? this.cache.key({ signature: spec.cacheKey, W, H, fps, from, to,
        media: { type:m.type,width:m.width,height:m.height,hdr:m.hdr,pixFmt:m.pixFmt } }, [m.path]) : null;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.jobs.set(id, {kind:'clip',file:pinCached(cached,out),frames,written:frames,decs:[],readers:[]});
        return {id,width:fw,height:fh,frames,fps,len,from,to,cached:true};
      }
      const input = m.type === 'image'
        ? stillInput(m.path, fps, len)
        : ['-ss', num(clip.in + from * speedOf(clip)), '-i', m.path];
      const pre = m.type === 'image'
        ? `trim=duration=${num(len)},setpts=PTS-STARTPTS`
        : `trim=duration=${num(len * speedOf(clip))},setpts=(PTS-STARTPTS)/${speedOf(clip)}${toSdr(m)}`;
      const dec = decoder(['-hide_banner', '-loglevel', 'error', ...input, '-filter_complex',
        `[0:v]${pre},fps=${fps},tpad=stop_mode=clone:stop_duration=1,scale=${fw}:${fh},setsar=1,format=rgba[o]`, '-map', '[o]', '-frames:v', String(frames),
        '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
      const enc = this.createEncoder(out, fw, fh, fps);
      this.jobs.set(id, { kind: 'clip', readers: [new FrameReader(dec, fw * fh * 4)], decs: [dec], enc, out, frames, written: 0, cacheKey });
      return { id, width: fw, height: fh, frames, fps, len, from, to };
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
    const frames = Math.max(1, Math.round(td * fps));
    const cacheKey = spec.cacheKey ? this.cache.key({signature:spec.cacheKey,W,H,fps,len:td,
      media:[mediaById[A.mediaId],mediaById[B.mediaId]].map(m=>m&&({width:m.width,height:m.height,hdr:m.hdr,pixFmt:m.pixFmt}))},
      [mediaById[A.mediaId]?.path,mediaById[B.mediaId]?.path]) : null;
    const cached = this.cache.get(cacheKey);
    if(cached) {
      this.jobs.set(id,{kind:'transition',file:pinCached(cached,out),frames,written:frames,decs:[],readers:[]});
      return {id,width:W,height:H,frames,fps,len:td,cached:true};
    }
    // Animated clips keep their motion: the outgoing one from where its last td seconds start.
    const mini = (clip, from) => ({
      ...project, videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], fxSegments: {},
      motion: project.motion && project.motion[clip.id] ? { [clip.id]: shiftCurves(project.motion[clip.id], from) } : {},
    });
    const decs = [[narrowClip(A, mediaById[A.mediaId], lenA - td, lenA), lenA - td], [narrowClip(B, mediaById[B.mediaId], 0, td), 0]]
      .map(([c, from]) => decoder(graphFile(buildExportArgs(mini(c, from), null, { raw: true }).args)));
    const enc = this.createEncoder(out, W, H, fps);
    this.jobs.set(id, { kind: 'transition', readers: decs.map((d) => new FrameReader(d, W * H * 4)), decs, enc, out, frames, written: 0, cacheKey });
    return { id, width: W, height: H, frames, fps, len: td };
  }

  async read(id, count = 1) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    const limit = Math.max(1, Math.min(4, Math.floor(16 * 1024 * 1024 / (j.readers[0].size * j.readers.length))));
    const batch = [];
    for (let i = 0; i < Math.max(1, Math.min(limit, Number(count) || 1)); i++) {
      const frames = await Promise.all(j.readers.map(r => r.next()));
      if (frames.some(f => !f)) {
        const err = j.readers.map(r => r.err).find(Boolean);
        if (err && !batch.length && j.written === 0) throw new Error(err);
        break;
      }
      batch.push(frames.length === 1 ? frames[0] : { a: frames[0], b: frames[1] });
    }
    return count > 1 ? { frames: batch } : batch[0] || null;
  }

  // The interface keeps a few writes in flight (src/features/export/fxExport.js pump), so frames
  // are queued per job and reach the encoder strictly in the order they arrived.
  write(id, bytes) {
    const j = this.jobs.get(id);
    if (!j) return Promise.reject(new Error('Unknown effect render'));
    const run = (j.writing || Promise.resolve()).then(() => this.writeFrames(j, bytes));
    j.writing = run.catch(() => {});
    return run;
  }

  async writeFrames(j, bytes) {
    const frames = Array.isArray(bytes) && typeof bytes[0] !== 'number' ? bytes : [bytes];
    for (const frame of frames) {
      if (!j.enc) throw new Error('The effect render already ended.');
      if (j.enc.failure) throw j.enc.failure;
      // The received bytes are ours: hand them to the encoder without another 8 MB copy.
      const buffer = ArrayBuffer.isView(frame) ? Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength) : Buffer.from(frame);
      if (buffer.length !== j.readers[0].size) throw new Error('Effect frame size does not match the render job.');
      if(j.written%Math.max(1,Math.ceil(32*1024*1024/buffer.length))===0)checkTempSpace(this.dir);
      await j.enc.write(buffer);
      j.written++;
    }
  }

  async end(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown effect render');
    await j.writing;
    if (j.written !== j.frames) throw new Error(`Effect render wrote ${j.written} of ${j.frames} frames.`);
    j.decs.forEach(stopProcess);
    await j.enc.end();
    j.file = await j.enc.done;
    await this.cache.put(j.cacheKey, j.file, {immutable:true}).catch(() => {}); // unique completed job files are never overwritten
    j.decs=[];j.readers=[];j.enc=null;
    return { ok: true, frames: j.written };
  }

  // A colour-only look baked by the interface (src/features/export/colorLut.js): size³ RGB
  // bytes, red fastest, written as a .cube file for FFmpeg's lut3d. Same table, same file.
  lut(size, bytes) {
    size = Number(size);
    if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error('Invalid colour LUT size.');
    const data = bytes instanceof Uint8Array ? bytes : null;
    if (!data || data.length !== size ** 3 * 3) throw new Error('The colour LUT does not match its size.');
    const hash = crypto.createHash('sha1').update(data).digest('hex');
    for (const [id, j] of this.jobs) if (j.kind === 'lut' && j.hash === hash && fs.existsSync(j.file)) return { id };
    const id = `lut${++this.n}`, file = path.join(this.tmp(), `${id}.cube`);
    const level = Array.from({ length: 256 }, (_, v) => (v / 255).toFixed(5));
    const lines = new Array(size ** 3);
    for (let i = 0; i < lines.length; i++) lines[i] = `${level[data[i * 3]]} ${level[data[i * 3 + 1]]} ${level[data[i * 3 + 2]]}`;
    fs.writeFileSync(file, `TITLE "ClipCraft look"\nLUT_3D_SIZE ${size}\n${lines.join('\n')}\n`);
    this.jobs.set(id, { kind: 'lut', file, hash, frames: 0, written: 0, decs: [], readers: [] });
    return { id };
  }

  // Stops every job and deletes their files (after an export, or when it is canceled).
  clear() {
    for (const j of this.jobs.values()) {
      j.decs.forEach(stopProcess);
      try { j.enc?.close(); stopProcess(j.enc?.p); } catch { /* already closed */ }
    }
    this.jobs.clear();
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

module.exports = { FxJobs, FrameReader, encoder };
