// The editable-input contract shared by arbitrary agent-written graphics. Names and meanings
// belong to the component; the editor only interprets field types and presentation metadata.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const scalar = (value) => ['string', 'boolean'].includes(typeof value) || finite(value);
const isSpec = (value) => value && typeof value === 'object' && !Array.isArray(value) && 'default' in value;

export function graphicInputDefaults(schema = {}) {
  return Object.fromEntries(Object.entries(schema || {}).map(([key, spec]) => [key, isSpec(spec) ? spec.default : spec]));
}

export function graphicInputField(key, declaration, value) {
  const spec = isSpec(declaration) ? declaration : {};
  const inferred = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean'
    : typeof value === 'string' ? (/^#[0-9a-f]{6}$/i.test(value) ? 'color' : 'text')
      : Array.isArray(value) && value.every((row) => row && typeof row === 'object') ? 'series' : 'json';
  const type = spec.type === 'range' ? 'number' : spec.type || inferred;
  const label = typeof spec.label === 'string' && spec.label ? spec.label
    : key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  const options = (Array.isArray(spec.options) ? spec.options : []).flatMap((option) => {
    const entry = option && typeof option === 'object' ? option : { value: option, label: String(option) };
    return scalar(entry.value) ? [{ value: entry.value, label: String(entry.label ?? entry.value) }] : [];
  });
  const min = finite(spec.min) ? spec.min : type === 'point' ? 0 : undefined;
  const max = finite(spec.max) && (min === undefined || spec.max >= min) ? spec.max : type === 'point' ? 1 : undefined;
  return { type, label, min, max, step: finite(spec.step) && spec.step > 0 ? spec.step : type === 'point' ? .01 : 'any',
    slider: type === 'number' && finite(min) && finite(max) && max > min && spec.control !== 'number',
    options, description: typeof spec.description === 'string' ? spec.description : '',
    unit: typeof spec.unit === 'string' ? spec.unit : '', group: typeof spec.group === 'string' ? spec.group : '' };
}

// Keep unfinished/invalid edits in the inspector; never silently clamp a value or render the
// last valid JSON while the field on screen contains something different.
export function graphicInputError(field, value) {
  const numberError = (n) => !finite(n) ? 'Enter a number.'
    : field.min !== undefined && n < field.min ? `Use ${field.min} or more.`
      : field.max !== undefined && n > field.max ? `Use ${field.max} or less.` : '';
  if (field.type === 'number') return numberError(value);
  if (field.type === 'point') return !value || typeof value !== 'object' ? 'Enter X and Y coordinates.'
    : numberError(value.x) || numberError(value.y);
  if (field.type === 'choice' || field.type === 'select') return field.options.some((option) => Object.is(option.value, value)) ? '' : 'Choose an option.';
  if (field.type === 'image') return value === '' || value == null || typeof value === 'string' ? '' : 'Choose a picture from the library.';
  return '';
}
