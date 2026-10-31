// Visual properties of a picture clip (main track or overlay): transform, opacity, blend, chroma key, mask.
// Shared by the preview, the inspector and (through the same numbers) the export in electron/layers.cjs.

export const DEFAULT_TRANSFORM = { scale: 1, scaleX: 1, scaleY: 1, uniform: true, x: 0, y: 0, rot: 0 };
export const DEFAULT_CHROMA = { on: false, color: '#00ff00', intensity: 20, feather: 20, spill: 0 };
export const DEFAULT_MASK = {
  type: 'none', x: 0, y: 0, rot: 0, w: 0.5, h: 0.5, feather: 0, invert: false, round: 0, text: 'CLIPCRAFT',
  // Outline of the shape and a glow around it (sizes in pixels of a 720p frame, 0 = off).
  stroke: 0, strokeColor: '#ffffff', glow: 0, glowColor: '#825cfb', glowStrength: 60,
};

// id, label, CSS mix-blend-mode for the preview, FFmpeg blend all_mode for the export.
export const BLEND_MODES = [
  { id: 'normal', name: 'Normal', css: 'normal', ff: null },
  { id: 'multiply', name: 'Multiply', css: 'multiply', ff: 'multiply' },
  { id: 'screen', name: 'Screen', css: 'screen', ff: 'screen' },
  { id: 'overlay', name: 'Overlay', css: 'overlay', ff: 'overlay' },
  { id: 'softlight', name: 'Soft light', css: 'soft-light', ff: 'softlight' },
  { id: 'hardlight', name: 'Hard light', css: 'hard-light', ff: 'hardlight' },
  { id: 'darken', name: 'Darken', css: 'darken', ff: 'darken' },
  { id: 'lighten', name: 'Lighten', css: 'lighten', ff: 'lighten' },
  { id: 'dodge', name: 'Color dodge', css: 'color-dodge', ff: 'dodge' },
  { id: 'burn', name: 'Color burn', css: 'color-burn', ff: 'burn' },
  { id: 'difference', name: 'Difference', css: 'difference', ff: 'difference' },
  { id: 'exclusion', name: 'Exclusion', css: 'exclusion', ff: 'exclusion' },
  { id: 'add', name: 'Add', css: 'plus-lighter', ff: 'addition' },
];

export const MASK_SHAPES = [
  { id: 'split', name: 'Split' },
  { id: 'filmstrip', name: 'Filmstrip' },
  { id: 'circle', name: 'Circle' },
  { id: 'rectangle', name: 'Rectangle' },
  { id: 'star', name: 'Stars' },
  { id: 'heart', name: 'Heart' },
  { id: 'text', name: 'Text' },
];

export const transformOf = (clip) => ({ ...DEFAULT_TRANSFORM, ...(clip.transform || {}) });
export const chromaOf = (clip) => ({ ...DEFAULT_CHROMA, ...(clip.chroma || {}) });
export const maskOf = (clip) => ({ ...DEFAULT_MASK, ...(clip.mask || {}) });
export const opacityOf = (clip) => (clip.opacity === undefined ? 1 : clip.opacity);
export const blendOf = (clip) => BLEND_MODES.find((b) => b.id === clip.blend) || BLEND_MODES[0];

// Effective scale on each axis.
export function scaleXY(t) {
  return t.uniform ? { sx: t.scale, sy: t.scale } : { sx: t.scale * t.scaleX, sy: t.scale * t.scaleY };
}

export function hasTransform(clip) {
  const t = transformOf(clip);
  const { sx, sy } = scaleXY(t);
  return sx !== 1 || sy !== 1 || t.x !== 0 || t.y !== 0 || t.rot !== 0;
}
export const hasMask = (clip) => maskOf(clip).type !== 'none';
export const hasChroma = (clip) => chromaOf(clip).on;

// True when the clip needs the layered render (alpha, placement or blending) instead of the plain picture path.
export function isLayered(clip) {
  return hasTransform(clip) || hasMask(clip) || hasChroma(clip) || opacityOf(clip) < 1 || blendOf(clip).id !== 'normal';
}

// CapCut-like sliders (0 to 100) mapped to FFmpeg's chromakey / despill parameters.
export function chromaParams(c) {
  return {
    similarity: 0.02 + (c.intensity / 100) * 0.4,
    blend: 0.01 + (c.feather / 100) * 0.3,
    spill: Math.min(1, Math.max(0, c.spill / 100)),
  };
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// BT.601 limited-range chroma, the same integer formulas FFmpeg's chromakey uses for the key color.
const toU = (r, g, b) => ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
const toV = (r, g, b) => ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;

// Keys a frame in place (RGBA bytes): the alpha of every pixel follows FFmpeg's chromakey formula
// (chroma distance, without its 3x3 averaging), then a simple spill suppression. Used for the preview.
export function applyChromaKey(data, c) {
  const [kr, kg, kb] = hexToRgb(c.color);
  const ku = toU(kr, kg, kb);
  const kv = toV(kr, kg, kb);
  const { similarity, blend, spill } = chromaParams(c);
  // Which channel carries the spill: the key color's dominant one.
  const dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const du = toU(r, g, b) - ku;
    const dv = toV(r, g, b) - kv;
    const diff = Math.sqrt((du * du + dv * dv) / (255 * 255 * 2));
    const a = blend > 0.0001 ? Math.min(1, Math.max(0, (diff - similarity) / blend)) : diff > similarity ? 1 : 0;
    data[i + 3] = Math.round(a * data[i + 3]);
    if (spill > 0 && a > 0) {
      const ch = [r, g, b];
      const others = dom === 0 ? (g + b) / 2 : dom === 1 ? (r + b) / 2 : (r + g) / 2;
      ch[dom] = ch[dom] - spill * Math.max(0, ch[dom] - others);
      data[i] = ch[0];
      data[i + 1] = ch[1];
      data[i + 2] = ch[2];
    }
  }
  return data;
}

// ---- Masks ----

function shapePath(ctx, type, w, h, round, text) {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  switch (type) {
    case 'circle':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'rectangle': {
      const r = Math.min(hw, hh) * Math.min(1, Math.max(0, round));
      ctx.roundRect(-hw, -hh, w, h, r);
      break;
    }
    case 'filmstrip':
      ctx.rect(-1e5, -hh, 2e5, h); // an endless horizontal band
      break;
    case 'split':
      ctx.rect(-1e5, -1e5, 2e5, 1e5); // everything above the line
      break;
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? 0.42 : 1;
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(ang) * hw * rr, Math.sin(ang) * hh * rr);
      }
      ctx.closePath();
      break;
    }
    case 'heart': {
      const k = Math.min(hw, hh);
      ctx.moveTo(0, k * 0.9);
      ctx.bezierCurveTo(-k * 1.6, -k * 0.1, -k * 0.7, -k * 1.2, 0, -k * 0.45);
      ctx.bezierCurveTo(k * 0.7, -k * 1.2, k * 1.6, -k * 0.1, 0, k * 0.9);
      ctx.closePath();
      break;
    }
    case 'text': {
      ctx.font = `900 ${Math.round(h)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      return { text };
    }
    default:
      ctx.rect(-hw, -hh, w, h);
  }
  return null;
}

// Renders the mask of a clip as an alpha image (white where the clip stays visible) the size of the project
// frame. The preview uses it as a CSS mask and the export as an alpha channel, so both show the same shape.
export function renderMaskPng(mask, W, H) {
  const m = { ...DEFAULT_MASK, ...mask };
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const draw = (target) => {
    target.save();
    target.translate(W / 2 + m.x * W, H / 2 + m.y * H);
    target.rotate((m.rot * Math.PI) / 180);
    target.fillStyle = '#fff';
    const textShape = shapePath(target, m.type, m.w * W, m.h * H, m.round, m.text);
    if (textShape) target.fillText(textShape.text, 0, 0);
    else target.fill();
    target.restore();
  };
  if (m.feather > 0) ctx.filter = `blur(${m.feather * (W / 1280)}px)`;
  draw(ctx);
  ctx.filter = 'none';
  if (m.invert) {
    const inv = document.createElement('canvas');
    inv.width = W;
    inv.height = H;
    const ic = inv.getContext('2d');
    ic.fillStyle = '#fff';
    ic.fillRect(0, 0, W, H);
    ic.globalCompositeOperation = 'destination-out';
    ic.drawImage(canvas, 0, 0);
    return inv.toDataURL('image/png');
  }
  return canvas.toDataURL('image/png');
}

// The outline and glow of a clip's mask, drawn above the clip: a transparent picture the size of the frame, in the
// same place as the mask, so the clip's transform moves it with the picture (preview and export alike).
export const hasDeco = (clip) => hasMask(clip) && (maskOf(clip).stroke > 0 || maskOf(clip).glow > 0);
// zoom: the clip's scale; the sizes are divided by it so they stay the same on screen when the clip is made
// smaller or bigger (a small camera bubble keeps a visible outline).
export function renderDecoPng(mask, W, H, zoom = 1) {
  const m = { ...DEFAULT_MASK, ...mask };
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const px = Math.min(W, H) / 720 / Math.max(0.05, zoom); // sizes are given for a 720p frame
  const place = () => {
    ctx.translate(W / 2 + m.x * W, H / 2 + m.y * H);
    ctx.rotate((m.rot * Math.PI) / 180);
  };
  const shape = () => shapePath(ctx, m.type, m.w * W, m.h * H, m.round, m.text);
  const paint = (how) => {
    // how: 'fill' or 'stroke' of the shape (text shapes are text, the others a path).
    const t = shape();
    if (t) (how === 'fill' ? ctx.fillText(t.text, 0, 0) : ctx.strokeText(t.text, 0, 0));
    else if (how === 'fill') ctx.fill();
    else ctx.stroke();
  };
  if (m.glow > 0) {
    // Glow: the shape lit in the glow color with a soft shadow, then its inside cleared (the picture shows
    // there); an inverted mask keeps the picture outside, so its glow goes inwards instead.
    const k = Math.max(0.05, Math.min(1, (m.glowStrength ?? 60) / 100));
    ctx.save();
    place();
    if (m.invert) {
      shape();
      ctx.clip();
    }
    ctx.shadowColor = m.glowColor;
    ctx.shadowBlur = m.glow * px * 2;
    ctx.fillStyle = m.glowColor;
    ctx.strokeStyle = m.glowColor;
    ctx.lineWidth = Math.max(1, m.glow * px * 0.5);
    for (let i = 0; i < 1 + Math.round(k * 3); i++) paint(m.invert ? 'stroke' : 'fill');
    ctx.restore();
    if (!m.invert) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      place();
      ctx.fillStyle = '#000';
      paint('fill');
      ctx.restore();
    }
    if (k < 1) {
      // Weaker glow: the whole glow faded.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${0.35 + 0.65 * k})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
  if (m.stroke > 0) {
    ctx.save();
    place();
    ctx.strokeStyle = m.strokeColor;
    ctx.lineWidth = m.stroke * px;
    ctx.lineJoin = 'round';
    paint('stroke');
    ctx.restore();
  }
  return canvas.toDataURL('image/png');
}
const decoCache = new Map();
export function decoUrl(clip, W, H) {
  const { sx, sy } = scaleXY(transformOf(clip));
  const zoom = Math.sqrt(Math.abs(sx * sy)) || 1;
  const key = `${JSON.stringify(maskOf(clip))}|${W}x${H}|${zoom.toFixed(3)}`;
  const hit = decoCache.get(clip.id);
  if (hit && hit.key === key) return hit.url;
  const url = renderDecoPng(maskOf(clip), W, H, zoom);
  decoCache.set(clip.id, { key, url });
  return url;
}
export function decoImages(project) {
  const out = {};
  for (const c of [...project.videoClips, ...(project.overlayClips || [])]) {
    if (!c.gap && hasDeco(c)) out[c.id] = decoUrl(c, project.width, project.height);
  }
  return out;
}
// CSS of the decoration layer in the preview: the clip's transform and opacity, no mask.
export function decoStyle(clip, W, H, motion) {
  if (!hasDeco(clip)) return { display: 'none', backgroundImage: 'none' };
  const { transform, opacity } = layerStyle(clip, W, H, motion);
  return { display: 'block', transform, opacity, backgroundImage: `url(${decoUrl(clip, W, H)})` };
}

// Mask PNGs keyed by clip id, for every clip with a mask (sent with the project when exporting).
const maskCache = new Map();
export function maskUrl(clip, W, H) {
  const key = `${JSON.stringify(maskOf(clip))}|${W}x${H}`;
  const hit = maskCache.get(clip.id);
  if (hit && hit.key === key) return hit.url;
  const url = renderMaskPng(maskOf(clip), W, H);
  maskCache.set(clip.id, { key, url });
  return url;
}
export function maskImages(project) {
  const out = {};
  for (const c of [...project.videoClips, ...(project.overlayClips || [])]) {
    if (!c.gap && hasMask(c)) out[c.id] = maskUrl(c, project.width, project.height);
  }
  return out;
}

// CSS for the picture layer of a clip in the preview (same order as the export: mask, opacity, then transform).
// motion: { transform, opacity } of an animated clip at the current time (src/anim.js), or undefined.
export function layerStyle(clip, W, H, motion) {
  const t = motion ? motion.transform : transformOf(clip);
  const { sx, sy } = scaleXY(t);
  const mask = hasMask(clip) ? `url(${maskUrl(clip, W, H)})` : 'none';
  return {
    transform: `translate(${t.x * 100}%, ${t.y * 100}%) rotate(${t.rot}deg) scale(${sx}, ${sy})`,
    opacity: String(motion ? motion.opacity : opacityOf(clip)),
    maskImage: mask,
    webkitMaskImage: mask,
  };
}
