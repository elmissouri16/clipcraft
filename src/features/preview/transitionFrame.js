// Rasterize the styled picture seen by an animated transition. The source has
// already passed through effects, crop and keying in Preview.drawKeyed.
import { clipCss } from '../effects/effects.js';
import { blendOf, hasMask, hasDeco, maskUrl, decoUrl, transformOf, opacityOf } from './visual.js';

const images = new Map();
function loaded(url, redraw) {
  let image = images.get(url);
  if (!image) {
    image = new Image();image.onload = redraw;image.src = url;images.set(url, image);
    if (images.size > 128) images.delete(images.keys().next().value);
  }
  return image.complete && image.naturalWidth ? image : null;
}
export function drawTransitionFrame(canvas, source, clip, project, motion, redraw = () => {}) {
  const W = canvas.width, H = canvas.height;
  const sw = source?.videoWidth || source?.naturalWidth || source?.width;
  const sh = source?.videoHeight || source?.naturalHeight || source?.height;
  let layer = canvas.pictureLayer;
  if (!layer || layer.width !== W || layer.height !== H) {
    layer = document.createElement('canvas');layer.width = W;layer.height = H;canvas.pictureLayer = layer;
  }
  const lc = layer.getContext('2d');lc.clearRect(0,0,W,H);
  if (sw && sh) {
    const fit = Math.min(W/sw,H/sh);
    lc.drawImage(source,(W-sw*fit)/2,(H-sh*fit)/2,sw*fit,sh*fit);
  }
  if (hasMask(clip)) {
    const image = loaded(maskUrl(clip,project.width,project.height),redraw);
    lc.globalCompositeOperation = 'destination-in';
    if (image) lc.drawImage(image,0,0,W,H);else lc.clearRect(0,0,W,H);
    lc.globalCompositeOperation = 'source-over';
  }
  if (hasDeco(clip)) {
    const image = loaded(decoUrl(clip,project.width,project.height),redraw);
    if (image) lc.drawImage(image,0,0,W,H);
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);ctx.fillStyle = project.background || '#000000';ctx.fillRect(0,0,W,H);
  const t = motion?.transform || transformOf(clip);
  const sx = t.uniform ? t.scale : t.scale*t.scaleX, sy = t.uniform ? t.scale : t.scale*t.scaleY;
  ctx.save();ctx.globalCompositeOperation = clip.blend === 'add' ? 'lighter' : clip.blend && clip.blend !== 'normal' ? blendOf(clip).css : 'source-over';
  ctx.globalAlpha = motion?.opacity ?? opacityOf(clip);
  ctx.filter = clipCss(clip);
  ctx.translate((.5+t.x)*W,(.5+t.y)*H);ctx.rotate(t.rot*Math.PI/180);ctx.scale(sx,sy);
  ctx.drawImage(layer,-W/2,-H/2,W,H);ctx.restore();
  return canvas;
}
