// The tool contract shared by every native agent (docs/design/agent-adapters.md). Agent adapters
// only translate this to their wire format; they never add, drop or rename tools.
const crypto = require('node:crypto');

// The renderer's tool declarations as JSON Schema tools every agent receives, plus the map back
// from wire names (letters, digits, _ and -, at most 64) to ClipCraft names. Each tool accepts
// retry_of: the failed operation(s) a call replaces.
// Text and schema both agents can carry unchanged. Codex drops maxItems, so each limit moves into
// the field's description (calls are still validated against the original declarations in the
// renderer); Claude rewrites the ellipsis character, so descriptions use three dots.
const plain = (text) => String(text || '').replace(/\u2026/g, '...');
function portable(schema) {
  if (Array.isArray(schema)) return schema.map(portable);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'maxItems') continue;
    out[key] = key === 'description' ? plain(value) : ['properties', 'definitions', '$defs'].includes(key) && value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, portable(v)])) : portable(value);
  }
  if (Number.isInteger(schema.maxItems)) {
    const limit = `At most ${schema.maxItems} items.`;
    out.description = out.description ? `${out.description.replace(/\s*$/, '')}${/[.!?]$/.test(out.description.trim()) ? '' : '.'} ${limit}` : limit;
  }
  return out;
}

function wireTools(declarations) {
  // Loaded here: ai.cjs loads the agent modules, which load this contract.
  const { toJsonSchema } = require('./ai.cjs');
  const aliases = new Map();
  const tools = declarations.map((tool) => {
    const schema = toJsonSchema(tool.parameters || { type: 'object' });
    const name = /^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ? tool.name
      : `${String(tool.name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)}_${crypto.createHash('sha256').update(String(tool.name)).digest('hex').slice(0, 8)}`;
    if (aliases.has(name)) throw new Error('Two native tools have the same name. Rename the configured external tools.');
    aliases.set(name, tool.name);
    const parameters = portable(schema);
    return { name, description: plain(tool.description), parameters: { ...parameters, properties: { ...parameters.properties, retry_of: { type: 'string' } } } };
  });
  return { tools, aliases };
}

// One set of limits for every agent, enforced by the session manager (nativeAgents.cjs), never by an
// agent's own options: those are set above these so they never trigger first.
const LIMITS = Object.freeze({
  toolCallsPerRequest: 300, // Codex edits have reached ~150 calls
  toolCallTimeoutMs: 15 * 60 * 1000,
  completionAttempts: 3,
  imagesPerRequest: 6,
});

// A tool result the host gives instead of running the tool (budget, timeout), in the shared result
// shape the adapters translate.
const hostError = (error) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] });

module.exports = { wireTools, LIMITS, hostError };
