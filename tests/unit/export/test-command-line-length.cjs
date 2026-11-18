// Cut-heavy projects (remove silences, many manual cuts of one recording) must not outgrow Windows' 32,767-character
// command line: clips of one file share an input (each trims its own part) and a long filter graph goes in a file.
// Measured for 400 clips of one long-named source for the video export, the timeline-audio render (captions,
// silences) and the audio export. Then the renders are checked against the one-input-per-clip renders (each clip
// reading its own hard link of the source): identical pictures, and sound equal to within a rounding step.
// Usage: node tests/unit/export/test-command-line-length.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');

const LIMIT = 32767;
const quote = (a) => (/[\s"]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a);
const commandLength = (args) => ['C:\\Users\\Samantha\\AppData\\Local\\Programs\\ClipCraft\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe', ...args].map(quote).join(' ').length;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-command-line-'));
const project = (paths, n, len = 0.6, step = 0.9, extra = {}) => ({
  width: 160, height: 90, fps: 25, background: '#000000',
  media: paths.map((p, k) => ({ id: `m${k}`, type: 'video', path: p, hasAudio: true, width: 160, height: 90, duration: 3600, fps: 25, channels: 1, pixFmt: 'yuv420p', acodec: 'aac' })),
  videoClips: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, mediaId: `m${i % paths.length}`, in: 0.37 + i * step, out: 0.37 + i * step + len, speed: 1, volume: 1, ...(extra[i] || {}) })),
  overlayClips: [], audioClips: [], textClips: [],
});
(async () => {
  try {
    // 1) Bounded command lines.
    const long = 'C:\\Users\\Samantha\\Videos\\ClipCraft\\Screen recording 2026-11-18 10-11-12.mp4';
    const big = project([long], 400, 4.7, 6);
    const graphs = path.join(dir, 'graphs'); fs.mkdirSync(graphs);
    const lengths = {
      video: commandLength(ff.graphFile(ff.buildExportArgs(big, 'C:\\Users\\Samantha\\Videos\\out.mp4', { encoder: 'libx264' }).args, graphs)),
      timelineAudio: commandLength(ff.graphFile(ff.buildTimelineAudioArgs(big, 'C:\\Users\\Samantha\\AppData\\Local\\Temp\\fve-sil-abc123\\a.wav', 'all'), graphs)),
      audioExport: commandLength(ff.graphFile(ff.buildAudioExportArgs(big, 'C:\\Users\\Samantha\\Music\\out.mp3', 'mp3'), graphs)),
    };
    for (const [name, length] of Object.entries(lengths)) assert.ok(length < LIMIT / 4, `${name}: ${length} characters for 400 clips`);
    const run = ff.longGraph(ff.buildTimelineAudioArgs(big, 'a.wav', 'all'));
    assert.ok(run.args.includes('-filter_complex_script'), 'the runners move a long graph to a file');
    const script = run.args[run.args.indexOf('-filter_complex_script') + 1];
    assert.ok(fs.existsSync(script)); run.done(); assert.ok(!fs.existsSync(script), 'and remove it afterwards');

    // 2) Same output as one input per clip. 12 clips of one source in order, one transition, one jump back, one
    // clip a minute later (a new shared input), against the same clips each reading its own hard link.
    const src = path.join(dir, 'source.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=75', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*(200+10*t)*t)':s=48000:d=75",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', src]);
    const info = await ff.probe(src);
    const n = 12, links = Array.from({ length: n }, (_, i) => { const p = path.join(dir, `link-${i}.mp4`); fs.linkSync(src, p); return p; });
    const shape = (paths) => {
      const p = project(paths, n, 0.6, 0.9, { 4: { transition: { type: 'fade', duration: 0.2 } }, 7: { in: 5.0, out: 5.6 }, 10: { in: 72.01, out: 72.61 } });
      p.media = p.media.map((m) => ({ ...m, ...info, path: m.path }));
      return p;
    };
    const shared = shape([src]), separate = shape(links);
    const inputs = (args) => args.filter((a) => a === '-i').length;
    assert.equal(inputs(ff.buildExportArgs(shared, 'x.mp4', { encoder: 'libx264' }).args), 4, 'video: one input per forward run (jump back, minute later)');
    assert.equal(inputs(ff.buildExportArgs(separate, 'x.mp4', { encoder: 'libx264' }).args), n);
    assert.equal(inputs(ff.buildTimelineAudioArgs(shared, 'x.wav', 'all')), 2, 'sound: one input per stretch of the file');

    // The export's own graph, its picture and sound written raw instead of encoded.
    let runs = 0;
    const decoded = (p) => {
      const args = ff.buildExportArgs(p, 'x.mp4', { encoder: 'libx264' }).args, at = args.indexOf('-map'), base = path.join(dir, `raw${runs++}`);
      execFileSync(ff.ffmpegPath, [...args.slice(0, at), '-map', args[at + 1], '-f', 'rawvideo', '-pix_fmt', 'rgb24', `${base}.rgb`, '-map', args[at + 3], '-f', 's16le', '-ac', '2', `${base}.pcm`], { stdio: ['ignore', 'ignore', 'pipe'] });
      return { video: fs.readFileSync(`${base}.rgb`), audio: fs.readFileSync(`${base}.pcm`) };
    };
    const frames = (p) => decoded(p);
    const a = frames(shared), b = frames(separate);
    assert.ok(a.video.length > 160 * 90 * 3 * 100 && a.video.equals(b.video), `identical frames (${a.video.length} vs ${b.video.length} bytes)`);
    // Sound: the same samples to within a rounding step (one continuous decode instead of one per clip).
    const same = (x, y) => x.length === y.length && x.length > 0 && (() => { for (let k = 0; k + 1 < x.length; k += 2) if (Math.abs(x.readInt16LE(k) - y.readInt16LE(k)) > 2) return false; return true; })();
    assert.ok(a.audio.length > 48000 && same(a.audio, b.audio), 'the same export sound');
    const wav = (p, name) => { const out = path.join(dir, name); execFileSync(ff.ffmpegPath, ff.buildTimelineAudioArgs(p, out, 'all')); return fs.readFileSync(out).subarray(44); };
    const wa = wav(shared, 'shared.wav'), wb = wav(separate, 'separate.wav');
    assert.ok(wa.length > 16000 && same(wa, wb), 'the same analysis sound');
    const mix = (p, name) => { const out = path.join(dir, name); execFileSync(ff.ffmpegPath, ff.buildAudioExportArgs(p, out, 'wav')); return fs.readFileSync(out).subarray(44); };
    assert.ok(same(mix(shared, 'shared-export.wav'), mix(separate, 'separate-export.wav')), 'the same audio-only export');
    const encoded = path.join(dir, 'shared.mp4');
    execFileSync(ff.ffmpegPath, ff.buildExportArgs(shared, encoded, { encoder: 'libx264' }).args.filter((x) => x !== '-progress' && x !== 'pipe:1'), { stdio: ['ignore', 'ignore', 'pipe'] });
    const out = await ff.probe(encoded);
    assert.ok(out.hasAudio && Math.abs(out.duration - (n * 0.6 - 0.2)) < 0.1, `the encoded export plays its full length: ${out.duration}`);
    console.log(`command lines for 400 clips: video ${lengths.video}, timeline audio ${lengths.timelineAudio}, audio export ${lengths.audioExport} characters; renders match one input per clip`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
