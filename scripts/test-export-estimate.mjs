// Export size estimator: exact in bitrate mode; in CRF mode monotonic across quality tiers and
// resolutions, and in a sane band for typical footage. The dialog labels CRF numbers as estimates.
import assert from 'node:assert';
import { resolveExport, estimateExport } from '../src/exportQuality.js';

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
