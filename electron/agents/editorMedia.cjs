// Request-owned media jobs. Reuse the editor's native processing engines and
// keep generated files in its cache; cancellation never changes source files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const ffmpeg = require('../media/ffmpeg.cjs');
const { reverse } = require('../media/reverse.cjs');
const { trackMotion } = require('../media/track.cjs');

const stop = signal => { if (signal?.aborted) throw Object.assign(Error('Media job stopped.'), { name: 'AbortError' }); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
async function runEditorMediaJob(req, { signal, cacheDir, probeAll, onProgress = () => {} }) {
  stop(signal);
  if (!req || !['reverse', 'frame', 'track'].includes(req.action)) throw Error('Unknown media job.');
  const source = req.item?.path;
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw Error('Provide an absolute local media path.');
  const before = fs.statSync(source);
  if (!before.isFile()) throw Error('The media source must be a file.');
  const item = { ...await ffmpeg.probe(source), path: source };
  stop(signal);
  if (!item || item.error) throw Error(item?.error || 'Could not read source media.');
  fs.mkdirSync(cacheDir, { recursive: true });
  const from = req.from ?? 0, to = req.to ?? item.duration;
  if (req.action !== 'frame' && (!finite(from) || !finite(to) || from < 0 || to <= from || to > item.duration + .05)) throw Error('The processing range must be inside the source media.');
  let result;
  if (req.action === 'reverse') {
    if (!['video', 'audio'].includes(item.type)) throw Error('Reverse requires video or audio.');
    const output = await reverse(item, { from, to, hasVideo: item.type !== 'audio', cacheDir,
      ffmpegPath: ffmpeg.ffmpegPath, toSdr: ffmpeg.toSdr, isCanceled: () => !!signal?.aborted, onProgress });
    stop(signal);
    const [media] = await probeAll([output]);
    if (!media || media.error) throw Error(media?.error || 'Could not read reversed media.');
    result = { ...media, name: `${path.parse(source).name} (reversed)${path.extname(output)}` };
  } else if (req.action === 'frame') {
    const at = req.at;
    if (!finite(at) || at < 0 || item.type !== 'video' || at >= item.duration) throw Error('Choose a source time inside a video.');
    const key = crypto.createHash('sha256').update(JSON.stringify(['sdr-v1', source, before.size, before.mtimeMs, at])).digest('hex').slice(0, 24);
    const output = path.join(cacheDir, `${key}-agent-frame.png`);
    if (!fs.existsSync(output)) {
      const temporary = path.join(cacheDir, `${key}-${crypto.randomUUID()}.part.png`);
      try {
        const sdr = ffmpeg.toSdr(item).replace(/^,/, '');
        await new Promise((resolve, reject) => execFile(ffmpeg.ffmpegPath,
          ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', source, ...(sdr ? ['-vf', sdr] : []), '-frames:v', '1', temporary],
          { signal, windowsHide: true }, error => error ? reject(error) : resolve()));
        stop(signal);fs.renameSync(temporary, output);
      } finally { fs.rmSync(temporary, { force: true }); }
    }
    const [media] = await probeAll([output]);
    if (!media || media.error) throw Error(media?.error || 'Could not read frozen frame.');
    result = media;
  } else {
    if (item.type !== 'video') throw Error('Motion tracking requires video.');
    const pick = req.pick, box = req.box || { w: .055, h: .095 };
    if (!pick || ![pick.x, pick.y].every(n => finite(n) && n >= 0 && n <= 1)) throw Error('Pick a normalized source point.');
    if (![box.w, box.h].every(n => finite(n) && n >= .01 && n <= .5)) throw Error('Tracking box dimensions must be from 0.01 to 0.5.');
    if (to - from > 600) throw Error('Track a range of at most ten minutes at a time.');
    const tracked = await trackMotion(item, { from, to, pick, box, cacheDir, ffmpegPath: ffmpeg.ffmpegPath,
      isCanceled: () => !!signal?.aborted, onProgress });
    result = { points: tracked.points, fps: tracked.fps, frames: tracked.raw, cached: !!tracked.cached };
  }
  stop(signal);
  const current = fs.statSync(source);
  if (current.size !== before.size || current.mtimeMs !== before.mtimeMs) throw Error('The source file changed while processing. Retry using the updated media.');
  return result;
}
module.exports = { runEditorMediaJob };
