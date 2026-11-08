// User-attached reference videos for CraftAI. A reference is analysed for how it
// is edited (electron/media/editStyle.cjs); it is never sent to a model as video.
// Videos stay where they are (they can be gigabytes): the store keeps an opaque ID,
// the original path, probe metadata and a small poster. Saved chats contain the ID
// and metadata only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'ogv'];
const MAX_VIDEOS = 3, MAX_SECONDS = 2 * 60 * 60;
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

function poster(ffmpegPath, file, at, out) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(Error('Reading the video took too long.')); }, 20000);
    p.once('error', (e) => { clearTimeout(timer); reject(e); });
    p.once('close', (code) => { clearTimeout(timer); code === 0 && fs.existsSync(out) ? resolve(out) : reject(Error('Could not read a frame of this video.')); });
  });
}

class ChatVideos {
  constructor(root, { ffmpegPath, probe, fingerprint }) { Object.assign(this, { root, ffmpegPath, probe, fingerprint }); }
  folder(id) { if (!validId(id)) throw Error('Invalid video reference.'); return path.join(this.root, id); }
  // The stored reference, checked against the file on disk.
  async get(id) {
    let meta;
    try {
      meta = JSON.parse(await fs.promises.readFile(path.join(this.folder(id), 'metadata.json'), 'utf8'));
      if (meta.id !== id) throw Error();
    } catch { throw Error('An attached reference video is no longer known. Remove it and attach it again.'); }
    if (!fs.existsSync(meta.path)) throw Error(`The reference video “${meta.name}” was moved or deleted. Remove it and attach it again.`);
    return meta;
  }
  async preview(id) {
    const file = path.join(this.folder(id), 'poster.jpg');
    try { return { url: `data:image/jpeg;base64,${(await fs.promises.readFile(file)).toString('base64')}` }; }
    catch { return { error: 'Preview unavailable' }; }
  }
  // items: [{ path }]. Returns { videos, errors } like the image attachments.
  async add(items) {
    if (!Array.isArray(items) || !items.length || items.length > MAX_VIDEOS) throw Error(`Attach up to ${MAX_VIDEOS} reference videos per message.`);
    const videos = [], errors = [];
    for (const item of items) {
      const file = typeof item?.path === 'string' ? item.path : '', name = path.basename(file);
      try {
        if (!file || !path.isAbsolute(file)) throw Error('Choose a video file on this computer.');
        if (!EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase())) throw Error('This is not a supported video file.');
        const stat = fs.statSync(file);
        if (!stat.isFile()) throw Error('Choose a video file.');
        const info = await this.probe(file);
        if (info.type !== 'video' || !(info.duration > 0)) throw Error('This file has no readable video.');
        if (info.duration > MAX_SECONDS) throw Error('Reference videos can be up to 2 hours long.');
        const id = crypto.createHash('sha256').update(this.fingerprint(file)).digest('hex'), folder = this.folder(id);
        fs.mkdirSync(folder, { recursive: true });
        await poster(this.ffmpegPath, file, Math.min(info.duration * 0.1, 3), path.join(folder, 'poster.jpg'));
        const meta = { id, name: name.slice(0, 180), path: file, bytes: stat.size, duration: Math.round(info.duration * 100) / 100,
          width: info.width, height: info.height, fps: info.fps, hasAudio: !!info.hasAudio, rotation: info.rotation || 0 };
        fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify(meta));
        const { path: _private, ...visible } = meta;
        videos.push(visible);
      } catch (error) { errors.push({ name, error: error.message }); }
    }
    return { videos, errors };
  }
  async validate(ids) {
    if (!Array.isArray(ids) || ids.length > MAX_VIDEOS) throw Error(`Attach up to ${MAX_VIDEOS} reference videos per message.`);
    for (const id of ids) await this.get(id);
  }
}

module.exports = { ChatVideos, VIDEO_EXTENSIONS: EXTENSIONS, MAX_VIDEOS };
