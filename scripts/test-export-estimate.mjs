// Export size estimator: exact in bitrate mode; in CRF mode monotonic across quality tiers and
// resolutions, and in a sane band for typical footage. The dialog labels CRF numbers as estimates.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveExport, estimateExport } from '../src/exportQuality.js';
import { emptyProject, exportDuration, projectDuration } from '../src/store.js';

const proj = (w, h, fps = 30) => ({ width: w, height: h, fps, exportSettings: undefined, crf: 20 });
const withPreset = (p, preset, custom) => ({ ...p, exportSettings: { preset, custom } });
const DUR = 60;

// Monotonic across tiers at the same geometry/duration.
const tiers = ['low', 'medium', 'high', 'ultra'].map((t) => estimateExport(resolveExport(withPreset(proj(1920, 1080), t)), DUR).mb);
for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i] > tiers[i - 1], `tier sizes increase: ${tiers.map((x) => x.toFixed(1)).join(' < ')}`);
console.log('tier estimates (60s 1080p30, MB):', tiers.map((x) => x.toFixed(1)).join(' / '));

// Monotonic across resolutions at the same tier.
const res = [480, 720, 1080, 2160].map((h) => estimateExport(resolveExport(withPreset(proj(Math.round(h * 16 / 9), h), 'high')), DUR).mb);
for (let i = 1; i < res.length; i++) assert.ok(res[i] > res[i - 1], `resolution sizes increase: ${res.map((x) => x.toFixed(1)).join(' < ')}`);

// Bitrate mode is exact: (8 Mbps video + 192k audio) * 60 s / 8 = 61.44 MB.
const effB = resolveExport(withPreset(proj(1280, 720), 'custom', { mode: 'bitrate', bitrateMbps: 8, audioKbps: 192 }));
const estB = estimateExport(effB, DUR);
assert.strictEqual(estB.exact, true);
assert.ok(Math.abs(estB.mb - 61.44) < 0.01, `bitrate estimate exact (${estB.mb.toFixed(2)} MB)`);
assert.strictEqual(estB.videoMbps, 8);

// CRF sanity band: High at 1080p30 estimates 8–25 Mbps video.
const effH = resolveExport(withPreset(proj(1920, 1080), 'high'));
const estH = estimateExport(effH, DUR);
assert.strictEqual(estH.exact, false);
assert.ok(estH.videoMbps > 8 && estH.videoMbps < 25, `High 1080p30 ≈ ${estH.videoMbps.toFixed(1)} Mbps`);
// Duration scales linearly; zero duration is zero.
assert.ok(Math.abs(estimateExport(effH, 120).mb - 2 * estH.mb) < 1e-9, 'linear in duration');
assert.strictEqual(estimateExport(effH, 0).mb, 0);

console.log('EXPORT ESTIMATE OK — exact in bitrate mode, monotonic across tiers + resolutions');

// ---------------------------------------------------------------------------
// Fix 2: the Export dialog's Duration + size estimate must derive from the SAME
// duration the encoder encodes — exportDuration() (video-track layout end, the
// recurrence electron/ffmpeg.cjs totals) — never projectDuration(), which also
// counts text/audio/overlay ends. E2E evidence: SRT captions ending at 48 s over
// a 7.683 s video made the dialog claim "0:48.0 · ≈ 10.3 MB" for a 0.3 MB file.
const e2eFixture = (preset) => ({
  ...emptyProject(),
  width: 640, height: 360, fps: 30,
  exportSettings: { preset }, crf: preset === 'high' ? 18 : 23,
  media: [
    { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 5, hasAudio: true },
    { id: 'm2', path: '/x/b.mp4', type: 'video', duration: 4, hasAudio: true },
  ],
  videoClips: [
    { id: 'a', mediaId: 'm1', in: 0, out: 5, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    { id: 'b', mediaId: 'm2', in: 0, out: 3.383, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: { type: 'fade', duration: 0.7 } },
  ],
  // Caption clips overhanging the video end, exactly like an SRT import: last ends at 48 s.
  textClips: [
    { id: 't1', start: 0, duration: 2 },
    { id: 't2', start: 40, duration: 8 },
  ],
});
const fx = e2eFixture('high');
const encDur = exportDuration(fx);
assert.ok(Math.abs(encDur - 7.683) < 0.05, `encoder-basis duration is 7.683 (got ${encDur})`);
assert.strictEqual(projectDuration(fx), 48, 'projectDuration still counts the caption overhang (the old, wrong basis)');
const effHigh = resolveExport(fx);
const estFixed = estimateExport(effHigh, encDur);
const estOldBasis = estimateExport(effHigh, projectDuration(fx));
assert.ok(Math.abs(estOldBasis.mb - 10.3) < 0.6, `old basis reproduces the E2E claim ≈10.3 MB (got ${estOldBasis.mb.toFixed(1)})`);
assert.ok(estFixed.mb < estOldBasis.mb / 5, `fixed-basis estimate drops ~6x (${estOldBasis.mb.toFixed(1)} -> ${estFixed.mb.toFixed(1)} MB)`);
// Same order of magnitude as the real E2E outputs at 640x360 (High 329,180 B; Medium 223,411 B).
const realHighMB = 329180 / 1e6;
const realMedMB = 223411 / 1e6;
const ratioH = estFixed.mb / realHighMB;
assert.ok(ratioH > 0.1 && ratioH < 10, `High estimate ${estFixed.mb.toFixed(2)} MB vs real ${realHighMB.toFixed(2)} MB — same order of magnitude (ratio ${ratioH.toFixed(1)})`);
const estMed = estimateExport(resolveExport(e2eFixture('medium')), encDur);
const ratioM = estMed.mb / realMedMB;
assert.ok(ratioM > 0.1 && ratioM < 10, `Medium estimate ${estMed.mb.toFixed(2)} MB vs real ${realMedMB.toFixed(2)} MB — same order of magnitude (ratio ${ratioM.toFixed(1)})`);
// A normal project (nothing overhangs the video) estimates exactly as before.
const normal = {
  ...e2eFixture('high'),
  textClips: [{ id: 't1', start: 5, duration: 2 }], // ends at 7 s, inside the 7.683 s video
};
assert.strictEqual(exportDuration(normal), projectDuration(normal), 'no overhang: both bases agree');
assert.strictEqual(
  estimateExport(resolveExport(normal), exportDuration(normal)).mb,
  estimateExport(resolveExport(normal), projectDuration(normal)).mb,
  'no overhang: estimate unchanged',
);
console.log(`FIX 2 basis OK — encoder duration ${encDur}s; High estimate ${estFixed.mb.toFixed(2)} MB (was ${estOldBasis.mb.toFixed(1)} MB on the old basis), Medium ${estMed.mb.toFixed(2)} MB`);

// The dialog itself must read the encoder basis: every duration it shows comes
// from exportDuration(), and projectDuration is neither imported nor called.
// (The name may still appear in the header comment explaining why it is NOT used.)
const dialogSrc = fs.readFileSync(new URL('../src/components/ExportDialog.jsx', import.meta.url), 'utf8');
assert.ok(!/import\s*\{[^}]*\bprojectDuration\b/.test(dialogSrc), 'ExportDialog no longer imports projectDuration');
assert.ok(!/=\s*projectDuration\s*\(/.test(dialogSrc), 'ExportDialog no longer calls projectDuration()');
assert.ok((dialogSrc.match(/exportDuration\s*\(/g) || []).length >= 2, 'ExportDialog derives its durations from exportDuration()');
console.log('FIX 2 wiring OK — ExportDialog consumes exportDuration()');

// Live cross-check: a REAL encode of the fixture through the app's own pipeline
// must come out at the encoder-basis duration, with a size in the estimate's
// order of magnitude. (Solid-colour content, like the E2E session's clips.)
{
  const require = createRequire(import.meta.url);
  const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-estimate-'));
  const gen = (file, color, freq, dur) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:size=640x360:rate=30:duration=${dur}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, '-shortest', file]);
  const aFile = path.join(dir, 'a.mp4');
  const bFile = path.join(dir, 'b.mp4');
  gen(aFile, 'blue', 440, 5);
  gen(bFile, 'red', 880, 4);
  const media = [];
  for (const [id, p] of [['m1', aFile], ['m2', bFile]]) {
    const info = await probe(p);
    media.push({ id, path: p, name: path.basename(p), ...info });
  }
  const encProject = { ...e2eFixture('high'), media, export: effHigh };
  const outFile = path.join(dir, 'out.mp4');
  const job = runExport(encProject, outFile, () => {});
  await job.promise;
  const info = await probe(outFile);
  const realMB = fs.statSync(outFile).size / 1e6;
  assert.ok(Math.abs(info.duration - encDur) < 0.15, `real encode duration ${info.duration}s == encoder basis ${encDur}s`);
  const liveRatio = estFixed.mb / realMB;
  assert.ok(liveRatio > 0.1 && liveRatio < 10, `estimate ${estFixed.mb.toFixed(2)} MB vs real encode ${realMB.toFixed(2)} MB — same order of magnitude (ratio ${liveRatio.toFixed(1)})`);
  console.log(`FIX 2 live encode OK — ${info.duration}s, ${realMB.toFixed(2)} MB (estimate ${estFixed.mb.toFixed(2)} MB)`);
}
