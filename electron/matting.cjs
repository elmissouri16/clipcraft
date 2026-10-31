// AI background removal ("Auto removal", like CapCut): Robust Video Matting (github.com/PeterL1n/RobustVideoMatting,
// MobileNetV3, ONNX) finds the people in a video, frame after frame with its recurrent state so edges stay steady.
// The model (15 MB, GPL-3.0, from its own GitHub release) is downloaded on first use; nothing else leaves the PC.
// The result is a "matte": a grayscale video, white where the person is, made once per video and cached. The
// preview and the export use it as the clip's transparency.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const MODEL = {
  file: 'rvm_mobilenetv3_fp32.onnx',
  url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx',
  size: 14975696,
  sha256: '88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828',
};
// The model sees the shorter side at this size (512 x 910 for a phone video: about 75 ms a frame on a laptop CPU),
// and works internally at about 384 px on the longer side (downsample_ratio), as the RVM authors advise.
const SIDE = 512;
const INNER = 384;

const modelPath = (dir) => path.join(dir, MODEL.file);
const status = (dir) => ({ installed: fs.existsSync(modelPath(dir)) && fs.statSync(modelPath(dir)).size === MODEL.size });

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

// Downloads the model once. onProgress(fraction).
async function install(dir, onProgress, fetchImpl = fetch) {
  if (status(dir).installed) return;
  fs.mkdirSync(dir, { recursive: true });
  let res;
  try {
    res = await fetchImpl(MODEL.url, { redirect: 'follow' });
  } catch {
    throw new Error('No internet connection: the background removal model (15 MB) is downloaded on first use.');
  }
  if (!res.ok) throw new Error(`The background removal model could not be downloaded (HTTP ${res.status}).`);
  const part = `${modelPath(dir)}.part`;
  let done = 0;
  const count = new Transform({
    transform(chunk, _e, cb) {
      done += chunk.length;
      onProgress?.(Math.min(1, done / MODEL.size));
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part));
  if ((await sha256File(part)) !== MODEL.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error('The background removal model download was damaged. Try again.');
  }
  fs.renameSync(part, modelPath(dir));
}

// Size the model sees for a w x h picture (even numbers, the shorter side SIDE, never upscaled).
function workSize(w, h) {
  const k = Math.min(1, SIDE / Math.max(1, Math.min(w, h)));
  return { w: Math.max(2, Math.round((w * k) / 2) * 2), h: Math.max(2, Math.round((h * k) / 2) * 2) };
}

const fpsOf = (item) => Math.max(1, Math.min(60, Math.round(item.fps || 30)));

// Where the matte of a file goes: one per file content (path, size, date) and settings.
function matteFile(item, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|rvm1|${SIDE}|${fpsOf(item)}`).digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-matte.mp4`);
}

// Makes (or finds) the matte of a video. item: { path, width, height, duration, fps, hdr }. toSdr(item) gives the
// FFmpeg filter that brings HDR to normal colors (or ''). The matte is constant frame rate from 0 s, like the
// frames the model saw, so trimming it by source time lines it up with the clip. onProgress(fraction); isCanceled()
// is checked between frames. Returns the matte file.
async function makeMatte(item, { dir, cacheDir, ffmpegPath, toSdr = () => '', onProgress, isCanceled = () => false }) {
  if (!status(dir).installed) throw new Error('The background removal model is not downloaded yet.');
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = matteFile(item, cacheDir);
  if (fs.existsSync(out)) return out;
  const ort = require('onnxruntime-node');
  const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
  const session = await ort.InferenceSession.create(modelPath(dir), {
    executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: threads,
  });
  const fps = fpsOf(item);
  const { w, h } = workSize(item.width || 1280, item.height || 720);
  const total = Math.max(1, Math.round((item.duration || 1) * fps));
  const sdr = toSdr(item);
  const dec = spawn(ffmpegPath, ['-v', 'error', '-i', item.path, '-an', '-vf', `${sdr ? `${sdr.replace(/^,/, '')},` : ''}fps=${fps},scale=${w}:${h}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true });
  const part = `${out}.part.mp4`;
  const enc = spawn(ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part], { windowsHide: true });
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr = (encErr + d).slice(-1000); });
  const encDone = new Promise((resolve) => enc.on('close', resolve));
  enc.stdin.on('error', () => {});

  const plane = w * h;
  const frameBytes = plane * 3;
  const src = new Float32Array(3 * plane);
  const ratio = new ort.Tensor('float32', new Float32Array([Math.min(1, Math.max(0.1, INNER / Math.max(w, h)))]), [1]);
  let rec = [0, 1, 2, 3].map(() => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]));
  let n = 0;
  let stopped = false;
  const runFrame = async (frame) => {
    for (let i = 0; i < plane; i++) {
      src[i] = frame[i * 3] / 255;
      src[plane + i] = frame[i * 3 + 1] / 255;
      src[2 * plane + i] = frame[i * 3 + 2] / 255;
    }
    const r = await session.run({ src: new ort.Tensor('float32', src, [1, 3, h, w]), r1i: rec[0], r2i: rec[1], r3i: rec[2], r4i: rec[3], downsample_ratio: ratio });
    rec = [r.r1o, r.r2o, r.r3o, r.r4o];
    const pha = r.pha.data;
    const gray = Buffer.allocUnsafe(plane);
    for (let i = 0; i < plane; i++) gray[i] = pha[i] <= 0 ? 0 : pha[i] >= 1 ? 255 : Math.round(pha[i] * 255);
    if (!enc.stdin.write(gray)) await new Promise((res) => enc.stdin.once('drain', res));
    n++;
    if (n % 5 === 0) onProgress?.(Math.min(0.99, n / total));
  };

  // Frames are taken from FFmpeg's output one at a time (the decoder waits while the model works).
  let pending = Buffer.alloc(0);
  let work = Promise.resolve();
  dec.stdout.on('data', (d) => {
    if (stopped) return; // canceled: the rest is drained and dropped
    dec.stdout.pause();
    pending = pending.length ? Buffer.concat([pending, d]) : d;
    work = work.then(async () => {
      while (!stopped && pending.length >= frameBytes) {
        if (isCanceled()) {
          stopped = true;
          dec.kill();
          dec.stdout.resume(); // the stream must flow to its end, or the decoder's 'close' never comes
          break;
        }
        const f = pending.subarray(0, frameBytes);
        pending = pending.subarray(frameBytes);
        await runFrame(f);
      }
      if (!stopped) dec.stdout.resume();
    });
  });
  let decErr = '';
  dec.stderr.on('data', (d) => { decErr = (decErr + d).slice(-1000); });
  const decCode = await new Promise((resolve) => dec.on('close', resolve));
  try {
    await work;
  } finally {
    enc.stdin.end();
    await encDone;
    await session.release?.();
  }
  if (stopped) {
    fs.rmSync(part, { force: true });
    const e = new Error('Canceled.');
    e.canceled = true;
    throw e;
  }
  if (decCode !== 0 || n === 0) {
    fs.rmSync(part, { force: true });
    throw new Error(`Could not read the video for background removal. ${decErr.trim().split('\n').pop() || ''}`.trim());
  }
  if (!fs.existsSync(part) || fs.statSync(part).size < 100) throw new Error(`Could not write the background matte. ${encErr.trim().split('\n').pop() || ''}`.trim());
  fs.renameSync(part, out);
  onProgress?.(1);
  return out;
}

module.exports = { status, install, makeMatte, matteFile, workSize, MODEL };
