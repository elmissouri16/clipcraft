import assert from 'node:assert/strict';
import { graphicDataType, graphicDataField, graphicDataError, newGraphicDataValue } from '../../../src/features/graphics/graphicData.js';
import { graphicsGuide } from '../../../src/features/agent/graphicsGuide.js';

const schema = { type: 'array', default: [], minItems: 1, maxItems: 3, itemLabel: 'name', items: {
  type: 'object', fields: {
    name: { type: 'text', label: 'Full name', default: '' },
    age: { type: 'number', label: 'Age now', min: 0, max: 150, step: 1, default: 0 },
    birth: { type: 'date', label: 'Date of birth', default: '' },
    enabled: { type: 'boolean', default: false },
    tags: { type: 'array', items: { type: 'text' } },
    details: { type: 'object', nullable: true, fields: { note: { type: 'text', default: '' } } },
  }
} };
const data = [{ name: 'A', age: 61, birth: '1965-04-04', enabled: false, tags: ['one'], details: { note: 'Keep', extra: [2, '3'] } }];
const original = JSON.stringify(data), checks = [];
function check(name, run) { run(); checks.push(name); }
check('all JSON shapes infer controls', () => {
  assert.deepEqual([null, '2', 2, false, {}, []].map(graphicDataType), ['null', 'text', 'number', 'boolean', 'object', 'array']);
  for (const value of [null, '2', 2, false, {}, [], { nested: [[null, 1, false, { text: 'yes' }]] }]) assert.equal(graphicDataError(value), '');
});
check('nested schema metadata and typed defaults', () => {
  assert.equal(graphicDataField('age', schema.items.fields.age, 61).label, 'Age now');
  assert.equal(graphicDataField('items', schema, data).itemLabel, 'name');
  assert.deepEqual(newGraphicDataValue(schema.items), { name: '', age: 0, birth: '', enabled: false, tags: [], details: { note: '' } });
  assert.equal(newGraphicDataValue({ type: 'number', min: -10, max: -2 }), -2);
  assert.equal(newGraphicDataValue({ type: 'choice', options: [false, true] }), false);
  const defaults = { type: 'object', default: { a: [] } }, created = newGraphicDataValue(defaults);
  created.a.push(1); assert.deepEqual(defaults.default, { a: [] }, 'new entries must not alias the declaration');
});
check('legacy records get blank shapes without casting strings', () => {
  assert.deepEqual(newGraphicDataValue(undefined, { age: '61', amount: 3, enabled: false, notes: null, group: { text: 'x' }, tags: ['x'] }),
    { age: '', amount: 0, enabled: false, notes: null, group: { text: '' }, tags: [] });
});
check('closed nested values and list constraints are validated', () => {
  assert.equal(graphicDataError(data, schema), '');
  assert.match(graphicDataError([], schema), /at least 1/);
  assert.match(graphicDataError([...data, ...data, ...data, ...data], schema), /at most 3/);
  assert.match(graphicDataError([{ ...data[0], age: '61' }], schema), /Age now.*number/);
  assert.match(graphicDataError([{ ...data[0], age: 151 }], schema), /Age now.*150/);
  assert.match(graphicDataError([{ ...data[0], birth: '2026-02-30' }], schema), /Date of birth.*valid date/);
  assert.equal(graphicDataError([{ ...data[0], details: null }], schema), '');
  assert.match(graphicDataError(null, { type: 'number', nullable: false }), /Choose a value/);
  assert.match(graphicDataError('value', { type: 'null' }), /empty value/);
  assert.equal(graphicDataError(false, { type: 'choice', options: [false, true] }), '');
});
check('validation preserves all fields and catches cycles/non-finite numbers', () => {
  assert.equal(JSON.stringify(data), original);
  assert.match(graphicDataError({ amount: Infinity }), /finite number/);
  for (const value of [undefined, 1n, () => 1]) assert.match(graphicDataError(value), /JSON value/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.match(graphicDataError(cyclic), /Circular/);
  const shared = { a: 1 }; assert.equal(graphicDataError({ left: shared, right: shared }), '', 'shared values are not cycles');
});
check('large and deeply nested data has explicit bounds', () => {
  assert.equal(graphicDataError(Array.from({ length: 5000 }, (_, i) => ({ name: String(i), value: i }))), '');
  assert.match(graphicDataError(Array(50001).fill(0)), /supported size/);
  let deep = 0; for (let n = 0; n < 66; n++) deep = { child: deep };
  assert.match(graphicDataError(deep), /nesting depth/);
});
check('agent input guide teaches the recursive contract', () => {
  const guide = graphicsGuide('inputs').text;
  for (const phrase of ['fields:', 'items:', 'itemLabel', 'minItems/maxItems', 'nullable:', 'Numeric-looking strings', 'photo0/photo1']) assert.ok(guide.includes(phrase), phrase);
});
console.log(`GRAPHIC DATA OK (${checks.length} checks: ${checks.join('; ')})`);
