// Text layer for the export: the interface draws each frame and sends its raw RGBA pixels; FFmpeg packs them into a
// lossless QuickTime RLE file with transparency (text.mov) while the next frames are being drawn. This replaced one
// PNG per frame, whose encoding in the interface took most of the export time.
const { spawn } = require('child_process');
const path = require('path');

const QUEUE_BYTES = 64 * 1024 * 1024; // about 8 frames at 1080p

class TextStream {
  constructor(ffmpegPath, dir, width, height, fps) {
    this.file = path.join(dir, 'text.mov');
    this.width = width;
    this.height = height;
    this.size = width * height * 4;
    this.blank = Buffer.alloc(this.size); // transparent
    this.last = this.blank;
    this.count = 0;
    this.proc = spawn(ffmpegPath, [
      '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0',
      '-c:v', 'qtrle', '-pix_fmt', 'argb', '-y', this.file,
    ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    this.proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    this.failed = null;
    this.done = new Promise((resolve, reject) => {
      this.proc.on('error', (e) => { this.failed = e; reject(e); });
      this.proc.on('close', (code) => {
        if (code === 0) resolve(this.file);
        else {
          this.failed = new Error(`Text layer: ${err.trim().split('\n').pop() || `FFmpeg stopped (${code})`}`);
          reject(this.failed);
        }
      });
    });
    this.done.catch(() => {});
    this.proc.stdin.on('error', () => {}); // a stopped FFmpeg is reported by `done`
  }

  // Up to a few frames wait in the pipe, so the interface draws the next ones while FFmpeg packs these.
  write(buf) {
    if (this.failed) return Promise.reject(this.failed);
    this.count++;
    this.proc.stdin.write(buf);
    if (this.proc.stdin.writableLength <= QUEUE_BYTES) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = () => { this.proc.removeListener('close', onClose); resolve(); };
      const onClose = () => { this.proc.stdin.removeListener('drain', onDrain); reject(this.failed || new Error('Text layer: FFmpeg stopped')); };
      this.proc.stdin.once('drain', onDrain);
      this.proc.once('close', onClose);
    });
  }

  // frame: pixels (Uint8Array of width * height * 4); { blank: n } / { same: n } for n transparent frames or n copies
  // of the last frame; or { x, y, w, h, data }: the last frame with that rectangle replaced (data: its RGBA rows).
  // Sending only what changed keeps the interface-to-main copy small (a full 1080p frame is 8 MB).
  async add(frame) {
    if (frame && frame.blank > 0) {
      for (let i = 0; i < frame.blank; i++) await this.write(this.blank);
      this.last = this.blank;
    } else if (frame && frame.same > 0) {
      for (let i = 0; i < frame.same; i++) await this.write(this.last);
    } else if (frame && frame.data) {
      const { x, y, w, h } = frame;
      if (!(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= this.width && y + h <= this.height && frame.data.byteLength === w * h * 4)) {
        throw new Error('Text layer: bad frame patch');
      }
      // A new buffer: the last one may still be queued for FFmpeg.
      const buf = Buffer.from(this.last);
      const src = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      for (let r = 0; r < h; r++) src.copy(buf, ((y + r) * this.width + x) * 4, r * w * 4, (r + 1) * w * 4);
      this.last = buf;
      await this.write(buf);
    } else {
      const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      if (buf.length !== this.size) throw new Error('Text layer: wrong frame size');
      this.last = buf;
      await this.write(buf);
    }
  }

  // Resolves with the file once FFmpeg has written every frame.
  finish() {
    this.proc.stdin.end();
    return this.done;
  }

  kill() {
    if (this.proc.exitCode === null) this.proc.kill();
  }
}

module.exports = { TextStream };
