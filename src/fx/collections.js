// Transition collections: Hamza's 10 creative collections (Basic, Zoom, Slide, 3D, Glitch,
// Blur, Light, Wipe, Creative, Vintage) as a grouping layer over the 135-name catalog and
// the engine transitions. Every item resolves to a real engine transition id — status
// 'implemented' for true matches, 'adapted' (badged in the UI) for the closest real one.
// The engine has no direction/intensity parameters: direction exists only as separate
// engine variants (wipe left/right/up/down), exposed via DIRECTION_GROUPS below.

import { CATALOG135 } from './catalog135.js';
import { TRANSITIONS } from '../effects.js';

const ENGINE = new Map(TRANSITIONS.map((t) => [t.id, t]));
export const engineName = (id) => ENGINE.get(id)?.name || id;
export const engineDuration = (id) => ENGINE.get(id)?.duration || 0.5;

export const COLLECTIONS = [
  { id: 'basic', name: 'Basic' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'slide', name: 'Slide' },
  { id: '3d', name: '3D' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'blur', name: 'Blur' },
  { id: 'light', name: 'Light' },
  { id: 'wipe', name: 'Wipe' },
  { id: 'creative', name: 'Creative' },
  { id: 'vintage', name: 'Vintage' },
];

// The five transition packs: groups of NEW engine transitions (src/fx/catalog.js PACK_TRANSITIONS).
// Unlike adapted catalog names, every pack item is a true engine implementation of its name — the pack
// is a second grouping over the same items (each also sits in one of the 10 collections above).
export const PACKS = [
  { id: 'seamless', name: 'Seamless' },
  { id: 'reveal', name: 'Mask & Reveal' },
  { id: 'glowpack', name: 'Light & Glow' },
  { id: 'distortion', name: 'Distortion' },
  { id: 'cinematic', name: 'Cinematic' },
];

// First matching rule wins; keywords match the catalog slug.
const RULES = [
  ['vintage', ['vhs', 'film-roll', 'flicker', 'tv-power']],
  ['creative', ['beat', 'shake', 'warp', 'liquid', 'mirror', 'mask', 'walk', 'hand-cover', 'foreground', 'clone', 'echo', 'wave', 'combo', 'stretch']],
  ['glitch', ['glitch', 'rgb', 'datamosh', 'pixel', 'posterize', 'chaos', 'grunge', 'chromatic', 'shatter', 'negative']],
  ['light', ['flash', 'leak', 'flare', 'glow', 'bloom', 'solarize', 'phosphor', 'ray-', 'light-', 'burn-']],
  ['zoom', ['zoom', 'whip', 'snap', 'spring', 'pop-motion']],
  ['blur', ['blur', 'dreamy', 'soft-focus', 'defocus']],
  ['3d', ['3d', 'spin', 'roll', 'orbit', 'fold', 'page', 'flip', 'swirl', 'kaleido', 'curl']],
  ['slide', ['slide', 'push', 'split', 'barn']],
];
const FAMILY_DEFAULT = {
  'Dissolve & Fade': 'basic', 'Wipe & Matte': 'wipe', 'Motion & Transform': 'slide',
  'Zoom & Speed': 'zoom', 'Light & Blur': 'light', 'Distortion & Retro': 'creative',
  'Creator & Social Combos': 'creative', 'Text & Motion Graphics': 'creative',
};

export function collectionFor(entry) {
  const slug = entry.slug || '';
  for (const [id, keys] of RULES) if (keys.some((k) => slug.includes(k))) return id;
  return FAMILY_DEFAULT[entry.family] || 'creative';
}

// Names from the §A brief that the 135 catalog does not carry literally, resolved to real
// engine transitions (implemented where the engine does exactly this, adapted otherwise).
const EXTRA = [
  // name, engineId, status, collection
  ['Fade', 'fade', 'implemented', 'basic'],
  ['Zoom In', 'fx_zoomin', 'implemented', 'zoom'],
  ['Zoom Out', 'fx_zoomout', 'implemented', 'zoom'],
  ['Whip Zoom', 'fx_radialblur', 'adapted', 'zoom'],
  ['Radial Zoom', 'fx_radialblur', 'adapted', 'zoom'],
  ['Punch Zoom', 'fx_snapback', 'adapted', 'zoom'],
  ['Slide Left', 'slideleft', 'implemented', 'slide'],
  ['Slide Right', 'slideright', 'implemented', 'slide'],
  ['Slide Up', 'fx_slideup', 'implemented', 'slide'],
  ['Slide Down', 'fx_slidedown', 'implemented', 'slide'],
  ['Split Slide', 'fx_tiles', 'adapted', 'slide'],
  ['Diagonal Slide', 'slideleft', 'adapted', 'slide'],
  ['Cube', 'fx_spinout', 'adapted', '3d'],
  ['Spin', 'fx_spinout', 'adapted', '3d'],
  ['Flip', 'fx_spinout', 'adapted', '3d'],
  ['Perspective Rotate', 'fx_spinout', 'adapted', '3d'],
  ['Digital Glitch', 'fx_glitch', 'implemented', 'glitch'],
  ['VHS Glitch', 'fx_glitch', 'adapted', 'glitch'],
  ['Pixel Glitch', 'fx_pixelate', 'adapted', 'glitch'],
  ['Signal Distortion', 'fx_ripple', 'adapted', 'glitch'],
  ['Motion Blur', 'fx_radialblur', 'adapted', 'blur'],
  ['Directional Blur', 'fx_warp', 'adapted', 'blur'],
  ['Radial Blur', 'fx_radialblur', 'adapted', 'blur'],
  ['Defocus', 'fx_blur', 'adapted', 'blur'],
  ['Film Burn', 'fx_flare', 'adapted', 'light'],
  ['Lens Flare', 'fx_flaresweep', 'implemented', 'light'],
  ['Circular Wipe', 'circleopen', 'adapted', 'wipe'],
  ['Iris', 'circleopen', 'implemented', 'wipe'],
  ['Diamond', 'fx_diamond', 'implemented', 'wipe'],
  ['Star', 'fx_diamond', 'adapted', 'wipe'],
  ['Shake', 'fx_impactshake', 'implemented', 'creative'],
  ['Warp', 'fx_warp', 'implemented', 'creative'],
  ['Liquid', 'fx_ripple', 'implemented', 'creative'],
  ['Super 8', 'fx_filmroll', 'adapted', 'vintage'],
  ['Film Reel', 'fx_filmroll', 'adapted', 'vintage'],
  ['Analog Flash', 'fadewhite', 'adapted', 'vintage'],
  ['Projector Flicker', 'fx_projector', 'implemented', 'vintage'],
  // Reference-grid names as first-class entries: each runs the engine transition it names.
  ['Rotate', 'fx_spinout', 'implemented', '3d'],
  ['Fade to Black', 'fadeblack', 'implemented', 'basic'],
  ['Shake & Distort', 'fx_impactshake', 'implemented', 'creative'],
];
const slugify = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The five packs as collection items: every entry is status 'implemented' because each name is a real
// engine transition built for the pack (PACK_TRANSITIONS in src/fx/catalog.js). `collection` is the
// classic collection the item also belongs to; `pack` is its pack id from PACKS.
const PACK_ITEMS = [
  // name, engineId, pack, collection
  ['Whip Pan Left', 'fx_whipleft', 'seamless', 'zoom'],
  ['Whip Pan Right', 'fx_whipright', 'seamless', 'zoom'],
  ['Whip Pan Up', 'fx_whipup', 'seamless', 'zoom'],
  ['Whip Pan Down', 'fx_whipdown', 'seamless', 'zoom'],
  ['Zoom Blur', 'fx_zoomblur', 'seamless', 'zoom'],
  ['Spin Blur', 'fx_spinblur', 'seamless', '3d'],
  ['Warp Push', 'fx_warppush', 'seamless', 'creative'],
  ['Smooth Warp Left', 'fx_warpsmoothl', 'seamless', 'creative'],
  ['Smooth Warp Right', 'fx_warpsmoothr', 'seamless', 'creative'],
  ['Venetian Blinds', 'fx_blinds', 'reveal', 'wipe'],
  ['Grid Reveal', 'fx_gridreveal', 'reveal', 'wipe'],
  ['Barn Doors', 'fx_barndoors', 'reveal', 'wipe'],
  ['Chevron Wipe', 'fx_chevron', 'reveal', 'wipe'],
  ['Circle Reveal Out', 'fx_irisout', 'reveal', 'wipe'],
  ['Circle Reveal In', 'fx_irisin', 'reveal', 'wipe'],
  ['Diamond Reveal', 'fx_diamondreveal', 'reveal', 'wipe'],
  ['Rectangles', 'fx_rects', 'reveal', 'wipe'],
  ['Circles From Corner', 'fx_circlecorner', 'reveal', 'wipe'],
  ['Diagonal Stripes', 'fx_diagstripes', 'reveal', 'wipe'],
  ['Glow Dissolve', 'fx_glowdissolve', 'glowpack', 'light'],
  ['Lens Flare Sweep', 'fx_flaresweep', 'glowpack', 'light'],
  ['Light Burn', 'fx_lightburn', 'glowpack', 'light'],
  ['Flash Frame', 'fx_flashframe', 'glowpack', 'light'],
  ['Prism Leak', 'fx_prismleak', 'glowpack', 'light'],
  ['Ripple Wave', 'fx_ripplewave', 'distortion', 'creative'],
  ['Impact Shake', 'fx_impactshake', 'distortion', 'creative'],
  ['RGB Split Slide Left', 'fx_rgbslidel', 'distortion', 'glitch'],
  ['RGB Split Slide Right', 'fx_rgbslider', 'distortion', 'glitch'],
  ['Pixel Stretch', 'fx_pixelstretch', 'distortion', 'glitch'],
  ['Stretch Warp', 'fx_stretchwarp', 'distortion', 'creative'],
  ['Film Roll', 'fx_filmroll', 'cinematic', 'vintage'],
  ['Projector Flicker Cut', 'fx_projector', 'cinematic', 'vintage'],
  ['Letterbox Close / Open', 'fx_letterbox', 'cinematic', 'creative'],
  ['Dip to Color', 'fx_dipcolor', 'cinematic', 'basic'],
  ['Freeze Frame Push', 'fx_freezepush', 'cinematic', 'creative'],
];

export const COLLECTION_ITEMS = [
  ...CATALOG135.map((e) => ({ ...e, collection: collectionFor(e) })),
  ...EXTRA.map(([name, engineId, status, collection]) => ({
    slug: `xa-${slugify(name)}`, name, family: 'ClipCraft collections', collection, engineId, status,
    engineName: engineName(engineId), duration: engineDuration(engineId),
    behavior: status === 'implemented' ? `Runs the engine's ${engineName(engineId)} transition.`
      : `Adapted: runs the engine's ${engineName(engineId)} transition, the closest real match.`,
    bestFor: '', extra: true,
  })),
  ...PACK_ITEMS.map(([name, engineId, pack, collection]) => ({
    slug: `pk-${slugify(name)}`, name, family: 'ClipCraft packs', collection, pack, engineId, status: 'implemented',
    engineName: engineName(engineId), duration: engineDuration(engineId),
    behavior: `Runs the engine's ${engineName(engineId)} transition.`,
    bestFor: '', extra: true,
  })),
];
export const collectionItems = (id) => COLLECTION_ITEMS.filter((e) => e.collection === id);
export const packItems = (id) => COLLECTION_ITEMS.filter((e) => e.pack === id);

// Direction exists in the engine only as separate variants of the wipe / slide families.
export const DIRECTION_GROUPS = [
  { name: 'Wipe', ids: { left: 'wipeleft', right: 'wiperight', up: 'fx_wipeup', down: 'fx_wipedown' } },
  { name: 'Slide', ids: { left: 'slideleft', right: 'slideright', up: 'fx_slideup', down: 'fx_slidedown' } },
  { name: 'Whip Pan', ids: { left: 'fx_whipleft', right: 'fx_whipright', up: 'fx_whipup', down: 'fx_whipdown' } },
  { name: 'Smooth Warp', ids: { left: 'fx_warpsmoothl', right: 'fx_warpsmoothr' } },
  { name: 'RGB Slide', ids: { left: 'fx_rgbslidel', right: 'fx_rgbslider' } },
];
export function directionGroupFor(type) {
  for (const g of DIRECTION_GROUPS) {
    const dir = Object.keys(g.ids).find((d) => g.ids[d] === type);
    if (dir) return { group: g, dir };
  }
  return null;
}

// Transition favourites (catalog slugs), persisted by the caller in localStorage.
export const FAV_KEY = 'clipcraft.favTransitions';
export function loadFavorites(storage) {
  try {
    const v = JSON.parse((storage || localStorage).getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
export function saveFavorites(storage, set) {
  try { (storage || localStorage).setItem(FAV_KEY, JSON.stringify([...set])); } catch { /* storage full/blocked */ }
}
export function toggleFavorite(set, slug) {
  const next = new Set(set);
  if (next.has(slug)) next.delete(slug); else next.add(slug);
  return next;
}
