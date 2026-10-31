// Layer state in the real export (Stage B proof): exports run through renderable() — the
// exact project App hands the pipeline — and the results are MEASURED: frame pixels for
// hidden layers, per-frequency band energy for muted / solo layers.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { renderable } = await import('../src/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-layer-av-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const blueTone = path.join(dir, 'blue-tone.mp4'); // blue picture + 440 Hz
  const blueSilent = path.join(dir, 'blue-silent.mp4'); // blue picture, no sound
  const redTone = path.join(dir, 'red-tone.mp4'); // red picture + 880 Hz
  const t440 = path.join(dir, 'tone440.wav');
  const t880 = path.join(dir, 'tone880.wav');
  gen(['-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', blueTone]);
  gen(['-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=30:duration=6', '-pix_fmt', 'yuv420p', blueSilent]);
  gen(['-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-shortest', '-pix_fmt', 'yuv420p', redTone]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-ar', '48000', t440]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-ar', '48000', t880]);
  const media = [];
  for (const [id, p] of [['mb', blueTone], ['ms', blueSilent], ['mr', redTone], ['t4', t440], ['t8', t880]]) {
    media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
  }
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const proj = (patch) => ({
    name: 'layer-av', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#000000', media,
    videoClips: [], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], ...patch,
  });
  const exportOne = async (p, name) => {
    const out = path.join(dir, name);
    await runExport(renderable(p), out, () => {}).promise;
    return out;
  };
  // Mean RGB of one frame.
  const frameRGB = (file, t) => {
    const buf = execFileSync(ffmpegPath, ['-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
    let r = 0; let g = 0; let b = 0; const n = buf.length / 3;
    for (let i = 0; i < buf.length; i += 3) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
    return { r: r / n, g: g / n, b: b / n };
  };
  // Mean volume (dB) of one frequency band of the whole file. A single wide bandpass
  // leaks a loud neighbour tone an octave away at ~-30 dB; three cascaded narrow passes
  // push that leakage under -70 dB while a real tone in-band still reads ~-21 dB.
  const bandDb = (file, freq) => {
    const bp = `bandpass=frequency=${freq}:width_type=o:width=0.3`;
    const r = spawnSync(ffmpegPath, ['-i', file, '-af', `${bp},${bp},${bp},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /mean_volume:\s*(-?[\d.]+|-inf)/.exec(r.stderr || '');
    return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : -120;
  };

  // --- Picture: overlay visible vs its layer hidden; main layer hidden -> background.
  const withOverlay = (layerState) => proj({
    videoClips: [{ ...base, id: 'v1', mediaId: 'ms', in: 0, out: 4 }],
    overlayClips: [{ ...base, id: 'o1', mediaId: 'mr', start: 1, in: 0, out: 2, layer: 0, transform: { scale: 1, x: 0, y: 0 } }],
    ...(layerState ? { layerState } : {}),
  });
  const outA = await exportOne(withOverlay(null), 'visible.mp4');
  const cA = frameRGB(outA, 2);
  ok(cA.r > 150 && cA.b < 90, `overlay visible: frame at 2s is red (r=${cA.r.toFixed(0)}, b=${cA.b.toFixed(0)})`);
  const outB = await exportOne(withOverlay({ 'overlay:0': { hidden: true } }), 'hidden.mp4');
  const cB = frameRGB(outB, 2);
  ok(cB.b > 120 && cB.r < 90, `overlay layer hidden: frame at 2s is the blue main clip (r=${cB.r.toFixed(0)}, b=${cB.b.toFixed(0)})`);
  const outC = await exportOne(withOverlay({ 'video:0': { hidden: true } }), 'mainhidden.mp4');
  const cC = frameRGB(outC, 0.5);
  ok(cC.r < 40 && cC.b < 40, `main layer hidden: frame at 0.5s is background black (r=${cC.r.toFixed(0)}, b=${cC.b.toFixed(0)})`);
  const cC2 = frameRGB(outC, 2);
  ok(cC2.r > 150, 'main layer hidden: the overlay still renders over the gap');

  // --- Sound: two audio layers (440 on L0, 880 on L1) over a silent main clip.
  const withAudio = (layerState) => proj({
    videoClips: [{ ...base, id: 'v1', mediaId: 'ms', in: 0, out: 4 }],
    audioClips: [
      { id: 'a1', mediaId: 't4', start: 0, in: 0, out: 4, volume: 0.9, layer: 0 },
      { id: 'a2', mediaId: 't8', start: 0, in: 0, out: 4, volume: 0.9, layer: 1 },
    ],
    layers: { audio: 2 },
    ...(layerState ? { layerState } : {}),
  });
  const outD = await exportOne(withAudio(null), 'both.mp4');
  ok(bandDb(outD, 440) > -45 && bandDb(outD, 880) > -45, `no state: both tones in the export (440=${bandDb(outD, 440).toFixed(1)} dB, 880=${bandDb(outD, 880).toFixed(1)} dB)`);
  const outE = await exportOne(withAudio({ 'audio:0': { muted: true } }), 'muted.mp4');
  ok(bandDb(outE, 440) < -60 && bandDb(outE, 880) > -45, `audio layer 0 muted: 440 gone (=${bandDb(outE, 440).toFixed(1)} dB), 880 stays`);
  const outF = await exportOne(withAudio({ 'audio:1': { solo: true } }), 'solo.mp4');
  ok(bandDb(outF, 880) > -45 && bandDb(outF, 440) < -60, `audio layer 1 solo: only 880 sounds (440=${bandDb(outF, 440).toFixed(1)} dB)`);

  // --- Sound: the main layer's own tone obeys mute (the picture still exports).
  const mainTone = (layerState) => proj({
    videoClips: [{ ...base, id: 'v1', mediaId: 'mb', in: 0, out: 4 }],
    ...(layerState ? { layerState } : {}),
  });
  const outG = await exportOne(mainTone({ 'video:0': { muted: true } }), 'mainmuted.mp4');
  ok(bandDb(outG, 440) < -60, `main layer muted: its tone is gone (=${bandDb(outG, 440).toFixed(1)} dB)`);
  const infoG = await probe(outG);
  ok(Math.abs(infoG.duration - 4) < 0.3 && infoG.width === 320, 'main layer muted: the video itself exported in full');

  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
