const fs = require('node:fs');
// Native image generation is expensive; bound concurrent CLI jobs and keep
// results in scene order even when later images finish first.
const IMAGE_CONCURRENCY = 3;
const MAX_IMAGE_BATCH = 12;
async function runImageJobs(scenes, generate, signal, onProgress = () => {}) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > MAX_IMAGE_BATCH) throw new Error(`Provide 1–${MAX_IMAGE_BATCH} image scenes.`);
  const results = new Array(scenes.length);
  const states = scenes.map(() => 'queued');
  const publish = (index, status, result) => {
    states[index] = status;
    // Progress is observational: a closed renderer cannot fail a generation.
    try { onProgress({ index, status, total: scenes.length,
      completed: states.filter(state => ['done', 'error', 'canceled'].includes(state)).length,
      failed: states.filter(state => state === 'error').length,
      active: states.filter(state => state === 'running').length,
      ...(result ? { result } : {}) }); } catch {}
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, scenes.length) }, async () => {
    while (next < scenes.length) {
      const index = next++;
      if (signal?.aborted) { results[index] = { canceled: true, error: 'Image generation stopped.' }; publish(index, 'canceled', results[index]); continue; }
      publish(index, 'running');
      try { results[index] = await generate(scenes[index], index); }
      catch (e) { results[index] = { error: e.message || String(e) }; }
      if (signal?.aborted) results[index] = { canceled: true, error: 'Image generation stopped.' };
      publish(index, results[index]?.canceled ? 'canceled' : results[index]?.error ? 'error' : 'done', results[index]);
    }
  }));
  return results;
}
// One scene image from Codex's imagegen, fitted to the project canvas. deps: { generateImage, fitImageFrame,
// probeAll, outputDir }. Only the file the project uses stays on disk.
async function sceneImage(cfg, req, signal, { generateImage, fitImageFrame, probeAll, outputDir }) {
  if (!req || !/^\d{1,4}:\d{1,4}$/.test(req.ratio || '')) return { error: 'Provide the project aspect ratio for the scene image.' };
  require('../media/imageFrame.cjs').validateImageFrame(req.width, req.height);
  const image = await generateImage(cfg, { prompt: req.prompt, ratio: req.ratio, width: req.width, height: req.height,
    referencePaths: req.referencePaths || [], transparentBackground: req.transparentBackground === true, outputDir, signal });
  // Only the file the project uses stays: the unframed original once the framed copy exists, and every
  // file of a scene that is not returned (stopped, unreadable, wrong size, framing failed).
  const made = new Set([image.path]);
  let kept = null;
  try {
    if (signal.aborted) return { canceled: true, error: 'Image generation stopped.' };
    const framed = await fitImageFrame(image.path, { width: req.width, height: req.height, signal });
    made.add(framed.path);
    if (signal.aborted) return { canceled: true, error: 'Image generation stopped.' };
    const [media] = await probeAll([framed.path]);
    if (!media || media.error || media.type !== 'image') return { error: 'Codex produced an image that ClipCraft could not read.' };
    if (media.width !== req.width || media.height !== req.height) return { error: 'The generated image does not match the project dimensions.' };
    const title = String(req.prompt).trim().split(/\s+/).slice(0, 7).join(' ').replace(/[\\/:*?"<>|]+/g, '');
    kept = framed.path;
    return { ...media, name: `${title || 'Generated scene'}.png`, origin: 'codex-image',
      generation: { provider: 'codex-sdk', skill: 'imagegen', prompt: image.prompt,
        width: req.width, height: req.height, nativeWidth: framed.nativeWidth, nativeHeight: framed.nativeHeight } };
  } finally {
    for (const file of made) if (file !== kept) { try { fs.rmSync(file, { force: true }); } catch { /* left for the next cleanup */ } }
  }
}
module.exports = { runImageJobs, sceneImage, IMAGE_CONCURRENCY, MAX_IMAGE_BATCH };
