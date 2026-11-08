import assert from 'node:assert/strict';
import { shaderTemplate } from '../../../src/features/effects/gl.js';
import { gradeExpr } from '../../../src/features/effects/grade.js';
import { fxWrap, pixelEffectRanges } from '../../../src/features/effects/apply.js';

const first = shaderTemplate(gradeExpr({ exposure: 10, contrast: 10 }), 'effect');
const second = shaderTemplate(gradeExpr({ exposure: 50, contrast: 80 }), 'effect');
assert.equal(first.key, second.key, 'slider values share the same compiled structure');
assert.notDeepEqual(first.params, second.params, 'uniform values retain the requested adjustment');
assert.notEqual(shaderTemplate('st(0,1);ld(0)', 'effect').key, shaderTemplate('st(1,1);ld(1)', 'effect').key, 'register routing remains structural');
assert.equal(shaderTemplate('st(0,1);ld(0)', 'effect').key, shaderTemplate('st(0,2);ld(0)', 'effect').key);
assert.equal(shaderTemplate('S(X,Y)', 'effect').params.length, 0);
const region = { x: .1, y: .2, w: .3, h: .4, feather: .05, shape: 'rect' };
assert.equal(shaderTemplate(fxWrap('255-S(X,Y)', region, .2), 'effect').key,
  shaderTemplate(fxWrap('255-S(X,Y)', { ...region, x: .4 }, .8), 'effect').key, 'region dragging and strength use uniforms');
const clip = { effects: ['fx_invert'], fxStrength: { fx_invert: 0 } };
assert.deepEqual(pixelEffectRanges({ effectClips: [] }, clip, 0, 20, 30), [], 'zero-strength clip effects do not schedule decoding');
assert.deepEqual(pixelEffectRanges({ effectClips: [{ fx: 'fx_invert', start: 0, duration: 20, strength: 0 }] }, {}, 0, 20, 30), []);
assert.deepEqual(pixelEffectRanges({ effectClips: [] }, { effects: ['blur'], fxStrength: { blur: 0 } }, 0, 20, 30), []);
console.log('Shader uniforms preserve structure, register routing and no-op effect planning.');
