// Picture/sound sync and audio-chain arithmetic of the real export builders, measured on
// generated marker sources (one white frame and one 20 ms beep on every whole source second).
// - every main-track clip holds exactly its frames on the output grid: after 70 cuts each marker
//   frame is still within one frame of its beep and of its timeline time, and the last clip is complete
//   (frame-aligned cuts, off-grid cuts, a 24 fps source in a 30 fps project, layered clips with gaps and transitions);
// - a frame-aligned clip start keeps its first frame (the input seek no longer rounds past it);
// - loudness normalization alone exports; the clip volume still applies with it on;
// - an audio stream that starts after the picture keeps that offset (export and Detach audio);
// - pitch shift keeps sound on picture over a long clip, and is right on a 44.1 kHz audio-track source;
// - classic Adjust brightness/contrast export with the player's CSS formulas.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const F = require('../../../electron/media/ffmpeg.cjs');
const { detach } = require('../../../electron/media/detach.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-export-sync-'));
const run = (bin, args, input) => { const r = spawnSync(bin, args, { encoding: input ? undefined : 'utf8', input, maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error(String(r.stderr).slice(-1500)); return r; };
const W = 64, H = 36;
function source(name, { fps = 30, dur = 145, rate = 48000 } = {}) {
  const file = path.join(dir, name);
  run(F.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${fps}:d=${dur},drawbox=c=white:t=fill:enable='lt(mod(t+0.0001\\,1)\\,${1 / fps - 0.0002})',format=yuv420p`,
    '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t\\,1)\\,0.02)\\,0.8*sin(2*PI*1000*t)\\,0)':s=${rate}:d=${dur}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-c:a', 'aac', '-b:a', '48k', '-shortest', file]);
  return file;
}
function markers(file) {
  const video = /\.wav$/.test(file) ? [] : run(F.ffprobePath, ['-v', 'error', '-f', 'lavfi', '-i', `movie='${file}',signalstats`, '-show_entries', 'frame=best_effort_timestamp_time:frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0']).stdout
    .trim().split('\n').map(l => l.split(',').map(Number)).filter(([, y]) => y > 120).map(([t]) => t).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.1);
  const audio = run(F.ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=noise=-30dB:d=0.1', '-f', 'null', '-']).stderr
    .split('\n').map(l => /silence_end: ([\d.]+)/.exec(l)).filter(Boolean).map(m => Number(m[1]));
  return { video, audio };
}
const frameCount = (file) => Number(run(F.ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).stdout.trim());
function exportVideo(project, file) {
  const { args, total } = F.buildExportArgs(project, file, { encoder: 'libx264' });
  run(F.ffmpegPath, ['-loglevel', 'error', ...args.filter((a, i) => !(a === '-progress' || args[i - 1] === '-progress' || a === '-nostats'))]);
  return total;
}
const media = (id, file, extra = {}) => ({ id, path: file, type: 'video', hasAudio: true, duration: 145, width: W, height: H, fps: 30, channels: 1, pixFmt: 'yuv420p', colorSpace: 'bt709', ...extra });
const project = (extra) => ({ width: W, height: H, fps: 30, background: '#000000', media: [], videoClips: [], audioClips: [], overlayClips: [], textClips: [], ...extra });
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pcm = (file) => { const b = spawnSync(F.ffmpegPath, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 }).stdout; return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const rms = (file, from, to) => {
  const s = pcm(file); let e = 0, n = 0;
  for (let i = Math.round(from * 48000); i < Math.min(s.length, to * 48000); i++) { e += s[i] * s[i]; n++; }
  return 10 * Math.log10(e / n);
};

(async () => {
  const s30 = source('s30.mp4'), s24 = source('s24.mp4', { fps: 24 });
  // 1) Cut-heavy edits: each clip k spans source second 2k+1 exactly once (or is a gap), its beep
  //    at least 0.2 s from either end so that the beep detector keeps neighbouring beeps apart.
  const N = 70, fr = (t) => Math.round(t * 30) / 30, rows = [];
  const cases = {
    'frame-aligned cuts': { m: media('s', s30), clips: (k) => ({ in: fr(2 * k + 0.25 + rnd() * 0.6), out: fr(2 * k + 1.1 + rnd() * 0.8) }) },
    'off-grid cuts': { m: media('s', s30), clips: (k) => ({ in: 2 * k + 0.3 + rnd() * 0.5, out: 2 * k + 1.2 + rnd() * 0.7 }) },
    '24 fps source, 30 fps project': { m: media('s', s24, { fps: 24 }), clips: (k) => ({ in: 2 * k + 0.3 + rnd() * 0.5, out: 2 * k + 1.2 + rnd() * 0.7 }) },
    'layered, gaps and transitions': { m: media('s', s30), clips: (k) => ({ in: 2 * k + 0.3 + rnd() * 0.3, out: 2 * k + 1.45 + rnd() * 0.5, ...(k % 3 === 0 ? { transform: { scale: 0.9 } } : {}), ...(k % 5 === 4 ? { transition: { type: 'fade', duration: 0.1 } } : {}) }), gaps: true },
  };
  for (const [name, c] of Object.entries(cases)) {
    const clips = [], expected = []; let t = 0;
    for (let k = 0; k < N; k++) {
      const clip = { id: 'c' + k, mediaId: 's', speed: 1, ...c.clips(k) };
      if (c.gaps && k % 7 === 6) clips.push({ id: 'g' + k, gap: true, in: 0, out: 0.4 + rnd() * 0.5 });
      clips.push(clip);
    }
    clips.forEach((clip, i) => {
      const td = i && clip.transition ? Math.min(clip.transition.duration, (clip.out - clip.in) / 2, (clips[i - 1].out - clips[i - 1].in) / 2) : 0;
      t -= td;
      if (!clip.gap) expected.push(t + (Math.round((clip.in + clip.out) / 2) - clip.in));
      t += clip.out - clip.in;
    });
    const file = path.join(dir, 'cuts.mp4');
    const total = exportVideo(project({ media: [c.m], videoClips: clips }), file);
    const { video, audio } = markers(file), frames = frameCount(file);
    fs.rmSync(file);
    const worst = { picture: 0, sound: 0, sync: 0 };
    expected.forEach((e, k) => { worst.picture = Math.max(worst.picture, Math.abs(video[k] - e)); worst.sound = Math.max(worst.sound, Math.abs(audio[k] - e)); worst.sync = Math.max(worst.sync, Math.abs(video[k] - audio[k])); });
    rows.push({ name, clips: clips.length, markers: [video.length, audio.length], expected: expected.length, frames, gridFrames: Math.round(total * 30), worstMs: Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, Math.round(v * 1000)])) });
    assert.equal(video.length, expected.length, `${name}: every clip's marker frame is in the export (the last clip complete)`);
    assert.ok(audio.length >= expected.length, `${name}: every beep is in the export`);
    assert.equal(frames, Math.round(total * 30), `${name}: the export holds the timeline's frame count`);
    assert.ok(worst.sync <= 1 / 30 + 0.002, `${name}: a marker frame strays ${Math.round(worst.sync * 1000)} ms from its beep`);
    assert.ok(worst.picture <= 1 / 30 + 0.002, `${name}: a marker frame strays ${Math.round(worst.picture * 1000)} ms from its timeline time`);
    assert.ok(worst.sound <= 0.004, `${name}: a beep strays ${Math.round(worst.sound * 1000)} ms from its timeline time`);
  }
  console.log(JSON.stringify(rows));
  // A frame-aligned start (8/30 s) keeps its own first frame: the marker lands on its exact frame.
  { const file = path.join(dir, 'start.mp4'); exportVideo(project({ media: [media('s', s30)], videoClips: [{ id: 'a', mediaId: 's', in: 8 / 30, out: 3, speed: 1 }] }), file);
    const { video } = markers(file); fs.rmSync(file); assert.ok(Math.abs(video[0] - (1 - 8 / 30)) < 0.002, `first marker at ${video[0]}, expected ${1 - 8 / 30}`); }

  // 2) Loudness normalization alone on a main-track clip (AAC sound), and the clip volume under it.
  const m = media('s', s30, { channels: 1 });
  for (const kind of ['video', 'audio']) {
    const p = project({ media: [m], videoClips: [{ id: 'a', mediaId: 's', in: 0.5, out: 6.5, speed: 1, audioFx: { loudnorm: true } }] });
    const file = path.join(dir, kind === 'video' ? 'ln.mp4' : 'ln.m4a');
    if (kind === 'video') exportVideo(p, file); else run(F.ffmpegPath, F.buildAudioExportArgs(p, file, 'm4a'));
    assert.ok(fs.statSync(file).size > 1000, `loudness normalization exports (${kind})`); fs.rmSync(file);
  }
  const noise = path.join(dir, 'pink.wav');
  run(F.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=c=pink:r=48000:a=0.2:d=6', '-ac', '2', noise]);
  const level = (clip) => { const out = path.join(dir, 'lv.wav'); run(F.ffmpegPath, F.buildAudioExportArgs({ media: [{ id: 'n', type: 'audio', path: noise, hasAudio: true, channels: 2, duration: 6 }], videoClips: [], overlayClips: [],
    audioClips: [{ id: 'x', mediaId: 'n', start: 0, in: 0, out: 6, speed: 1, ...clip }] }, out, 'wav')); const v = rms(out, 1, 3.5); fs.rmSync(out); return v; };
  const full = level({ volume: 1, audioFx: { loudnorm: true } }), quarter = level({ volume: 0.25, audioFx: { loudnorm: true } });
  assert.ok(Math.abs(full - quarter - 12.04) < 1.5, `volume 25% under loudness normalization is ${(full - quarter).toFixed(1)} dB down, not 12`);

  // 3) Audio that starts 0.3 s after the picture keeps its offset.
  const off = path.join(dir, 'off.mp4');
  run(F.ffmpegPath, ['-y', '-v', 'error', '-i', s30, '-itsoffset', '0.3', '-i', s30, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', '20', off]);
  // How far the second detected beep lies after the marker frame before it (the first beep may have no silence before it).
  const lead = (r) => r.audio[1] - Math.max(...r.video.filter((v) => v <= r.audio[1] + 0.001));
  const srcLead = lead(markers(off));
  assert.ok(srcLead > 0.25, `the offset source leads its picture by ${srcLead}`);
  for (const [inn, out] of [[0, 6], [10.5, 16]]) {
    const p = project({ media: [media('s', off, { duration: 20 })], videoClips: [{ id: 'a', mediaId: 's', in: inn, out, speed: 1 }] });
    const file = path.join(dir, 'off-out.mp4'); exportVideo(p, file);
    const r = markers(file); fs.rmSync(file);
    assert.ok(Math.abs(lead(r) - srcLead) < 0.004, `in=${inn}: export sound is ${lead(r).toFixed(3)} s after its picture, source ${srcLead.toFixed(3)}`);
    const wav = path.join(dir, 'off-out.wav'); run(F.ffmpegPath, F.buildAudioExportArgs(p, wav, 'wav'));
    const a = markers(wav).audio; fs.rmSync(wav);
    assert.ok(Math.abs(a[1] - r.audio[1]) < 0.004, `in=${inn}: audio export beep at ${a[1]}, video export at ${r.audio[1]}`);
  }
  const det = await detach({ path: off, duration: 20 }, { from: 0, to: 6, cacheDir: path.join(dir, 'detach'), ffmpegPath: F.ffmpegPath });
  const srcBeeps = markers(off).audio, detBeeps = markers(det).audio;
  assert.ok(srcBeeps.slice(0, 3).every((b) => detBeeps.some((d) => Math.abs(d - b) < 0.004)), `detached audio beeps at ${detBeeps.slice(0, 3)}, source ${srcBeeps.slice(0, 3)}`);

  // 4) Pitch shift: no drift over a long clip; right pitch and length on a 44.1 kHz audio-track source.
  { const file = path.join(dir, 'pitch.mp4');
    exportVideo(project({ media: [media('s', s30)], videoClips: [{ id: 'a', mediaId: 's', in: 0.5, out: 140.5, speed: 1, audioFx: { pitch: 7 } }] }), file);
    const r = markers(file); fs.rmSync(file);
    const first = r.audio[0] - r.video[0], last = r.audio[r.video.length - 1] - r.video[r.video.length - 1];
    assert.ok(Math.abs(last - first) < 0.015, `pitch-shifted sound drifts ${Math.round((last - first) * 1000)} ms from its picture over 140 s`); }
  const tone = path.join(dir, 'tone44.wav');
  run(F.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:r=44100:d=4', tone]);
  const pitched = path.join(dir, 'pitched.wav');
  run(F.ffmpegPath, F.buildAudioExportArgs({ media: [{ id: 't', type: 'audio', path: tone, hasAudio: true, channels: 1, duration: 4 }], videoClips: [], overlayClips: [], audioClips: [{ id: 'x', mediaId: 't', start: 0, in: 0, out: 4, speed: 1, audioFx: { pitch: 12 } }] }, pitched, 'wav'));
  { const s = pcm(pitched); let last = 0, zc = 0; s.forEach((v, i) => { if (Math.abs(v) > 1e-3) last = i; }); for (let i = 48001; i < 96000; i++) if (s[i - 1] < 0 && s[i] >= 0) zc++;
    assert.ok(Math.abs(zc - 880) <= 3, `+12 semitones of 440 Hz at 44.1 kHz exports at ${zc} Hz`); assert.ok(Math.abs(last / 48000 - 4) < 0.05, `the pitched clip lasts ${(last / 48000).toFixed(3)} s`); }

  // 5) Classic Adjust: brightness multiplies and contrast pivots on mid-grey per channel, like the CSS preview.
  const px = [[0, 0, 0], [32, 32, 32], [128, 128, 128], [230, 230, 230], [200, 40, 40], [40, 160, 60]];
  const input = Buffer.from(px.flat());
  const css = (rgb, a) => rgb.map((v) => { let x = Math.min(1, Math.max(0, v / 255 * (1 + (a.brightness || 0)))); x = Math.min(1, Math.max(0, (x - 0.5) * (a.contrast ?? 1) + 0.5)); return Math.round(x * 255); });
  for (const adjust of [{ brightness: 0.3 }, { brightness: -0.3 }, { contrast: 1.5 }, { brightness: 0.2, contrast: 0.7 }]) {
    const out = run(F.ffmpegPath, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${px.length}x1`, '-i', '-', '-vf', `${F.lookFilters({ adjust }, px.length, 1).join(',')},format=rgb24`, '-f', 'rawvideo', '-'], input).stdout;
    px.forEach((p, i) => css(p, adjust).forEach((v, ch) => assert.ok(Math.abs(out[i * 3 + ch] - v) <= 1, `${JSON.stringify(adjust)} on ${p}: export ${[...out.subarray(i * 3, i * 3 + 3)]}, preview ${css(p, adjust)}`)));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('export sync OK');
})().catch((error) => { console.error(error); fs.rmSync(dir, { recursive: true, force: true }); process.exitCode = 1; });
