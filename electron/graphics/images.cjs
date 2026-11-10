// Library pictures for motion graphics. A graphic is an SVG drawn as an image in the sandbox, which
// may load nothing external (not even blob: URLs), and the sandbox may not touch the disk. So a
// picture the component uses travels with the job as data, like a font: prepared here once, from the
// library file, never stored in the project (which keeps only the media id).
//
// Prepared once per file and size: decoded with FFmpeg, shrunk to fit the canvas (a 12 MP photo in a
// 1080p graphic becomes a 1080 px picture), re-encoded as JPEG, or PNG when it has transparency. The
// result is kept in memory by file identity (path, size, modification time) and canvas side, so the
// live preview, the full render and later re-renders of the same graphic prepare nothing again; a
// replaced file prepares again and, through the content hash, renders again.
const fs = require('node:fs'), path = require('node:path');
const { execFile } = require('node:child_process');

const LIMITS = { count: 8, id: 80, side: 4096, bytes: 24 * 1024 * 1024, cache: 96 * 1024 * 1024 };
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
const ALPHA = /a|pal8|ya8|ya16/; // pixel formats with transparency (rgba, yuva420p, pal8, ya8…)

const run = (file, args, signal) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) => error ? reject(Object.assign(Error(String(stderr || error.message).trim().split('\n').pop()), { name: signal?.aborted ? 'AbortError' : 'Error' })) : resolve(stdout));
  signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
});

// The pixel size written in a PNG or JPEG file.
function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  let i = 2;
  while (i + 9 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1], length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw Error('Could not read the picture size.');
}

// refs: [{ id, path }] from the editor (the id is the library media id the component reads).
// Resolves [{ id, data (base64), type, width, height }], prepared to fit side x side.
class GraphicImages {
  constructor({ ffmpegPath, probe }) { Object.assign(this, { ffmpegPath, probe }); this.cache = new Map(); this.bytes = 0; }

  async prepare(refs, { side, signal } = {}) {
    if (refs === undefined || refs === null) return [];
    if (!Array.isArray(refs)) throw Error('images must be a list of library pictures.');
    if (refs.length > LIMITS.count) throw Error(`A graphic can use at most ${LIMITS.count} pictures.`);
    const fit = Math.max(16, Math.min(LIMITS.side, Math.round(side) || LIMITS.side));
    const out = [], seen = new Set();
    for (const ref of refs) {
      if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > LIMITS.id || typeof ref.path !== 'string' || !ref.path) throw Error('Each picture needs the library media id and its file.');
      if (seen.has(ref.id)) continue; seen.add(ref.id);
      out.push({ id: ref.id, ...await this.one(ref.path, fit, signal) });
    }
    const total = out.reduce((n, i) => n + i.data.length, 0);
    if (total > LIMITS.bytes) throw Error('The pictures are too large together; use fewer or smaller pictures.');
    return out;
  }

  async one(file, side, signal) {
    let st;
    try { st = fs.statSync(file); } catch { throw Error(`Picture not found: ${path.basename(file)}. Import it into the library again.`); }
    if (!st.isFile()) throw Error(`Not a picture file: ${path.basename(file)}.`);
    const key = `${file}|${st.size}|${st.mtimeMs}|${side}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; } // most recently used last
    if (!IMAGE_EXT.includes(path.extname(file).slice(1).toLowerCase())) throw Error(`${path.basename(file)} is not an image; graphics take pictures (png, jpg, webp, bmp, gif) from the library.`);
    const info = await this.probe(file);
    if (info.type !== 'image') throw Error(`${path.basename(file)} is a ${info.type}; graphics take pictures from the library.`);
    const alpha = ALPHA.test(info.pixFmt || '');
    // Shrink to fit the canvas side, never enlarge; even sizes for the JPEG's 4:2:0 chroma.
    const scale = `scale=w='min(iw,${side})':h='min(ih,${side})':force_original_aspect_ratio=decrease:flags=lanczos`;
    const args = ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', alpha ? `${scale},format=rgba` : `${scale}:force_divisible_by=2,format=rgb24`,
      ...(alpha ? ['-c:v', 'png'] : ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p']), '-f', 'image2pipe', 'pipe:1'];
    const bytes = await run(this.ffmpegPath, args, signal);
    const entry = { data: bytes.toString('base64'), type: alpha ? 'image/png' : 'image/jpeg', ...imageSize(bytes) };
    this.cache.set(key, entry); this.bytes += entry.data.length;
    for (const [k, v] of this.cache) { if (this.bytes <= LIMITS.cache) break; this.cache.delete(k); this.bytes -= v.data.length; }
    return entry;
  }
}

// What a prepared picture must look like when it reaches the sandbox (service.cjs validate).
function validateImages(images = []) {
  if (!Array.isArray(images)) throw Error('Invalid pictures.');
  if (images.length > LIMITS.count) throw Error(`A graphic can use at most ${LIMITS.count} pictures.`);
  for (const i of images) {
    if (!i || typeof i.id !== 'string' || !i.id || i.id.length > LIMITS.id || typeof i.data !== 'string' || !['image/png', 'image/jpeg'].includes(i.type)
      || ![i.width, i.height].every((n) => Number.isInteger(n) && n > 0 && n <= LIMITS.side)) throw Error('Pictures must be prepared by the graphics service before rendering.');
  }
  if (images.reduce((n, i) => n + i.data.length, 0) > LIMITS.bytes) throw Error('The pictures are too large together; use fewer or smaller pictures.');
  return images.map(({ id, data, type, width, height }) => ({ id, data, type, width, height }));
}

module.exports = { GraphicImages, validateImages, imageSize, IMAGE_LIMITS: LIMITS };
