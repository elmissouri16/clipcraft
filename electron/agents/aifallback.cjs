// CraftAI fallback: when the chosen AI fails (overloaded, rate limited, key or model refused, unreachable),
// the same step goes to the next provider that has a saved key and can use the editing tools.
// Order and names come from the preset table (shared/providers.json): keyed API providers as listed, Ollama last.
const providers = require('./providers.cjs');
const TOOL_PROVIDERS = providers.toolProviders();
const NAMES = providers.shortNames();

// Short reason for the chat ("Gemini was busy, switched to Groq").
function reason(e) {
  const s = e && e.status;
  if (s === 429) return 'rate limit reached';
  if ([500, 502, 503, 504].includes(s)) return 'overloaded';
  if (s === 401 || s === 403) return 'key refused';
  if (s === 404) return 'model not found';
  if (s === 0 && /reach/i.test(e.message || '')) return 'unreachable';
  return 'failed';
}

// Providers to try, in order: the one asked for (or the active one), then the others with a saved key.
// hasKey(provider) tells whether a key is saved.
function fallbackOrder(first, hasKey) {
  const rest = TOOL_PROVIDERS.filter((p) => p !== first && hasKey(p));
  return [first, ...rest];
}

// Runs step(cfg) with each provider in turn until one answers or fails with something other than the service.
// Returns { result, provider, failed: [{ provider, reason, error }] }; throws the first error when all fail.
async function withFallback(order, getCfg, step) {
  const failed = [];
  for (const provider of order) {
    try {
      const result = await step(getCfg(provider));
      return { result, provider, failed };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // Only a provider's own failure (an AiError carries the service's status) moves the step on. The editor's
      // errors (a bug, an empty or blocked reply flagged noFallback) are the answer, never a reason to switch.
      if (!Number.isInteger(e?.status) || e.noFallback) {
        if (failed.length) e.message = `${e.message}\n\nAlso tried: ${failed.map((f) => `${NAMES[f.provider] || f.provider} (${f.reason})`).join(', ')}.`;
        throw e;
      }
      failed.push({ provider, reason: reason(e), error: e });
    }
  }
  const first = failed[0].error;
  if (failed.length > 1) {
    first.message = `${first.message}\n\nAlso tried: ${failed.slice(1).map((f) => `${NAMES[f.provider] || f.provider} (${f.reason})`).join(', ')}.`;
  }
  throw first;
}

module.exports = { TOOL_PROVIDERS, NAMES, fallbackOrder, withFallback, reason };
