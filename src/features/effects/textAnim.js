// Text Animations library: composer-style presets for text and caption clips, organised the way the big
// preset packs are — an In section and an Out section, each split into category folders. A preset is pure
// data: the animation id the shared text renderer (src/features/text/render.js) already knows how to play, plus the
// duration it was tuned with. Because the player and the export run the very same renderer, a preset that
// plays in the panel plays identically in the exported file — there is no separate "export version".
//
// The motions mirror what professional text preset packs actually do (studied from their animated
// previews): smooth sine-eased slides, slides that land out of focus, letter tracking that settles,
// per-character and per-word staggers, elastic overshoots. Categories and names describe the motion,
// nothing else — no pack artwork, wording or assets are reused.

import { t } from '../../i18n/index.js';

export const TEXT_ANIM_CATEGORIES = [
  'Smooth', 'Slide', 'Scale', 'Fade', 'Blur', 'Rotate & Flip', 'Bounce & Pop', 'Type & Words', 'Glitch & Flicker',
];

// preset: { name, cat, anim (renderer id), dur (seconds it was tuned with) }
export const TEXT_ANIMS_IN = [
  // Smooth — the sine-eased family leads the browser: the smooth slides, fade+position combos that
  // ride the full duration, a long glide, an overshoot settle, and per-character smooth staggers.
  { name: t('text.anim_slide_up_smooth'), cat: 'Smooth', anim: 'slideUpSmooth', dur: 0.7 },
  { name: t('text.anim_slide_down_smooth'), cat: 'Smooth', anim: 'slideDownSmooth', dur: 0.7 },
  { name: t('text.anim_slide_left_smooth'), cat: 'Smooth', anim: 'slideLeftSmooth', dur: 0.7 },
  { name: t('text.anim_slide_right_smooth'), cat: 'Smooth', anim: 'slideRightSmooth', dur: 0.7 },
  { name: t('text.anim_fade_up'), cat: 'Smooth', anim: 'fadeUp', dur: 0.7 },
  { name: t('text.anim_fade_down'), cat: 'Smooth', anim: 'fadeDown', dur: 0.7 },
  { name: t('text.anim_fade_left'), cat: 'Smooth', anim: 'fadeLeft', dur: 0.7 },
  { name: t('text.anim_fade_right'), cat: 'Smooth', anim: 'fadeRight', dur: 0.7 },
  { name: t('text.anim_glide_up'), cat: 'Smooth', anim: 'glideUp', dur: 0.9 },
  { name: t('text.anim_settle_up'), cat: 'Smooth', anim: 'settleUp', dur: 0.8 },
  { name: t('text.anim_chars_slide_up'), cat: 'Smooth', anim: 'charSlideUp', dur: 0.9 },
  { name: t('text.anim_chars_slide_down'), cat: 'Smooth', anim: 'charSlideDown', dur: 0.9 },
  // Slide — the essentials Hamza asked for first.
  { name: t('text.anim_slide_up'), cat: 'Slide', anim: 'slideUp', dur: 0.5 },
  { name: t('text.anim_slide_down'), cat: 'Slide', anim: 'slideDown', dur: 0.5 },
  { name: t('text.anim_slide_left'), cat: 'Slide', anim: 'slideLeft', dur: 0.5 },
  { name: t('text.anim_slide_right'), cat: 'Slide', anim: 'slideRight', dur: 0.5 },
  { name: t('text.anim_slide_up_blur'), cat: 'Slide', anim: 'slideUpBlur', dur: 0.6 },
  { name: t('text.anim_slide_down_blur'), cat: 'Slide', anim: 'slideDownBlur', dur: 0.6 },
  // Scale
  { name: t('text.anim_scale_up'), cat: 'Scale', anim: 'zoomOut', dur: 0.5 },
  { name: t('text.anim_scale_down'), cat: 'Scale', anim: 'zoomIn', dur: 0.5 },
  { name: t('text.anim_stretch_in'), cat: 'Scale', anim: 'stretch', dur: 0.45 },
  { name: t('text.anim_scale_from_center'), cat: 'Scale', anim: 'growCenter', dur: 0.6 },
  // Fade
  { name: t('text.anim_fade_in'), cat: 'Fade', anim: 'fade', dur: 0.5 },
  { name: t('text.anim_soft_fade'), cat: 'Fade', anim: 'softFade', dur: 0.7 },
  // Blur
  { name: t('text.anim_blur_in'), cat: 'Blur', anim: 'blurIn', dur: 0.6 },
  { name: t('text.anim_zoom_blur'), cat: 'Blur', anim: 'zoomBlur', dur: 0.6 },
  { name: t('text.anim_blur_pop'), cat: 'Blur', anim: 'blurPop', dur: 0.55 },
  // Rotate & Flip
  { name: t('text.anim_rotate_in'), cat: 'Rotate & Flip', anim: 'rotateIn', dur: 0.6 },
  { name: t('text.anim_spin_in'), cat: 'Rotate & Flip', anim: 'spinIn', dur: 0.7 },
  { name: t('text.anim_tilt_in'), cat: 'Rotate & Flip', anim: 'tiltIn', dur: 0.5 },
  { name: t('text.anim_flip_down'), cat: 'Rotate & Flip', anim: 'flip', dur: 0.5 },
  { name: t('text.anim_flip_side'), cat: 'Rotate & Flip', anim: 'flipSide', dur: 0.5 },
  { name: t('text.anim_slide_rotate'), cat: 'Rotate & Flip', anim: 'slideRotate', dur: 0.7 },
  // Bounce & Pop
  { name: t('text.anim_pop'), cat: 'Bounce & Pop', anim: 'pop', dur: 0.45 },
  { name: t('text.anim_elastic_pop'), cat: 'Bounce & Pop', anim: 'elasticPop', dur: 0.8 },
  { name: t('text.anim_drop_in'), cat: 'Bounce & Pop', anim: 'drop', dur: 0.7 },
  { name: t('text.anim_bounce_up'), cat: 'Bounce & Pop', anim: 'bounceUp', dur: 0.7 },
  // Type & Words — per-character and per-word staggers the renderer truly supports.
  { name: t('text.anim_typewriter'), cat: 'Type & Words', anim: 'typewriter', dur: 1.2 },
  { name: t('text.anim_word_pop'), cat: 'Type & Words', anim: 'wordPop', dur: 0.7 },
  { name: t('text.anim_word_rise'), cat: 'Type & Words', anim: 'wordRise', dur: 0.7 },
  { name: t('text.anim_letter_rise'), cat: 'Type & Words', anim: 'waveIn', dur: 0.8 },
  { name: t('text.anim_tracking_in'), cat: 'Type & Words', anim: 'trackingIn', dur: 0.7 },
  { name: t('text.anim_fade_characters'), cat: 'Type & Words', anim: 'charFade', dur: 0.9 },
  { name: t('text.anim_scale_tracking'), cat: 'Type & Words', anim: 'scaleTrack', dur: 0.8 },
  // Glitch & Flicker
  { name: t('text.anim_glitch_in'), cat: 'Glitch & Flicker', anim: 'glitchIn', dur: 0.5 },
  { name: t('text.anim_flicker_in'), cat: 'Glitch & Flicker', anim: 'flicker', dur: 0.6 },
  { name: t('text.anim_decode_fade'), cat: 'Glitch & Flicker', anim: 'decode', dur: 1 },
];

// Out mirrors: same renderer ids (the renderer mirrors the motion for exits); names describe the exit.
export const TEXT_ANIMS_OUT = [
  // Smooth leads the exits too (same renderer ids; the renderer mirrors the motion).
  { name: t('text.anim_slide_up_smooth'), cat: 'Smooth', anim: 'slideUpSmooth', dur: 0.7 },
  { name: t('text.anim_slide_down_smooth'), cat: 'Smooth', anim: 'slideDownSmooth', dur: 0.7 },
  { name: t('text.anim_slide_left_smooth'), cat: 'Smooth', anim: 'slideLeftSmooth', dur: 0.7 },
  { name: t('text.anim_slide_right_smooth'), cat: 'Smooth', anim: 'slideRightSmooth', dur: 0.7 },
  { name: t('text.anim_fade_up'), cat: 'Smooth', anim: 'fadeUp', dur: 0.7 },
  { name: t('text.anim_fade_down'), cat: 'Smooth', anim: 'fadeDown', dur: 0.7 },
  { name: t('text.anim_fade_left'), cat: 'Smooth', anim: 'fadeLeft', dur: 0.7 },
  { name: t('text.anim_fade_right'), cat: 'Smooth', anim: 'fadeRight', dur: 0.7 },
  { name: t('text.anim_glide_up'), cat: 'Smooth', anim: 'glideUp', dur: 0.9 },
  { name: t('text.anim_settle_down'), cat: 'Smooth', anim: 'settleUp', dur: 0.8 },
  { name: t('text.anim_chars_slide_up'), cat: 'Smooth', anim: 'charSlideUp', dur: 0.9 },
  { name: t('text.anim_chars_slide_down'), cat: 'Smooth', anim: 'charSlideDown', dur: 0.9 },
  { name: t('text.anim_slide_up'), cat: 'Slide', anim: 'slideUp', dur: 0.5 },
  { name: t('text.anim_slide_down'), cat: 'Slide', anim: 'slideDown', dur: 0.5 },
  { name: t('text.anim_slide_left'), cat: 'Slide', anim: 'slideLeft', dur: 0.5 },
  { name: t('text.anim_slide_right'), cat: 'Slide', anim: 'slideRight', dur: 0.5 },
  { name: t('text.anim_slide_up_blur'), cat: 'Slide', anim: 'slideUpBlur', dur: 0.6 },
  { name: t('text.anim_slide_down_blur'), cat: 'Slide', anim: 'slideDownBlur', dur: 0.6 },
  { name: t('text.anim_scale_down'), cat: 'Scale', anim: 'zoomOut', dur: 0.5 },
  { name: t('text.anim_grow_out'), cat: 'Scale', anim: 'zoomIn', dur: 0.5 },
  { name: t('text.anim_stretch_out'), cat: 'Scale', anim: 'stretch', dur: 0.45 },
  { name: t('text.anim_scale_to_center'), cat: 'Scale', anim: 'growCenter', dur: 0.6 },
  { name: t('text.anim_fade_out'), cat: 'Fade', anim: 'fade', dur: 0.5 },
  { name: t('text.anim_soft_fade_out'), cat: 'Fade', anim: 'softFade', dur: 0.7 },
  { name: t('text.anim_blur_out'), cat: 'Blur', anim: 'blurIn', dur: 0.6 },
  { name: t('text.anim_zoom_blur_out'), cat: 'Blur', anim: 'zoomBlur', dur: 0.6 },
  { name: t('text.anim_blur_pop_out'), cat: 'Blur', anim: 'blurPop', dur: 0.55 },
  { name: t('text.anim_rotate_out'), cat: 'Rotate & Flip', anim: 'rotateIn', dur: 0.6 },
  { name: t('text.anim_spin_out'), cat: 'Rotate & Flip', anim: 'spinIn', dur: 0.7 },
  { name: t('text.anim_tilt_out'), cat: 'Rotate & Flip', anim: 'tiltIn', dur: 0.5 },
  { name: t('text.anim_flip_up'), cat: 'Rotate & Flip', anim: 'flip', dur: 0.5 },
  { name: t('text.anim_flip_side_out'), cat: 'Rotate & Flip', anim: 'flipSide', dur: 0.5 },
  { name: t('text.anim_slide_rotate'), cat: 'Rotate & Flip', anim: 'slideRotate', dur: 0.7 },
  { name: t('text.anim_pop_out'), cat: 'Bounce & Pop', anim: 'pop', dur: 0.45 },
  { name: t('text.anim_elastic_pop_out'), cat: 'Bounce & Pop', anim: 'elasticPop', dur: 0.8 },
  { name: t('text.anim_fly_up'), cat: 'Bounce & Pop', anim: 'drop', dur: 0.7 },
  { name: t('text.anim_bounce_down'), cat: 'Bounce & Pop', anim: 'bounceUp', dur: 0.7 },
  { name: t('custom-mask-editor.erase'), cat: 'Type & Words', anim: 'typewriter', dur: 1 },
  { name: t('text.anim_word_pop_out'), cat: 'Type & Words', anim: 'wordPop', dur: 0.7 },
  { name: t('text.anim_word_fall'), cat: 'Type & Words', anim: 'wordRise', dur: 0.7 },
  { name: t('text.anim_letters_out'), cat: 'Type & Words', anim: 'waveIn', dur: 0.8 },
  { name: t('text.anim_tracking_out'), cat: 'Type & Words', anim: 'trackingIn', dur: 0.7 },
  { name: t('text.anim_fade_characters'), cat: 'Type & Words', anim: 'charFade', dur: 0.9 },
  { name: t('text.anim_tracking_scale_out'), cat: 'Type & Words', anim: 'scaleTrack', dur: 0.8 },
  { name: t('text.anim_glitch_out'), cat: 'Glitch & Flicker', anim: 'glitchIn', dur: 0.5 },
  { name: t('text.anim_flicker_out'), cat: 'Glitch & Flicker', anim: 'flicker', dur: 0.6 },
  { name: t('text.anim_decode_fade'), cat: 'Glitch & Flicker', anim: 'decode', dur: 1 },
];

export const textAnimPresets = (kind) => (kind === 'out' ? TEXT_ANIMS_OUT : TEXT_ANIMS_IN);
export const textAnimCategories = (kind) => TEXT_ANIM_CATEGORIES.filter((c) => textAnimPresets(kind).some((p) => p.cat === c));
// Category names are ids (presets refer to them); the browser shows these labels.
const CATEGORY_LABELS = {
  'Smooth': t('animation.smooth'),
  'Slide': t('text.anim_cat_slide'),
  'Scale': t('clip.scale'),
  'Fade': t('grade.fade'),
  'Blur': t('grade.blur'),
  'Rotate & Flip': t('text.anim_cat_rotate_flip'),
  'Bounce & Pop': t('text.anim_cat_bounce_pop'),
  'Type & Words': t('text.anim_cat_type_words'),
  'Glitch & Flicker': t('text.anim_cat_glitch_flicker'),
};
export const textAnimCategoryLabel = (cat) => CATEGORY_LABELS[cat] || cat;
