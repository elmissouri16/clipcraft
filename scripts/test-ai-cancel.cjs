// Cancellation aborts an API request without retrying/falling back to another provider.
const assert = require('node:assert/strict');
const { agentStep } = require('../electron/ai.cjs');
const { withFallback } = require('../electron/aifallback.cjs');
const originalFetch = global.fetch;
(async () => {
  try {
    let hits = 0;
    global.fetch = async (_url, options) => {
      hits++;
      return new Promise((resolve, reject) => {
        const stop = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (options.signal.aborted) stop();
        else options.signal.addEventListener('abort', stop, { once: true });
      });
    };
    const controller = new AbortController();
    const request = withFallback(['openai', 'gemini'], (provider) => ({ provider, model: 'test', apiKey: 'fake' }),
      (cfg) => agentStep(cfg, { system: '', contents: [], tools: [], signal: controller.signal }));
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(hits, 1);
    await assert.rejects(agentStep({ provider: 'codex-sdk' }, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(hits, 1, 'an already-stopped SDK step never starts a provider');
    console.log('AI cancellation ok (aborts request, no retry or fallback, stopped SDK does not start)');
  } finally { global.fetch = originalFetch; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
