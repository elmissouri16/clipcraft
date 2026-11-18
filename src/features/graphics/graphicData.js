import { graphicInputField, graphicInputError } from './graphicInputs.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const EMPTY = Object.freeze({});
export const GRAPHIC_DATA_PAGE_SIZE = 12;

export function graphicDataType(value) {
  return value == null ? 'null' : Array.isArray(value) ? 'array' : object(value) ? 'object'
    : typeof value === 'string' ? 'text' : typeof value;
}

// Child descriptors may omit default: the stored value determines the control until edited.
export function graphicDataField(key, declaration, value) {
  const spec = object(declaration) ? declaration : {};
  const base = graphicInputField(String(key), { default: value, ...spec }, value);
  const type = !spec.type || spec.type === 'json' ? graphicDataType(value)
    : spec.type === 'series' ? 'array' : spec.type === 'string' ? 'text' : base.type;
  const minItems = Number.isInteger(spec.minItems) && spec.minItems >= 0 ? spec.minItems : 0;
  return { ...base, type, fields: object(spec.fields) ? spec.fields : EMPTY,
    items: object(spec.items) ? spec.items : undefined,
    itemLabel: typeof spec.itemLabel === 'string' ? spec.itemLabel : '',
    minItems, maxItems: Number.isInteger(spec.maxItems) && spec.maxItems >= minItems ? spec.maxItems : Infinity,
    additionalProperties: spec.additionalProperties === true || !object(spec.fields) && spec.additionalProperties !== false,
    nullable: typeof spec.nullable === 'boolean' ? spec.nullable : value === null || spec.default === null,
    control: spec.control, declaration: spec };
}

// New entries use explicit item defaults, otherwise a blank copy of the observed shape.
// Existing values are never normalized, coerced or patched merely by displaying the form.
export function newGraphicDataValue(declaration, sample, depth = 0) {
  const spec = object(declaration) ? declaration : {};
  if (own(spec, 'default')) return structuredClone(spec.default);
  if (depth > 32) return null;
  const field = graphicDataField('', spec, sample);
  if (field.type === 'array') return [];
  if (field.type === 'object') {
    const keys = [...new Set([...Object.keys(object(sample) ? sample : {}), ...Object.keys(field.fields)])];
    return Object.fromEntries(keys.map(key => [key, newGraphicDataValue(field.fields[key], sample?.[key], depth + 1)]));
  }
  if (field.type === 'number') return Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, 0));
  if (field.type === 'boolean') return false;
  if (field.type === 'choice' || field.type === 'select') return field.options[0]?.value ?? '';
  if (field.type === 'point') return { x: .5, y: .5 };
  if (field.type === 'color') return '#ffffff';
  if (field.type === 'null') return null;
  return '';
}

// Iterative validation checks closed/off-page branches too; rendering remains lazy.
export function graphicDataError(value, declaration) {
  const stack = [{ value, declaration, path: '', depth: 0 }], ancestors = new WeakSet();
  let visited = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item.exit) { ancestors.delete(item.value); continue; }
    if (++visited > 50000 || item.depth > 64) return 'This data exceeds the supported size or nesting depth.';
    const field = graphicDataField('', item.declaration, item.value), actual = graphicDataType(item.value);
    const fail = message => item.path ? `${item.path}: ${message}` : message;
    if (item.value === undefined || !['object', 'string', 'number', 'boolean'].includes(typeof item.value)) return fail('Use a JSON value.');
    if (actual === 'null') {
      if (field.nullable || field.type === 'null') continue;
      return fail('Choose a value.');
    }
    if (field.type === 'null') return fail('Use an empty value.');
    if (typeof item.value === 'number' && !finite(item.value)) return fail('Enter a finite number.');
    if (['text', 'color', 'date', 'image'].includes(field.type) && typeof item.value !== 'string') return fail('Enter text.');
    if (field.type === 'boolean' && typeof item.value !== 'boolean') return fail('Choose on or off.');
    if (field.type === 'array' && actual !== 'array') return fail('Use a list.');
    if (field.type === 'object' && actual !== 'object') return fail('Use an object.');
    const error = graphicInputError(field, item.value);
    if (error) return fail(error);
    if (field.type === 'date' && item.value && (!/^\d{4}-\d{2}-\d{2}$/.test(item.value)
      || !Number.isFinite(Date.parse(item.value + 'T00:00:00Z'))
      || new Date(item.value + 'T00:00:00Z').toISOString().slice(0, 10) !== item.value)) return fail('Choose a valid date.');
    if (actual !== 'object' && actual !== 'array') continue;
    if (ancestors.has(item.value)) return fail('Circular data cannot be edited.');
    ancestors.add(item.value); stack.push({ value: item.value, exit: true });
    if (actual === 'array') {
      if (item.value.length + visited > 50000) return fail('This data exceeds the supported size.');
      if (item.value.length < field.minItems) return fail(`Use at least ${field.minItems} entries.`);
      if (item.value.length > field.maxItems) return fail(`Use at most ${field.maxItems} entries.`);
      for (let index = item.value.length - 1; index >= 0; index--) stack.push({ value: item.value[index], declaration: field.items,
        path: `${item.path}${item.path ? ' · ' : ''}${index + 1}`, depth: item.depth + 1 });
    } else {
      const keys = Object.keys(item.value);
      if (keys.length + visited > 50000) return fail('This data exceeds the supported size.');
      for (const key of keys.reverse()) {
        const child = graphicDataField(key, field.fields[key], item.value[key]);
        stack.push({ value: item.value[key], declaration: field.fields[key],
          path: `${item.path}${item.path ? ' · ' : ''}${child.label}`, depth: item.depth + 1 });
      }
    }
  }
  return '';
}
