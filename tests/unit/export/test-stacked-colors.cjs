// Transparent layers must not recolor or darken the picture beneath them.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-stacked-colors-'));
  const width = 192, height = 320, source = path.join(dir, 'gradient.png');
  // Include dark skin-like tones, teal, warm highlights and neutral ramps.
  const colors = [[20, 12, 8], [125, 70, 42], [16, 72, 85], [240, 170, 70], [160, 160, 160], [250, 250, 250]];
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = colors[Math.min(colors.length - 1, Math.floor(x / width * colors.length))];
    for (let ch = 0; ch < 3; ch++) rgb[(y * width + x) * 3 + ch] = Math.round(c[ch] * (.35 + .65 * y / (height - 1)));
  }
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', '-', '-frames:v', '1', source], { input: rgb });
  const clip = { id: 'main', mediaId: 'm', in: 0, out: .6, speed: 1 };
  const base = { width, height, fps: 10, background: '#000000', media: [{ ...await ff.probe(source), id: 'm', path: source }], videoClips: [clip], overlayClips: [], audioClips: [], textClips: [] };
  const frame = file => execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', '0.1', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const render = async (p, name) => { const file = path.join(dir, name + '.mp4'); const { args } = ff.buildExportArgs(p, file, { encoder: 'libx264' }); execFileSync(ff.ffmpegPath, args, { stdio: 'pipe' }); return frame(file); };
  const reference = await render(base, 'reference'), results = [];
  let sourceError = 0;
  for (let i = 0; i < rgb.length; i++) sourceError += Math.abs(rgb[i] - reference[i]);
  assert.ok(sourceError / rgb.length < 4, 'the main image also preserves the original RGB colors');
  for (const blend of ['normal', 'screen', 'difference']) {
    // Future overlays are transparent at the sampled time but still traverse
    // the entire graph, as in a long project with many B-roll insertions.
    const overlayClips = Array.from({ length: 20 }, (_, i) => ({ ...clip, id: `o${i}`, start: .3, out: .2, blend }));
    const actual = await render({ ...base, overlayClips }, blend);
    let sum = 0, shadowSum = 0, shadowCount = 0;
    for (let i = 0; i < actual.length; i++) { const error = Math.abs(actual[i] - reference[i]); sum += error; if (reference[i] < 64) { shadowSum += error; shadowCount++; } }
    const result = { blend, meanRgbError: sum / actual.length, meanShadowError: shadowSum / shadowCount };
    results.push(result);
    fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(results, null, 2));
    assert.ok(result.meanRgbError < 4 && result.meanShadowError < 4, JSON.stringify(result));
  }
  console.log('Stacked transparent overlays preserve color and shadows; evidence: ' + dir);
})().catch(error => { console.error(error); process.exitCode = 1; });
