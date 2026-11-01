// The ONE source of truth for where a clip's picture is displayed on the stage.
// Every consumer that maps between what the user sees and the clip's source frame — the
// crop overlay, the transform box, the chroma colour sampler, the tracking pick — derives
// its geometry from here, so they cannot drift apart.
//
// Model: the renderer draws the source through object-fit: contain into the project frame
// (the "fitted box"), then applies the clip transform (translate / rotate / scale about the
// frame centre) and the mirror/flip effects. All fractions below are of the project frame
// ("stage fractions") unless named source fractions (0..1 across the SOURCE picture).
// Media width/height are DISPLAY dimensions everywhere in the app (electron probe turns
// phone rotation side-data into swapped width/height; ffmpeg export auto-rotates to the
// same geometry), so the fitted box computed from them is the box the user sees.
import { scaleXY, transformOf } from './visual.js';

// How much of the frame the source media's fitted (contain) picture occupies.
export function fitFactors(project, media) {
  const mw = media?.width;
  const mh = media?.height;
  if (!mw || !mh || !project.width || !project.height) return { fx: 1, fy: 1 };
  const k = Math.min(project.width / mw, project.height / mh);
  return { fx: (mw * k) / project.width, fy: (mh * k) / project.height };
}

// The displayed picture box: centre (cx, cy) and size (w, h) in stage fractions, the
// rotation (degrees, clockwise on screen) and the mirror/flip state. `transform` overrides
// the clip's stored transform (the renderer passes the animated/pinned state, the crop
// mode passes its draft rotation) — the box follows exactly what is on screen.
export function pictureGeometry(project, media, clip, transform) {
  const t = transform || transformOf(clip || {});
  const { sx, sy } = scaleXY(t);
  const { fx, fy } = fitFactors(project, media);
  const eff = (clip && clip.effects) || [];
  return {
    cx: 0.5 + (t.x || 0),
    cy: 0.5 + (t.y || 0),
    w: fx * Math.abs(sx || 1),
    h: fy * Math.abs(sy || 1),
    rot: t.rot || 0,
    flipX: eff.includes('mirror'),
    flipY: eff.includes('flipv'),
    fx, fy, t,
  };
}

// Stage fractions -> source fractions: move to the box centre, un-rotate, divide by the
// box size, then un-flip (the displayed picture is mirrored, the source is not). The
// result is raw — values outside 0..1 mean the point is outside the picture; callers
// clamp as their interaction requires. This is the exact inverse of the renderer's
// placement, including rotation: the old crop drag read fractions off the rotated
// element's axis-aligned bounding rect, which is only correct at 0°/180°.
export function stageToSource(geom, sx, sy) {
  const dx = sx - geom.cx;
  const dy = sy - geom.cy;
  const a = (-geom.rot * Math.PI) / 180;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  let bx = 0.5 + lx / (geom.w || 1);
  let by = 0.5 + ly / (geom.h || 1);
  if (geom.flipX) bx = 1 - bx;
  if (geom.flipY) by = 1 - by;
  return { x: bx, y: by };
}

// Source fractions -> stage fractions (the exact inverse of stageToSource).
export function sourceToStage(geom, px, py) {
  let bx = geom.flipX ? 1 - px : px;
  let by = geom.flipY ? 1 - py : py;
  const lx = (bx - 0.5) * (geom.w || 1);
  const ly = (by - 0.5) * (geom.h || 1);
  const a = (geom.rot * Math.PI) / 180;
  const dx = lx * Math.cos(a) - ly * Math.sin(a);
  const dy = lx * Math.sin(a) + ly * Math.cos(a);
  return { x: geom.cx + dx, y: geom.cy + dy };
}
