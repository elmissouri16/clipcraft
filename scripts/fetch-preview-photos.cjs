// Restore the fixed photo IDs credited in public/preview/CREDITS.txt. Photos are
// local build inputs, fetched during setup rather than by the running renderer.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PHOTO_IDS = [1015, 1016, 1018, 1025, 292, 1060];
const MAX_BYTES = 2 * 1024 * 1024;
const isJpeg = (bytes) => bytes.length > 4 && bytes.length <= MAX_BYTES
  && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
function cachedPhoto(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 4) return false;
    const edges = Buffer.alloc(5);
    fs.readSync(fd, edges, 0, 3, 0);
    fs.readSync(fd, edges, 3, 2, stat.size - 2);
    return isJpeg(edges);
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function ensurePreviewPhotos({ root = path.resolve(__dirname, '..'), fetchImpl = fetch, check = false } = {}) {
  const dir = path.join(root, 'public', 'preview');
  if (!check) fs.mkdirSync(dir, { recursive: true });
  return Promise.all(PHOTO_IDS.map(async (id) => {
    const file = path.join(dir, `p${id}.jpg`);
    if (cachedPhoto(file)) return { file, status: 'present' };
    if (check) return { file, status: 'missing' };
    const temporary = `${file}.${randomUUID()}.part`;
    try {
      const response = await fetchImpl(`https://picsum.photos/id/${id}/640/400.jpg`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Photo is too large');
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error('Photo is too large');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (!isJpeg(bytes)) throw new Error('The source did not return a complete JPEG');
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      fs.renameSync(temporary, file);
      return { file, status: 'downloaded' };
    } catch (error) {
      return { file, status: 'failed', error: error.message };
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* no partial file */ }
    }
  }));
}

if (require.main === module) {
  ensurePreviewPhotos({ check: process.argv.includes('--check') }).then((results) => {
    const failed = results.filter((r) => r.status === 'failed' || r.status === 'missing');
    for (const result of failed) console.warn(`[preview photos] ${path.basename(result.file)}: ${result.error || 'missing'}`);
    if (results.some((r) => r.status === 'downloaded')) console.log(`[preview photos] ${results.length - failed.length}/${results.length} local photos ready`);
    if (failed.length && !process.argv.includes('--required') && !process.argv.includes('--check')) {
      console.warn('[preview photos] Continuing with drawn previews. Run npm run assets:preview when online to restore photos.');
    }
    process.exitCode = failed.length && (process.argv.includes('--required') || process.argv.includes('--check')) ? 1 : 0;
  }).catch((error) => {
    console.error(`[preview photos] ${error.message}`);
    process.exitCode = process.argv.includes('--required') || process.argv.includes('--check') ? 1 : 0;
  });
}
module.exports = { ensurePreviewPhotos, PHOTO_IDS };
