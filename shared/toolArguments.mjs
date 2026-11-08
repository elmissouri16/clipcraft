// Shared validation at the model/host boundary. Tool implementations still check
// live project constraints; malformed provider output must never become defaults.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateToolArguments(value, schema = {}, path = 'arguments', root = schema) {
  if (schema === true) return null;
  if (schema === false) return `${path} is not allowed.`;
  if (schema.$ref?.startsWith('#/')) {
    const target = schema.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    return target ? validateToolArguments(value, target, path, root) : `${path} uses an unsupported schema reference.`;
  }
  for (const key of ['anyOf', 'oneOf']) if (schema[key]) {
    const matches = schema[key].filter(option => !validateToolArguments(value, option, path, root)).length;
    if (!matches || (key === 'oneOf' && matches !== 1)) return `${path} does not match ${key}.`;
  }
  if (schema.allOf) for (const option of schema.allOf) { const error = validateToolArguments(value, option, path, root); if (error) return error; }
  const types = (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []).map(type => type.toLowerCase());
  const matches = type => ({ object: record(value), array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isInteger(value), null: value === null })[type];
  if (types.length && !types.some(matches) && !(value === null && schema.nullable)) return `${path} must be ${types.join(' or ')}.`;
  if (schema.enum && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value))) return `${path} must be one of ${schema.enum.join(', ')}.`;
  if (Object.hasOwn(schema, 'const') && JSON.stringify(value) !== JSON.stringify(schema.const)) return `${path} has an invalid value.`;
  if (record(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return `${path}.${key} is required.`;
    for (const [key, child] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) { const error = validateToolArguments(child, property, `${path}.${key}`, root); if (error) return error; }
      else if (schema.additionalProperties === false && key !== 'retry_of') return `${path}.${key} is not allowed.`;
      else if (record(schema.additionalProperties)) { const error = validateToolArguments(child, schema.additionalProperties, `${path}.${key}`, root); if (error) return error; }
    }
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return `${path} has an invalid number of items.`;
    if (schema.items) for (let i = 0; i < value.length; i++) { const error = validateToolArguments(value[i], schema.items, `${path}[${i}]`, root); if (error) return error; }
  }
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return `${path} is out of range.`;
  if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength))) return `${path} has an invalid length.`;
  return null;
}
export function validateToolCall(call, tools) {
  if (!record(call) || typeof call.name !== 'string' || !record(call.args)) return 'Tool calls require a name and an arguments object.';
  const declaration = tools.find(tool => tool.name === call.name);
  if (!declaration) return `Tool "${call.name}" is not loaded. Load its group before requesting it.`;
  return validateToolArguments(call.args, declaration.parameters || { type: 'object' });
}
