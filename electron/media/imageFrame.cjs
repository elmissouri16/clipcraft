const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpegPath, probe } = require('./ffmpeg.cjs');
const stopped = () => Object.assign(new Error('Image generation stopped.'), { name: 'AbortError' });
function validateImageFrame(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('Provide canvas width and height between 1 and 8192 pixels.');
}
async function fitImageFrame(file, { width, height, signal }) {
  validateImageFrame(width, height);
  if (signal?.aborted) throw stopped();
  const info = await probe(file);
  if (signal?.aborted) throw stopped();
  if (info.type !== 'image') throw new Error('The generated file is not a readable image.');
  if (info.width === width && info.height === height) return { path: file, nativeWidth: info.width, nativeHeight: info.height };
  const output = path.join(path.dirname(file), `frame-${randomUUID()}.png`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, ['-n', '-hide_banner', '-loglevel', 'error', '-i', file,
        '-vf', `format=rgba,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:exact=1,setsar=1`,
        '-frames:v', '1', '-pix_fmt', 'rgba', output], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = '';
      const abort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
      child.once('error', reject);
      child.once('close', code => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(stopped());
        else if (code !== 0) reject(new Error(`Could not fit the generated image to the canvas: ${error}`));
        else resolve();
      });
    });
    if (signal?.aborted) throw stopped();
    return { path: output, nativeWidth: info.width, nativeHeight: info.height };
  } catch (error) { fs.rmSync(output, { force: true }); throw error; }
}
module.exports = { fitImageFrame, validateImageFrame };
