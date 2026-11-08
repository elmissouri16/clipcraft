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
module.exports = { runImageJobs, IMAGE_CONCURRENCY, MAX_IMAGE_BATCH };
