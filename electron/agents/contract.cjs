// The tool contract shared by every native agent (docs/design/agent-adapters.md). Agent adapters
// only translate this to their wire format; they never add, drop or rename tools.
const crypto = require('node:crypto');
const { toJsonSchema } = require('./ai.cjs');

// The renderer's tool declarations as JSON Schema tools every agent receives, plus the map back
// from wire names (letters, digits, _ and -, at most 64) to ClipCraft names. Each tool accepts
// retry_of: the failed operation(s) a call replaces.
function wireTools(declarations) {
  const aliases = new Map();
  const tools = declarations.map((tool) => {
    const schema = toJsonSchema(tool.parameters || { type: 'object' });
    const name = /^[A-Za-z0-9_-]{1,64}$/.test(tool.name) ? tool.name
      : `${String(tool.name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48)}_${crypto.createHash('sha256').update(String(tool.name)).digest('hex').slice(0, 8)}`;
    if (aliases.has(name)) throw new Error('Two native tools have the same name. Rename the configured external tools.');
    aliases.set(name, tool.name);
    return { name, description: tool.description || '', parameters: { ...schema, properties: { ...schema.properties, retry_of: { type: 'string' } } } };
  });
  return { tools, aliases };
}

module.exports = { wireTools };
