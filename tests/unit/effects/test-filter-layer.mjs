// Filter looks as layers on the Effects track (fx 'filter:<look>', src/features/effects/filters.js): the
// shared pass builder renders them for main-track and overlay clips at the layer's strength and region,
// the export treats them as shader work, and the UI names them. Usage: node tests/unit/effects/test-filter-layer.mjs
import assert from 'node:assert/strict';
import { clipHasPixelFx, isShaderFx, pixelEffectRanges, pixelPasses } from "../../../src/features/effects/apply.js";
import { filterExpr, filterFx, filterFxLook, isFilterFx } from "../../../src/features/effects/filters.js";
import { effectInfo } from "../../../src/features/effects/effects.js";

const main = { id: 'v', mediaId: 'm', in: 0, out: 6, speed: 1 };
const overlay = { id: 'o', mediaId: 'm', in: 0, out: 6, speed: 1, start: 1 };
const project = (effectClips) => ({ width: 1280, height: 720, fps: 30, media: [{ id: 'm', type: 'video', duration: 6 }], videoClips: [main], overlayClips: [overlay], effectClips });
const layer = { id: 'e', fx: filterFx('bw'), start: 0, duration: 6 };

assert.equal(isFilterFx('filter:bw'), true); assert.equal(isFilterFx('bw'), false); assert.equal(isFilterFx('filter:'), false);
assert.equal(filterFxLook('filter:tealorange'), 'tealorange');
assert.equal(isShaderFx('filter:bw'), true, 'a filter layer is shader work for the export');
assert.equal(effectInfo('filter:bw').name, 'Black & White filter');
assert.equal(effectInfo('grain').name, 'Grain');

// The look lands on the main clip and on an overlay under the layer, as the clip filter's own expression.
const look = filterExpr({ filter: 'bw', filterIntensity: 100 });
assert.deepEqual(pixelPasses(project([layer]), main, 0, 2).map((p) => p.expr), [look]);
assert.deepEqual(pixelPasses(project([layer]), overlay, 1, 2).map((p) => p.expr), [look]);
assert.deepEqual(pixelPasses(project([]), overlay, 1, 2), [], 'no layer, no pass');
assert.deepEqual(pixelPasses(project([{ ...layer, start: 4, duration: 1 }]), main, 0, 2), [], 'outside the layer\'s time: nothing');
// Strength is the intensity; 0 removes it; a region confines it.
assert.deepEqual(pixelPasses(project([{ ...layer, strength: 0.5 }]), main, 0, 2).map((p) => p.expr), [filterExpr({ filter: 'bw', filterIntensity: 50 })]);
assert.deepEqual(pixelPasses(project([{ ...layer, strength: 0 }]), main, 0, 2), []);
assert.match(pixelPasses(project([{ ...layer, region: { x: 0, y: 0, w: 0.5, h: 1, shape: 'rect' } }]), main, 0, 2)[0].expr, /st\(9,/);
assert.deepEqual(pixelPasses(project([{ ...layer, disabled: true }]), main, 0, 2), [], 'a disabled layer is skipped');
// The export's effects pass sees the layer's time range.
assert.equal(clipHasPixelFx(project([layer]), main, 0, 6), true);
assert.deepEqual(pixelEffectRanges(project([{ ...layer, start: 2, duration: 1 }]), main, 0, 6, 30), [[2, 3]]);
console.log('filter layer OK: pass builder, strength, region, ranges, naming');
