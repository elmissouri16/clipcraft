// Playback quality: which scaled copy of a video the player uses (the export always reads the
// original file). Pure module (no Electron imports) so it can be tested from plain Node and shared
// by settings.cjs, ffmpeg.cjs and main.cjs. src/store.js mirrors the same math for the renderer;
// scripts/test-playback-quality.mjs asserts the two agree.
//
// Levels: 'full' plays the original chain (m.proxy || m.path). The other levels cap the LONGEST
// side of the picture; a source that already fits is never upscaled and needs no copy.
const QUALITIES = ['full', 'high', 'medium', 'low'];
const QUALITY_MAX_SIDE = { high: 1280, medium: 960, low: 640 };

const isQuality = (q) => QUALITIES.includes(q);

// Stored-setting resolution, with the legacy migration: an old boolean `proxy: true` (light
// copies on) and no quality yet means 'medium'; proxy off / nothing stored means 'full'.
function qualityFromStored(data) {
  if (data && isQuality(data.quality)) return data.quality;
  return data && data.proxy === true ? 'medium' : 'full';
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// The pixel size a level's copy of a width x height video gets, or null when no copy is needed
// (level 'full', unknown dimensions, or the source already fits inside the level's cap).
function qualityTargetSize(width, height, quality) {
  const max = QUALITY_MAX_SIDE[quality];
  if (!max || !width || !height) return null;
  const long = Math.max(width, height);
  if (long <= max) return null;
  const s = max / long;
  return { width: even(width * s), height: even(height * s) };
}

// ffmpeg scale expression for a level: longest side capped at the level's max, aspect kept,
// dimensions rounded to even by ffmpeg itself (-2). Only used when qualityTargetSize() says a
// copy is needed, so it never upscales in practice. fast_bilinear: these copies are preview-only
// (the export never reads them), and the faster scaler measurably shortens the background build.
function qualityScaleFilter(quality) {
  const max = QUALITY_MAX_SIDE[quality];
  return `scale=w='if(gt(iw,ih),${max},-2)':h='if(gt(iw,ih),-2,${max})':flags=fast_bilinear`;
}

module.exports = { QUALITIES, QUALITY_MAX_SIDE, isQuality, qualityFromStored, qualityTargetSize, qualityScaleFilter };
