// Text Animations library: composer-style presets for text and caption clips, organised the way the big
// preset packs are — an In section and an Out section, each split into category folders. A preset is pure
// data: the animation id the shared text renderer (src/text/render.js) already knows how to play, plus the
// duration it was tuned with. Because the player and the export run the very same renderer, a preset that
// plays in the panel plays identically in the exported file — there is no separate "export version".
//
// The motions mirror what professional text preset packs actually do (studied from their animated
// previews): smooth sine-eased slides, slides that land out of focus, letter tracking that settles,
// per-character and per-word staggers, elastic overshoots. Categories and names describe the motion,
// nothing else — no pack artwork, wording or assets are reused.

export const TEXT_ANIM_CATEGORIES = [
  'Smooth', 'Slide', 'Scale', 'Fade', 'Blur', 'Rotate & Flip', 'Bounce & Pop', 'Type & Words', 'Glitch & Flicker',
];

// preset: { name, cat, anim (renderer id), dur (seconds it was tuned with) }
export const TEXT_ANIMS_IN = [
  // Smooth — the sine-eased family leads the browser: the smooth slides, fade+position combos that
  // ride the full duration, a long glide, an overshoot settle, and per-character smooth staggers.
  { name: 'Slide Up Smooth', cat: 'Smooth', anim: 'slideUpSmooth', dur: 0.7 },
  { name: 'Slide Down Smooth', cat: 'Smooth', anim: 'slideDownSmooth', dur: 0.7 },
  { name: 'Slide Left Smooth', cat: 'Smooth', anim: 'slideLeftSmooth', dur: 0.7 },
  { name: 'Slide Right Smooth', cat: 'Smooth', anim: 'slideRightSmooth', dur: 0.7 },
  { name: 'Fade Up', cat: 'Smooth', anim: 'fadeUp', dur: 0.7 },
  { name: 'Fade Down', cat: 'Smooth', anim: 'fadeDown', dur: 0.7 },
  { name: 'Fade Left', cat: 'Smooth', anim: 'fadeLeft', dur: 0.7 },
  { name: 'Fade Right', cat: 'Smooth', anim: 'fadeRight', dur: 0.7 },
  { name: 'Glide Up', cat: 'Smooth', anim: 'glideUp', dur: 0.9 },
  { name: 'Settle Up', cat: 'Smooth', anim: 'settleUp', dur: 0.8 },
  { name: 'Chars Slide Up', cat: 'Smooth', anim: 'charSlideUp', dur: 0.9 },
  { name: 'Chars Slide Down', cat: 'Smooth', anim: 'charSlideDown', dur: 0.9 },
  // Slide — the essentials Hamza asked for first.
  { name: 'Slide Up', cat: 'Slide', anim: 'slideUp', dur: 0.5 },
  { name: 'Slide Down', cat: 'Slide', anim: 'slideDown', dur: 0.5 },
  { name: 'Slide Left', cat: 'Slide', anim: 'slideLeft', dur: 0.5 },
  { name: 'Slide Right', cat: 'Slide', anim: 'slideRight', dur: 0.5 },
  { name: 'Slide Up Blur', cat: 'Slide', anim: 'slideUpBlur', dur: 0.6 },
  { name: 'Slide Down Blur', cat: 'Slide', anim: 'slideDownBlur', dur: 0.6 },
  // Scale
  { name: 'Scale Up', cat: 'Scale', anim: 'zoomOut', dur: 0.5 },
  { name: 'Scale Down', cat: 'Scale', anim: 'zoomIn', dur: 0.5 },
  { name: 'Stretch In', cat: 'Scale', anim: 'stretch', dur: 0.45 },
  { name: 'Scale From Center', cat: 'Scale', anim: 'growCenter', dur: 0.6 },
  // Fade
  { name: 'Fade In', cat: 'Fade', anim: 'fade', dur: 0.5 },
  { name: 'Soft Fade', cat: 'Fade', anim: 'softFade', dur: 0.7 },
  // Blur
  { name: 'Blur In', cat: 'Blur', anim: 'blurIn', dur: 0.6 },
  { name: 'Zoom Blur', cat: 'Blur', anim: 'zoomBlur', dur: 0.6 },
  { name: 'Blur Pop', cat: 'Blur', anim: 'blurPop', dur: 0.55 },
  // Rotate & Flip
  { name: 'Rotate In', cat: 'Rotate & Flip', anim: 'rotateIn', dur: 0.6 },
  { name: 'Spin In', cat: 'Rotate & Flip', anim: 'spinIn', dur: 0.7 },
  { name: 'Tilt In', cat: 'Rotate & Flip', anim: 'tiltIn', dur: 0.5 },
  { name: 'Flip Down', cat: 'Rotate & Flip', anim: 'flip', dur: 0.5 },
  { name: 'Flip Side', cat: 'Rotate & Flip', anim: 'flipSide', dur: 0.5 },
  { name: 'Slide & Rotate', cat: 'Rotate & Flip', anim: 'slideRotate', dur: 0.7 },
  // Bounce & Pop
  { name: 'Pop', cat: 'Bounce & Pop', anim: 'pop', dur: 0.45 },
  { name: 'Elastic Pop', cat: 'Bounce & Pop', anim: 'elasticPop', dur: 0.8 },
  { name: 'Drop In', cat: 'Bounce & Pop', anim: 'drop', dur: 0.7 },
  { name: 'Bounce Up', cat: 'Bounce & Pop', anim: 'bounceUp', dur: 0.7 },
  // Type & Words — per-character and per-word staggers the renderer truly supports.
  { name: 'Typewriter', cat: 'Type & Words', anim: 'typewriter', dur: 1.2 },
  { name: 'Word Pop', cat: 'Type & Words', anim: 'wordPop', dur: 0.7 },
  { name: 'Word Rise', cat: 'Type & Words', anim: 'wordRise', dur: 0.7 },
  { name: 'Letter Rise', cat: 'Type & Words', anim: 'waveIn', dur: 0.8 },
  { name: 'Tracking In', cat: 'Type & Words', anim: 'trackingIn', dur: 0.7 },
  { name: 'Fade Characters', cat: 'Type & Words', anim: 'charFade', dur: 0.9 },
  { name: 'Scale & Tracking', cat: 'Type & Words', anim: 'scaleTrack', dur: 0.8 },
  // Glitch & Flicker
  { name: 'Glitch In', cat: 'Glitch & Flicker', anim: 'glitchIn', dur: 0.5 },
  { name: 'Flicker In', cat: 'Glitch & Flicker', anim: 'flicker', dur: 0.6 },
  { name: 'Decode & Fade', cat: 'Glitch & Flicker', anim: 'decode', dur: 1 },
];

// Out mirrors: same renderer ids (the renderer mirrors the motion for exits); names describe the exit.
export const TEXT_ANIMS_OUT = [
  // Smooth leads the exits too (same renderer ids; the renderer mirrors the motion).
  { name: 'Slide Up Smooth', cat: 'Smooth', anim: 'slideUpSmooth', dur: 0.7 },
  { name: 'Slide Down Smooth', cat: 'Smooth', anim: 'slideDownSmooth', dur: 0.7 },
  { name: 'Slide Left Smooth', cat: 'Smooth', anim: 'slideLeftSmooth', dur: 0.7 },
  { name: 'Slide Right Smooth', cat: 'Smooth', anim: 'slideRightSmooth', dur: 0.7 },
  { name: 'Fade Up', cat: 'Smooth', anim: 'fadeUp', dur: 0.7 },
  { name: 'Fade Down', cat: 'Smooth', anim: 'fadeDown', dur: 0.7 },
  { name: 'Fade Left', cat: 'Smooth', anim: 'fadeLeft', dur: 0.7 },
  { name: 'Fade Right', cat: 'Smooth', anim: 'fadeRight', dur: 0.7 },
  { name: 'Glide Up', cat: 'Smooth', anim: 'glideUp', dur: 0.9 },
  { name: 'Settle Down', cat: 'Smooth', anim: 'settleUp', dur: 0.8 },
  { name: 'Chars Slide Up', cat: 'Smooth', anim: 'charSlideUp', dur: 0.9 },
  { name: 'Chars Slide Down', cat: 'Smooth', anim: 'charSlideDown', dur: 0.9 },
  { name: 'Slide Up', cat: 'Slide', anim: 'slideUp', dur: 0.5 },
  { name: 'Slide Down', cat: 'Slide', anim: 'slideDown', dur: 0.5 },
  { name: 'Slide Left', cat: 'Slide', anim: 'slideLeft', dur: 0.5 },
  { name: 'Slide Right', cat: 'Slide', anim: 'slideRight', dur: 0.5 },
  { name: 'Slide Up Blur', cat: 'Slide', anim: 'slideUpBlur', dur: 0.6 },
  { name: 'Slide Down Blur', cat: 'Slide', anim: 'slideDownBlur', dur: 0.6 },
  { name: 'Scale Down', cat: 'Scale', anim: 'zoomOut', dur: 0.5 },
  { name: 'Grow Out', cat: 'Scale', anim: 'zoomIn', dur: 0.5 },
  { name: 'Stretch Out', cat: 'Scale', anim: 'stretch', dur: 0.45 },
  { name: 'Scale To Center', cat: 'Scale', anim: 'growCenter', dur: 0.6 },
  { name: 'Fade Out', cat: 'Fade', anim: 'fade', dur: 0.5 },
  { name: 'Soft Fade Out', cat: 'Fade', anim: 'softFade', dur: 0.7 },
  { name: 'Blur Out', cat: 'Blur', anim: 'blurIn', dur: 0.6 },
  { name: 'Zoom Blur Out', cat: 'Blur', anim: 'zoomBlur', dur: 0.6 },
  { name: 'Blur Pop Out', cat: 'Blur', anim: 'blurPop', dur: 0.55 },
  { name: 'Rotate Out', cat: 'Rotate & Flip', anim: 'rotateIn', dur: 0.6 },
  { name: 'Spin Out', cat: 'Rotate & Flip', anim: 'spinIn', dur: 0.7 },
  { name: 'Tilt Out', cat: 'Rotate & Flip', anim: 'tiltIn', dur: 0.5 },
  { name: 'Flip Up', cat: 'Rotate & Flip', anim: 'flip', dur: 0.5 },
  { name: 'Flip Side Out', cat: 'Rotate & Flip', anim: 'flipSide', dur: 0.5 },
  { name: 'Slide & Rotate', cat: 'Rotate & Flip', anim: 'slideRotate', dur: 0.7 },
  { name: 'Pop Out', cat: 'Bounce & Pop', anim: 'pop', dur: 0.45 },
  { name: 'Elastic Pop Out', cat: 'Bounce & Pop', anim: 'elasticPop', dur: 0.8 },
  { name: 'Fly Up', cat: 'Bounce & Pop', anim: 'drop', dur: 0.7 },
  { name: 'Bounce Down', cat: 'Bounce & Pop', anim: 'bounceUp', dur: 0.7 },
  { name: 'Erase', cat: 'Type & Words', anim: 'typewriter', dur: 1 },
  { name: 'Word Pop Out', cat: 'Type & Words', anim: 'wordPop', dur: 0.7 },
  { name: 'Word Fall', cat: 'Type & Words', anim: 'wordRise', dur: 0.7 },
  { name: 'Letters Out', cat: 'Type & Words', anim: 'waveIn', dur: 0.8 },
  { name: 'Tracking Out', cat: 'Type & Words', anim: 'trackingIn', dur: 0.7 },
  { name: 'Fade Characters', cat: 'Type & Words', anim: 'charFade', dur: 0.9 },
  { name: 'Tracking Scale Out', cat: 'Type & Words', anim: 'scaleTrack', dur: 0.8 },
  { name: 'Glitch Out', cat: 'Glitch & Flicker', anim: 'glitchIn', dur: 0.5 },
  { name: 'Flicker Out', cat: 'Glitch & Flicker', anim: 'flicker', dur: 0.6 },
  { name: 'Decode & Fade', cat: 'Glitch & Flicker', anim: 'decode', dur: 1 },
];

export const textAnimPresets = (kind) => (kind === 'out' ? TEXT_ANIMS_OUT : TEXT_ANIMS_IN);
export const textAnimCategories = (kind) => TEXT_ANIM_CATEGORIES.filter((c) => textAnimPresets(kind).some((p) => p.cat === c));
