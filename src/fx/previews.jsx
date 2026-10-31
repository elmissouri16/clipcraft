import React, { useEffect, useRef } from 'react';
import { FX_TRANSITIONS, OVERLAY_EFFECTS, PIXEL_EFFECTS } from './catalog.js';
import { fxGL } from './gl.js';

// Thumbnails for the Effects and Transitions panels: two REAL photographs (bundled in public/preview/,
// Unsplash via picsum — see public/preview/CREDITS.txt) go through the real effect or transition.
// A tile shows a still frame and plays on hover. While the photos load (or if one fails), two drawn
// sample scenes stand in so a tile is never blank.
const W = 320;
const H = 180;

const rnd = (n) => { const s = Math.sin(n * 91.345 + 12.7) * 43758.5453; return s - Math.floor(s); };

function drawSunset(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#2b1055');
  sky.addColorStop(0.45, '#d53369');
  sky.addColorStop(1, '#ffb347');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.62, h * 0.4, 0, w * 0.62, h * 0.4, h * 0.22);
  sun.addColorStop(0, '#fff6c2');
  sun.addColorStop(0.6, '#ffd166');
  sun.addColorStop(1, 'rgba(255,209,102,0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.4, h * 0.22, 0, Math.PI * 2);
  ctx.fill();
  const hills = [['#6a2c70', 0.6, 0.12], ['#3d1e4f', 0.66, 0.1], ['#1d1033', 0.72, 0.07]];
  hills.forEach(([c, base, amp], k) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 24) ctx.lineTo(x, h * (base - amp * Math.abs(Math.sin(x / w * (3 + k) + k))));
    ctx.lineTo(w, h);
    ctx.fill();
  });
  const lake = ctx.createLinearGradient(0, h * 0.7, 0, h);
  lake.addColorStop(0, '#7a3b69');
  lake.addColorStop(1, '#1b1035');
  ctx.fillStyle = lake;
  ctx.fillRect(0, h * 0.76, w, h * 0.24);
  ctx.fillStyle = 'rgba(255,214,140,0.55)';
  for (let i = 0; i < 8; i++) ctx.fillRect(w * 0.62 - (w * 0.1 * (1 - i / 8)), h * (0.79 + i * 0.025), w * 0.2 * (1 - i / 8), Math.max(1, h * 0.008));
  // A person on the shore.
  ctx.fillStyle = '#120a22';
  ctx.beginPath();
  ctx.arc(w * 0.3, h * 0.64, h * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(w * 0.285, h * 0.675, w * 0.03, h * 0.09);
}

function drawCity(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b1d51');
  sky.addColorStop(0.6, '#145da0');
  sky.addColorStop(1, '#2ec4b6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) ctx.fillRect(rnd(i) * w, rnd(i + 50) * h * 0.45, 1, 1);
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.arc(w * 0.2, h * 0.22, h * 0.09, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    const bw = w * (0.05 + rnd(i * 3) * 0.05);
    const bh = h * (0.25 + rnd(i * 7) * 0.45);
    const x = (i / 14) * w * 1.05 - w * 0.02;
    ctx.fillStyle = i % 2 ? '#0a1433' : '#101c44';
    ctx.fillRect(x, h - bh, bw, bh);
    ctx.fillStyle = 'rgba(255,221,120,0.85)';
    for (let y = h - bh + 4; y < h - 4; y += 6) for (let xx = x + 2; xx < x + bw - 2; xx += 5) if (rnd(xx * 3.1 + y) > 0.55) ctx.fillRect(xx, y, 2, 2);
  }
}

const samples = new Map();
function sample(which) {
  if (!samples.has(which)) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    (which === 'a' ? drawSunset : drawCity)(c.getContext('2d'), W, H);
    samples.set(which, c);
  }
  return samples.get(which);
}

// ---- Real preview photographs -------------------------------------------------------------
// Six bundled photos; a tile's `pair` index picks A and B (always two different photos) so the
// catalog does not repeat one pairing down the whole grid. Loaded once, shared by every tile.
const PHOTO_FILES = ['p1015.jpg', 'p1018.jpg', 'p1025.jpg', 'p292.jpg', 'p1016.jpg', 'p1060.jpg'];
const photoCanvases = PHOTO_FILES.map(() => null);
let photosPromise = null;

function coverCanvas(img) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c;
}

function ensurePhotos() {
  if (!photosPromise) {
    photosPromise = Promise.all(PHOTO_FILES.map((f, i) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { try { photoCanvases[i] = coverCanvas(img); } catch { /* keep fallback */ } resolve(); };
      img.onerror = () => resolve();
      img.src = `./preview/${f}`;
    })));
  }
  return photosPromise;
}

// [photoA, photoB] for a tile pair index; drawn samples until the photos arrive.
function photoPair(pair = 0) {
  const n = PHOTO_FILES.length;
  const a = photoCanvases[((pair % n) + n) % n] || sample('a');
  const b = photoCanvases[(((pair + 2) % n) + n) % n] || sample('b');
  return [a, b];
}

// Sample picture for other panels (e.g. filters) when no clip is selected.
let sampleUrl = null;
export function samplePictureUrl() {
  if (!sampleUrl) sampleUrl = sample('a').toDataURL('image/jpeg', 0.85);
  return sampleUrl;
}

// A REAL bundled photograph (public/preview/) for panels that preview on a sample picture —
// clip animations and filters. Rotates by seed (a number, or an id string hashed) so
// neighbouring tiles show different photos, like the transition tiles do. The drawn sample
// above remains only as a load-failure fallback.
export function samplePhotoUrl(seed = 0) {
  let n = 0;
  if (typeof seed === 'string') { for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0; }
  else n = Math.floor(Math.abs(seed)) || 0;
  return `./preview/${PHOTO_FILES[n % PHOTO_FILES.length]}`;
}

// ---- Classic transitions and basic effects, drawn with 2D canvas like the player shows them.
const ease = (p) => Math.min(1, Math.max(0, p));
function classicTransition(ctx, id, p, a, b) {
  p = ease(p);
  ctx.save();
  switch (id) {
    case 'fadeblack':
    case 'fadewhite':
      ctx.drawImage(p < 0.5 ? a : b, 0, 0);
      ctx.globalAlpha = p < 0.5 ? 2 * p : 2 * (1 - p);
      ctx.fillStyle = id === 'fadeblack' ? '#000' : '#fff';
      ctx.fillRect(0, 0, W, H);
      break;
    case 'wipeleft':
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, W * (1 - p), 0, W * p, H, W * (1 - p), 0, W * p, H);
      break;
    case 'wiperight':
      ctx.drawImage(a, 0, 0);
      ctx.drawImage(b, 0, 0, W * p, H, 0, 0, W * p, H);
      break;
    case 'slideleft':
      ctx.drawImage(a, -W * p, 0);
      ctx.drawImage(b, W * (1 - p), 0);
      break;
    case 'slideright':
      ctx.drawImage(a, W * p, 0);
      ctx.drawImage(b, -W * (1 - p), 0);
      break;
    case 'circleopen':
      ctx.drawImage(a, 0, 0);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, p * Math.hypot(W, H) * 0.75 / 1.41, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(b, 0, 0);
      break;
    default: // crossfade, dissolve
      ctx.drawImage(a, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(b, 0, 0);
  }
  ctx.restore();
}

function basicEffect(ctx, id, t, a) {
  ctx.save();
  switch (id) {
    case 'mirror':
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(a, 0, 0);
      break;
    case 'flipv':
      ctx.translate(0, H);
      ctx.scale(1, -1);
      ctx.drawImage(a, 0, 0);
      break;
    case 'blur':
      ctx.filter = 'blur(3px)';
      ctx.drawImage(a, 0, 0);
      break;
    case 'pixel':
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(a, 0, 0, W / 12, H / 12);
      ctx.drawImage(ctx.canvas, 0, 0, W / 12, H / 12, 0, 0, W, H);
      break;
    case 'vignette': {
      ctx.drawImage(a, 0, 0);
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'grain': {
      ctx.drawImage(a, 0, 0);
      const img = ctx.getImageData(0, 0, W, H);
      const f = Math.floor(t * 24);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd(i * 0.13 + f * 7.7) - 0.5) * 50;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
    default:
      ctx.drawImage(a, 0, 0);
  }
  ctx.restore();
}

// Draws one frame. kind 'transition': u = progress 0..1; kind 'effect': u = seconds into the clip.
// pair picks which two real photos the transition runs between (effects run on photo A).
export function drawPreview(ctx, kind, id, u, pair = 0) {
  ctx.clearRect(0, 0, W, H);
  const [a, b] = photoPair(pair);
  try {
    if (kind === 'transition') {
      const fx = FX_TRANSITIONS.find((t) => t.id === id);
      if (fx) ctx.drawImage(fxGL().transition(a, b, W, H, ease(u), fx.expr), 0, 0);
      else classicTransition(ctx, id, u, a, b);
      return;
    }
    const px = PIXEL_EFFECTS.find((e) => e.id === id);
    const ov = OVERLAY_EFFECTS.find((e) => e.id === id);
    if (px) ctx.drawImage(fxGL().effects(a, W, H, [{ expr: px.expr, T: u }]), 0, 0);
    else if (ov) {
      ctx.drawImage(a, 0, 0);
      ov.draw(ctx, W, H, u);
    } else basicEffect(ctx, id, u, a);
  } catch {
    ctx.drawImage(a, 0, 0); // no WebGL: at least show the sample
  }
}

// Tile thumbnail: a still frame, playing while the pointer is over the tile (the tile is the parent button).
export function FxThumb({ kind, id, duration = 1, pair = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    let alive = true;
    // Still frame: the middle of a transition (fades are solid there, so a bit earlier), or 0.9 s into an effect.
    const still = () => drawPreview(ctx, kind, id, kind === 'transition' ? (/^fade(black|white)$/.test(id) ? 0.3 : 0.5) : 0.9, pair);
    still();
    // Once the real photos arrive, redraw the still with them (the drawn samples stood in until then).
    ensurePhotos().then(() => { if (alive) still(); });
    const tile = cv.closest('.tile') || cv;
    let raf = 0;
    const play = () => {
      const t0 = performance.now();
      const loop = () => {
        const s = (performance.now() - t0) / 1000;
        // Transitions: hold A, play the transition, hold B. Effects: just run.
        const u = kind === 'transition' ? (s % (duration + 1)) / duration - 0.5 / duration : s % 4;
        drawPreview(ctx, kind, id, u, pair);
        raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(raf);
      loop();
    };
    const stop = () => { cancelAnimationFrame(raf); still(); };
    tile.addEventListener('pointerenter', play);
    tile.addEventListener('pointerleave', stop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      tile.removeEventListener('pointerenter', play);
      tile.removeEventListener('pointerleave', stop);
    };
  }, [kind, id, duration, pair]);
  return <canvas ref={ref} width={W} height={H} className="fx-thumb" aria-hidden="true" />;
}
