// The 135-name transition catalog (reference: transition_catalog.json, generated into
// catalog135.json) mapped onto ClipCraft's real transition engine.
//
// Every catalog entry resolves to an engine transition id that actually exists in
// src/effects.js TRANSITIONS (the classic FFmpeg transitions + the WebGL/expression
// transitions of src/fx/catalog.js). Entries whose behaviour the engine performs as
// named are status 'implemented'; the rest are 'adapted': the closest real engine
// transition, shown with an "Adapted" badge in the panel — never a fake preview or a
// dead button. The preview tile and the applied transition both use the mapped id.

import catalog from './catalog135.json' with { type: 'json' };
import { TRANSITIONS } from '../effects.js';

export const ENGINE_TRANSITION_IDS = TRANSITIONS.map((t) => t.id);
const ENGINE = new Map(TRANSITIONS.map((t) => [t.id, t]));

// slug -> engine id for entries with a close, named counterpart (status 'implemented').
const IMPLEMENTED = {
  'cross-dissolve': 'dissolve',
  'dip-to-black': 'fadeblack',
  'dip-to-white': 'fadewhite',
  'non-additive-dissolve': 'dissolve',
  'blur-dissolve': 'fx_blur',
  'circle-reveal': 'circleopen',
  'stripe-band-wipe': 'fx_diagstripes',
  'earthquake-shake': 'fx_impactshake',
  'iris-round': 'circleopen',
  'linear-wipe': 'wipeleft',
  'iris-diamond': 'fx_diamond',
  'page-peel': 'fx_pagecurl',
  'page-turn': 'fx_pagecurl',
  'camera-push-in': 'fx_zoomin',
  'push': 'slideleft',
  'slide-left-right-up-down': 'slideleft',
  'camera-pull-out': 'fx_zoomout',
  'pop-motion': 'fx_snapback',
  'spin-transition': 'fx_spinout',
  'spring-motion': 'fx_snapback',
  'wave': 'fx_ripple',
  'snap-zoom': 'fx_zoomin',
  'zoom-blur': 'fx_zoomblur',
  // True engine implementations added with the transition packs (were 'adapted' before).
  'barn-doors': 'fx_barndoors',
  'venetian-blinds-louver': 'fx_blinds',
  'checkerboard-wipe': 'fx_gridreveal',
  'whip-pan': 'fx_whipleft',
  'wave-warp': 'fx_ripplewave',
  'stretch': 'fx_stretchwarp',
  'film-roll': 'fx_filmroll',
  'zoom-in-transition': 'fx_zoomin',
  'zoom-out-transition': 'fx_zoomout',
  'radial-blur-transition': 'fx_radialblur',
  'white-flash': 'fadewhite',
  'black-flash': 'fadeblack',
  'flare': 'fx_flare',
  'lens-blur': 'fx_blur',
  'glitch': 'fx_glitch',
  'rgb-split': 'fx_glitch',
  'liquid-distortion': 'fx_ripple',
  'mosaic-blocks': 'fx_tiles',
  'pixelate-reveal': 'fx_pixelate',
  'kaleidoscope': 'fx_kaleido',
  'swipe-left-right': 'fx_swipe',
};

// slug -> engine id for the remaining entries: nearest real behaviour (status 'adapted').
const ADAPTED = {
  'fade-in': 'fade', 'fade-out': 'fade', 'dip-to-color': 'fadeblack', 'film-dissolve': 'dissolve',
  'luma-fade': 'dissolve', 'additive-dissolve': 'dissolve', 'morph-cut': 'dissolve',
  'diagonal-wipe': 'wipeleft', 'shape-matte-reveal': 'fx_diamond', 'gradient-wipe': 'wipeleft',
  'ink-paint-reveal': 'fx_brush', 'luma-matte-reveal': 'fx_diamond', 'panel-wipe': 'fx_tiles',
  'radial-wipe': 'circleopen', 'soft-wipe': 'wipeleft',
  'clock-wipe': 'circleopen',
  'heart-matte': 'circleopen', 'iris-box': 'fx_diamond', 'iris-cross': 'fx_crosshatch',
  'paint-splatter-wipe': 'fx_brush', 'random-blocks': 'fx_tiles', 'spiral-wipe': 'fx_swirl',
  'star-wipe': 'fx_diamond',
  'flip-horizontal-vertical': 'fx_spinout', 'frame-transition': 'fx_phone',
  'pull-motion': 'fx_zoomout', 'slice': 'fx_crosshatch', 'split': 'slideleft',
  'stretch-wipe': 'fx_warp', 'travel-motion': 'fx_warp', '3d-roll': 'fx_spinout', '3d-spin': 'fx_spinout',
  '3d-spinback': 'fx_snapback', 'band-slide': 'slideleft', 'block-motion': 'fx_tiles',
  'center-split': 'fx_diamond', 'fold': 'fx_pagecurl', 'mirror': 'fx_kaleido',
  'orbit-transition': 'fx_swirl', 'plateau-wipe': 'fx_wipeup', 'roll': 'fx_spinout',
  'cross-zoom': 'fx_zoomin', 'directional-blur-transition': 'fx_zoomblur', 'speed-blur-transition': 'fx_radialblur',
  'speed-ramp-match-transition': 'fx_snapback', 'warp-zoom': 'fx_warp',
  'flash': 'fadewhite', 'light-leak': 'fx_flare', 'blur-to-color': 'fx_blur', 'chroma-leak': 'fx_flare',
  'glow': 'fx_glowdissolve', 'light-sweep': 'fx_flare', 'overexposure-bloom': 'fx_dreamy',
  'burn-chroma': 'fx_flare', 'light-stripe': 'fx_flare', 'phosphor-trail': 'fx_dreamy',
  'ray-burst': 'fx_radialblur', 'soft-focus-wipe': 'fx_blur', 'solarize': 'fx_dreamy',
  'burn-alpha': 'fx_flare', 'chromatic-aberration': 'fx_glitch', 'datamosh': 'fx_pixelate',
  'flicker': 'fadeblack', 'negative-invert-flash': 'fadewhite',
  'neon-wipe': 'fx_flare', 'vhs-damage': 'fx_glitch',
  'chaos-distortion': 'fx_glitch', 'glass-shatter': 'fx_pixelate', 'grunge-distortion': 'fx_glitch',
  'posterize-stutter': 'fx_pixelate', 'tv-power-off': 'fx_zoomout',
  'beat-flash': 'fadewhite', 'beat-zoom': 'fx_zoomin', 'flash-motion-blur-combo': 'fx_radialblur',
  'match-cut-zoom': 'fx_zoomin', 'whip-pan-match-cut': 'fx_whipleft', 'foreground-object-wipe': 'fx_swipe',
  'freeze-frame-pop': 'fx_snapback', 'hand-cover-object-cover-match': 'fx_swipe',
  'mask-pass-through': 'fx_zoomin', 'spin-match-cut': 'fx_spinout', 'split-screen-reveal': 'slideleft',
  'walk-by-reveal': 'fx_swipe', 'zoom-spin-combo': 'fx_spinout', 'clone-echo-transition': 'fx_kaleido',
  'motion-tween': 'fx_snapback', 'shape-dissolve': 'fx_diamond', 'text-animator-transition': 'dissolve',
  'typewriter-reveal': 'wipeleft', 'motion-camera': 'fx_zoomin', 'shape-flow': 'fx_swirl',
};

// Last-resort mapping per family, used only if a catalog name has no explicit entry above.
const FAMILY_FALLBACK = {
  'Dissolve & Fade': 'dissolve',
  'Wipe & Matte': 'wipeleft',
  'Motion & Transform': 'slideleft',
  'Zoom & Speed': 'fx_zoomin',
  'Light & Blur': 'fx_flare',
  'Distortion & Retro': 'fx_glitch',
  'Creator & Social Combos': 'fx_swipe',
  'Text & Motion Graphics': 'dissolve',
};

export const CATALOG_FAMILIES = [...new Set(catalog.map((e) => e.family))];

// Every catalog entry with its resolved engine transition, default duration and status.
export const CATALOG135 = catalog.map((e) => {
  const implemented = IMPLEMENTED[e.slug];
  const engineId = implemented || ADAPTED[e.slug] || FAMILY_FALLBACK[e.family] || 'dissolve';
  return {
    ...e,
    engineId,
    engineName: ENGINE.get(engineId)?.name || engineId,
    duration: ENGINE.get(engineId)?.duration || 0.5,
    status: implemented ? 'implemented' : 'adapted',
  };
});

export const catalog135BySlug = (slug) => CATALOG135.find((e) => e.slug === slug);
