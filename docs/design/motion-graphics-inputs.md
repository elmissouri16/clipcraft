# Editable motion-graphic data

The Graphic inspector builds forms for JSON values: text, finite numbers, booleans,
null, objects, primitive lists, nested/mixed lists and records. Existing `json` and
`series` declarations adapt without changing saved inputs or component code.
JSON editing is an optional advanced mode. Entering a form, expanding a group,
searching images or changing pages does not change project data.

All top-level declarations still need `default`. Nested descriptors can omit it:

```js
export const inputs = {
  people: {
    type: 'array', label: 'People', default: [],
    minItems: 0, maxItems: 8, itemLabel: 'name',
    items: {
      type: 'object', fields: {
        name: { type: 'text', label: 'Name', default: '' },
        age: { type: 'number', label: 'Age now', min: 0, max: 150, step: 1, default: 0 },
        portrait: { type: 'image', label: 'Portrait', default: '' },
        details: {
          type: 'object', nullable: true, default: null,
          fields: { caption: { type: 'text', label: 'Caption', control: 'textarea', default: '' } }
        }
      }
    }
  }
};
```

`fields` describes object properties; `items` describes each list entry. Use
`itemLabel` to name entries by a property. The usual text, number, color, boolean,
image, choice and point descriptors work inside groups and lists. `date` stores
ISO `YYYY-MM-DD` text; human-formatted legacy dates remain ordinary text.
`nullable: true` permits an explicit clear action; null is preserved until filled.
An empty untyped list offers a value-type selector. Empty objects offer Add field.

Object schemas with `fields` keep their declared structure fixed by default.
`additionalProperties: true` enables adding/removing extra properties; unknown
saved keys remain editable and are preserved regardless. Missing declared fields
can be filled explicitly. Creating entries uses item/child defaults when provided,
otherwise blank values matching the observed shape. Numeric-looking strings are
never automatically converted to numbers. Changing one field copies only that
branch; other values, nulls, types and array order remain intact.

Lists support add, remove and reorder, constrained by `minItems` and `maxItems`.
Agents must make render handle all permitted counts and null/empty states. Store
portraits inside their corresponding item rather than separate numbered inputs.
`graphicImageRefs` resolves nested image IDs in traversal order, deduplicated and
still limited to eight distinct library pictures.

Each collection renders at most twelve entries per page. Closed branches do not
mount their controls. Validation is iterative, cached per unchanged top-level
value/declaration in the inspector, and checks closed/off-page data. Limits are
50,000 visited values and 64 nesting levels. Oversized, cyclic or invalid data
produces an error and is not sent to the render queue. Numeric drafts outside
their declared range retain the previous stored value and revert on blur.
Invalid advanced JSON stays visible until fixed or explicitly closed. Changing
schema should preserve stored values; it must not silently coerce them.

Author guidance is supplied to agents by `graphics_guide inputs` and the
`add_graphic` tool description. The schema remains plain JSON in saved projects;
there is no SDK or application version change.

Validation: `test-graphic-data.mjs` covers inference, defaults, constraints,
legacy types and bounds. `test-graphic-data-ui.cjs` uses an isolated native
renderer/profile for nested edits, nullable values, dynamic keys, list limits,
reordering, large-list DOM bounds and advanced JSON. The existing graphics smoke
checks the live preview/render/save/export pipeline with these controls.
