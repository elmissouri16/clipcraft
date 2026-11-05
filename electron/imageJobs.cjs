// Native image generation is expensive; bound concurrent CLI jobs and keep
// results in scene order even when later images finish first.
const IMAGE_CONCURRENCY = 3;
const MAX_IMAGE_BATCH = 12;
async function runImageJobs(scenes, generate, signal) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > MAX_IMAGE_BATCH) throw new Error(`Provide 1–${MAX_IMAGE_BATCH} image scenes.`);
  const results = new Array(scenes.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, scenes.length) }, async () => {
    while (next < scenes.length) {
      const index = next++;
      if (signal?.aborted) { results[index] = { canceled: true, error: 'Image generation stopped.' }; continue; }
      try { results[index] = await generate(scenes[index]); }
      catch (e) { results[index] = { error: e.message || String(e) }; }
      if (signal?.aborted) results[index] = { canceled: true, error: 'Image generation stopped.' };
    }
  }));
  return results;
}
module.exports = { runImageJobs, IMAGE_CONCURRENCY, MAX_IMAGE_BATCH };
