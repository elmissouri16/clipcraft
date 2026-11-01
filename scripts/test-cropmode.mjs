// Visual crop math: aspect presets + aspect-locked drags (src/cropMath.js). Pure, no app.
// Usage: node scripts/test-cropmode.mjs
import assert from 'assert/strict';
import { CROP_ASPECTS, aspectRatioOf, keptAspect, clampCrop, cropForAspect, dragCrop } from '../src/cropMath.js';

const near = (a, b, tol = 0.002) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

// The specced preset list, in order.
assert.deepEqual(CROP_ASPECTS.map((a) => a.id), ['free', 'original', '1:1', '4:5', '5:4', '16:9', '9:16', '4:3', '3:4', '21:9']);
assert.equal(aspectRatioOf('free', 1920, 1080), null);
near(aspectRatioOf('original', 1920, 1080), 16 / 9);
near(aspectRatioOf('9:16', 1920, 1080), 9 / 16);

// 9:16 preset on a 16:9 source: symmetric center crop, kept aspect 0.5625.
{
  const c = cropForAspect({ l: 0, t: 0, r: 0, b: 0 }, 1920, 1080, 9 / 16);
  near(keptAspect(c, 1920, 1080), 0.5625);
  near(c.l, c.r); // symmetric
  assert.equal(c.t, 0); assert.equal(c.b, 0); // only the width shrank
  near(1 - c.l - c.r, 0.31640625); // kh=1 -> kw = R*kh*mh/mw = 0.5625*1080/1920
}
// 16:9 preset on a 9:16 portrait source: only the height shrinks.
{
  const c = cropForAspect({ l: 0, t: 0, r: 0, b: 0 }, 720, 1280, 16 / 9);
  near(keptAspect(c, 720, 1280), 16 / 9);
  near(c.t, c.b);
  assert.equal(c.l, 0); assert.equal(c.r, 0);
}
// Original on an already-cropped clip: restores the source aspect with a minimal extra cut.
{
  const start = { l: 0.3, t: 0, r: 0.3, b: 0 }; // kept aspect = (0.4*1920)/1080 = 0.711
  const c = cropForAspect(start, 1920, 1080, 1920 / 1080);
  near(keptAspect(c, 1920, 1080), 16 / 9);
  assert.ok(c.l >= 0.3 && c.r >= 0.3, 'preset never un-crops');
  assert.ok(c.t > 0, 'height took the adjustment');
}
// Already at the target aspect: no change.
{
  const start = { l: 0.1, t: 0.1, r: 0.1, b: 0.1 };
  const c = cropForAspect(start, 1000, 1000, 1);
  assert.deepEqual(c, start);
}
// Free drag: edges follow the pointer and clamp (edge <= 0.9, sums <= 0.9, kept >= 10%).
{
  const c = dragCrop({ l: 0, t: 0, r: 0, b: 0 }, 'r', { x: 0.75, y: 0.5 }, null, 1920, 1080);
  near(c.r, 0.25); assert.equal(c.l, 0);
  const c2 = dragCrop({ l: 0.2, t: 0, r: 0, b: 0 }, 'l', { x: 0.95, y: 0.5 }, null, 1920, 1080);
  assert.ok(c2.l + c2.r <= 0.9 + 1e-9, 'opposite sum clamped');
  assert.ok(1 - c2.l - c2.r >= 0.1 - 1e-9, 'kept width floor');
  const c3 = dragCrop({ l: 0, t: 0, r: 0, b: 0 }, 'tl', { x: 0.3, y: 0.2 }, null, 1920, 1080);
  near(c3.l, 0.3); near(c3.t, 0.2); assert.equal(c3.r, 0); assert.equal(c3.b, 0);
}
// Aspect-locked corner drag: kept aspect preserved, anchored on the opposite corner.
{
  const start = { l: 0, t: 0, r: 0, b: 0 };
  const c = dragCrop(start, 'br', { x: 0.6, y: 0.9 }, 1, 1000, 1000); // 1:1 on a square source
  near(keptAspect(c, 1000, 1000), 1);
  near(c.l, 0); near(c.t, 0); // anchored top-left
  // width from pointer 0.6 -> height 0.6 too (square): b = 0.4
  near(1 - c.t - c.b, 0.6);
}
// Aspect-locked side drag: height follows the width around the kept centre.
{
  const start = { l: 0.1, t: 0.1, r: 0.1, b: 0.1 }; // kept 0.8 x 0.8 on 16:9 source
  const R = keptAspect(start, 1920, 1080);
  const c = dragCrop(start, 'r', { x: 0.7, y: 0.5 }, R, 1920, 1080);
  near(keptAspect(c, 1920, 1080), R);
  near(c.l, 0.1); // fixed edge stayed
  near((c.t + (1 - c.b)) / 2, 0.5, 0.01); // still vertically centred
}
// Clamps hold under an extreme preset (21:9 target from a nearly-square heavy crop).
{
  const c = cropForAspect({ l: 0.4, t: 0.4, r: 0.4, b: 0.4 }, 1000, 900, 21 / 9);
  assert.ok(c.l + c.r <= 0.9 + 1e-9 && c.t + c.b <= 0.9 + 1e-9);
  assert.ok(1 - c.l - c.r >= 0.1 - 1e-9 && 1 - c.t - c.b >= 0.1 - 1e-9);
}
console.log('CROPMODE OK');
