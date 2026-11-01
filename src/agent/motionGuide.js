// CraftAI's motion design recipes: what Remotion's best practices (remotion-dev/skills: timing, easing,
// scenes, transitions, captions, sound effects, Arabic text) teach, written as ClipCraft tool calls. Returned by the
// motion_guide tool only when needed, so the recipes do not weigh on every request.

export const MOTION_GUIDE = {
  principles: `Timing and motion, like a motion designer:
- Enter in 0.3-0.6 s, hold at least 1.5 s to read (about 0.3 s per word), exit in 0.2-0.4 s. Never let everything move at once: stagger elements by 0.1-0.2 s.
- Natural motion eases: keyframes with easing "spring" (no bounce) for things arriving, "back" for a playful pop, "out" to settle, "inout" for camera moves. Avoid "linear" except for very slow drifts.
- Scale pops: 0 -> 1.08 -> 1 (back) feels better than 0 -> 1. Small moves (x / y 0.03-0.08 of the frame) read as premium; big ones as cheap.
- One focal point at a time; keep text inside the middle 80% of the frame (safe area); on 9:16, keep captions above y 0.8 (the app buttons cover the bottom).
- Contrast: light text on dark or busy backgrounds needs an outline (stroke_width 6-10) or a box (background_color).`,

  intro: `Intro / hook (first 2-3 s):
1. Optional add_scene (gradient, 2.5 s, main_index 0) when there is no strong first shot.
2. add_text the hook (3-7 words), size 90-130 on 1080p, bold font (anton, bebas, montserrat; Arabic: cairo, lalezar, tajawal), anim_in "pop" or "zoomIn", anim_out "fade".
3. search_sounds sfx "whoosh" -> add_sound at the text start, volume 0.6.
4. On a video first shot instead: zoom style "smooth" from 0 to 2 s, scale 1.15, and the hook text over it.`,

  title_card: `Title card between parts:
1. add_scene color (or gradient) 2 s at the right main_index.
2. add_text title on it, y 0.45, anim_in "slideUp", anim_out "fade"; a smaller subtitle at y 0.58 starting 0.2 s later (stagger).
3. add_transition "fade" (0.3-0.5 s) into and out of the card.
4. sfx: "swoosh" or "whoosh" on the title, volume 0.5.`,

  kinetic_text: `Kinetic typography (text that tells the story, word by word):
- One add_text per short phrase (2-4 words), each starting when the previous one ends, anim_in "wordPop" or "wordRise" (they reveal word by word; Arabic stays joined), anim_out "fade".
- Alternate sizes for rhythm: key word big (130+), others 70-90; vary y slightly (0.42 / 0.5 / 0.58).
- With speech: transcribe, then time each phrase on the spoken words.
- A "pop" sfx (search_sounds sfx "pop") on 2-3 key words, never on all.`,

  lower_third: `Lower third (name / title of a speaker):
- add_text name, x 0.06-0.1, align left, y 0.78, size 56, bold, background_color dark (#000000) or brand color, anim_in "slideRight", anim_out "slideLeft", 3-4 s.
- add_text role below, y 0.85, size 36, starting 0.15 s later, same animations.
- On 9:16 use y 0.68 / 0.74 (stay above the captions).`,

  end_card: `End card / call to action (last 3 s):
1. add_scene (gradient in the brand colors) 3 s at the end, or freeze on the last shot with set_color brightness -0.3 to darken it.
2. add_text the call to action ("Follow for more", "اشترك فالقناة") anim_in "pop", anim_loop "pulse".
4. Music: fade_out_sec 2 so it ends with the video.`,

  logo_reveal: `Logo or picture reveal:
- add_media the logo as "overlay" over a scene, set_transform scale 0.4, then add_keyframes scale: 0 at start, 0.44 at +0.35 s (easing back), 0.4 at +0.6 s (easing out); opacity 0 -> 1 in 0.2 s.
- Optional slow drift: scale 0.4 -> 0.43 over the rest (easing linear) so it never looks frozen.
- sfx "ding" or "impact" at the moment it lands.`,

  zoom: `Zooms on speech:
- Pick 1 strong moment every 5-10 s (a punchline, a number, a key claim) from transcribe; 1-3 s each.
- zoom style "cut" (punch-in, 1.2-1.35) for energy; style "smooth" (springs in, eases out) for emphasis.
- Do not zoom two moments back to back; leave at least 3 s between.
- Optional "whoosh" at a smooth zoom start, volume 0.4.`,

  transitions: `Cuts and transitions:
- Most cuts need no transition: jump cuts keep energy. Use add_transition only between different scenes or places (fade, slide, zoom), 0.3-0.5 s.
- Light at a cut (like a light leak): add_effect a light effect (list_options effects, e.g. a "Particles & light" one) for 0.6 s centered on the cut, instead of a transition.
- Sound on cuts: "whoosh" / "swoosh" for slides and zooms, "camera shutter" for photos.`,

  sound_design: `Sound design:
- Music under speech: volume 0.15-0.25, fade_in_sec 1, fade_out_sec 2, duration_sec ending with the video. Without speech: 0.6-0.8.
- sfx at most every 3-5 s: whoosh (moves, transitions), pop (text appears), ding (list items, checkmarks), impact (big reveal), camera shutter (photos), record scratch (sudden stop).
- Meme sounds (kind "meme": bruh, vine boom, fah) only for funny or casual videos, at the joke, never under speech.
- Place each sfx 0.05 s before the visual event it belongs to.`,

  list: `List or steps (1, 2, 3...):
- One add_text per item, same x, y going down (0.35, 0.47, 0.59...), each starting 0.6-1 s after the previous, anim_in "slideRight", staying until the list ends.
- "ding" sfx on each item; highlight the current item by edit_text color on its start.
- For Arabic, align right and slide from the right ("slideLeft").`,

  captions: `Captions that look like the big creators:
- add_captions in the video's language, then edit_text clip_id "captions": bold font (montserrat, anton; Arabic cairo, tajawal), size 70-90 on 1080p (9:16: 60-75), stroke_width 6-8, highlight "karaoke" or "color" with a strong color (#ffd400, #22c55e), y 0.72 on 9:16 / 0.85 on 16:9.
- Short lines (the app splits them); avoid more than 2 lines.`,

  arabic: `Arabic and Darija:
- Animate Arabic by word or by line, never by letter (letters must stay joined): anim_in "wordPop", "wordRise", "fade", "pop", "slideUp" are good; avoid letter effects.
- Use Arabic fonts (cairo, tajawal, almarai, lalezar for titles, amiri for elegant), align right for lists and lower thirds, and slide from the right.
- Captions: language "ar"; the karaoke highlight already runs right to left.`,
};

export const MOTION_TOPICS = Object.keys(MOTION_GUIDE);

// Named editing styles: a whole edit from one word ("edit it Orbit style"). Each is a recipe of ClipCraft tool calls
// (real filter / effect / transition / animation / caption ids). edit_style returns one by name or alias; emoji and
// tag are for the style cards in CraftAI's panel.
export const EDIT_STYLES = {
  orbit: {
    emoji: '🌙',
    tag: 'Camera floats in a slow circle',
    title: 'Moon Drift',
    aliases: ['moon', 'drift', 'orbital', 'circle cam'],
    look: 'Dreamy camera that slowly circles the subject; smooth, floating, cinematic.',
    recipe: `1. remove_silences (min_silence_sec 0.5). set_filter "dreamy" or "cinematic" on every clip.
2. Every main clip: set_transform scale 1.1 (room to move), then add_keyframes x and y on a small circle, one turn every 6-8 s: x 0 -> 0.025 -> 0 -> -0.025 -> 0 and y -0.025 -> 0 -> 0.025 -> 0 -> -0.025 (quarter turns, easing inout), plus rotation -1.5 -> 1.5 -> -1.5 (easing inout).
3. Short clips (under 3 s) and photos: set_animation combo "orbit" (a full spin) instead, at most two in the video.
4. Between scenes: add_transition "fx_swipe" or "dissolve" (0.5 s), whoosh sfx on each.
5. Title at the start: add_text, font "montserrat" bold, anim_in "zoomIn", anim_loop "float", anim_out "fade".
6. Captions: add_captions, edit_text "captions" style cap-minimal, highlight "color" #ffffff.
7. Music: search_sounds music "ambient cinematic", volume 0.2 under speech, fades.`,
  },
  ui_world: {
    emoji: '💬',
    tag: 'Cards, chats and taps',
    title: 'App Story',
    aliases: ['app', 'phone ui', 'interface', 'notification', 'chat'],
    look: 'The video as a phone / app interface: notification cards, chat bubbles, check marks, clicks.',
    recipe: `1. remove_silences. set_filter "crisp" on every clip. On 16:9 keep it; for phones use 9:16.
2. Key points (from transcribe) appear as notification cards at the top: add_text 4-7 words, y 0.12, size 44, font "poppins", color #111111, background_color #ffffff, bubble "rounded", anim_in "slideDown", anim_out "slideUp", 2.5 s; one every 6-10 s.
3. Dialogues or questions as chat bubbles: add_text bubble "speech", alternating x 0.3 (white #ffffff, dark text) and x 0.7 (blue #2563eb, white text), y 0.35-0.6, anim_in "pop".
4. Check marks: a small add_text "✅" next to each finished point, anim_in "pop"; sfx search_sounds sfx "mouse click" on each card and "notification" on the first.
5. Captions: add_captions, edit_text "captions" style cap-boxed, font "poppins", background_color #ffffff, color #111111, bubble "pill", highlight "color" #2563eb.
6. Transitions: add_transition "fx_phone" or "slideleft" between parts.
7. Title / end: add_scene light gradient #f8fafc -> #e2e8f0, a card text with bubble "rounded" and a subscribe label (template_id label-subscribe).
8. Music: search_sounds music "lofi" or "tech", volume 0.15.`,
  },
  crt: {
    emoji: '📟',
    tag: 'Scan lines, green terminal glow',
    title: 'Tube TV',
    aliases: ['old tv', 'retro tv', 'terminal', 'tv', 'scanlines'],
    look: 'Old CRT screen / green terminal: scan lines, noise, pixel font, phosphor glow.',
    recipe: `1. set_effects on every main clip: ["fx_vhs", "grain", "vignette"] (scan lines and noise); set_filter "vintage" (or "noir" for black and white).
2. Text in terminal style: font "pixel", color #33ff66, effect "neon", anim_in "typewriter" (Latin text only; Arabic: "fade"), size 48-60; labels like "> REC", "> LOADING..." in a corner (x 0.12, y 0.1).
3. Intro: add_scene #000000 2 s, add_text the title in green pixel font, anim_in "typewriter", anim_loop "blink"; sfx search_sounds sfx "tv static".
4. Between parts: add_transition "fx_mosaic" or "fadeblack" (a TV switching), sfx "glitch" or "static".
5. On key moments: add_effect "fx_striped" for 0.4 s (signal glitch) and zoom style "cut" 1.2.
6. Captions: add_captions, edit_text "captions" font "pixel" (Arabic: "cairo"), color #33ff66, stroke_width 0, background_color #000000, highlight "color" #ffffff.
7. End: add_effect "fx_bwgrit" for the last 1 s, add_transition "fadeblack". Music: search_sounds music "synthwave" or "retro", volume 0.2.`,
  },
  hormozi: {
    emoji: '📣',
    tag: 'Giant captions, punch zooms, no dead air',
    title: 'Loud & Clear',
    aliases: ['loud', 'business', 'value', 'big captions'],
    look: 'Fast, dense, no dead air: big word-by-word captions, punch zooms, emojis on key words.',
    recipe: `1. remove_silences tight (min_silence_sec 0.35, keep_padding_sec 0.08).
2. add_captions, edit_text "captions" style cap-hormozi, size large, y 0.7 on 9:16.
3. zoom style "cut" 1.25 every 4-6 s on key claims (transcribe), alternating 1.0 / 1.25.
4. Emphasis on 3-5 key words: zoom or a "pop" sfx on each (💰 🔥 ✅ 🚀 moments).
5. No transitions. Music optional, very low (0.1). set_color all saturation 1.1, contrast 1.05.`,
  },
  mrbeast: {
    emoji: '🚀',
    tag: 'Loud, fast, saturated',
    title: 'Full Send',
    aliases: ['hype', 'high energy', 'loud edit'],
    look: 'Loud and fast: saturated colors, quick zooms, big hook, whooshes and impacts.',
    recipe: `1. remove_silences tight. set_filter "vivid" on every clip; set_color all saturation 1.25, contrast 1.1.
2. Hook at 0 s: add_text 3-5 words template_id title-bold, size 120, anim_in "pop", anim_loop "pulse", 2 s; "impact" sfx.
3. zoom every 3 s, alternating style "cut" 1.3 and "smooth" 1.15; "whoosh" on smooth ones.
4. add_captions style cap-beast. Stickers 😱 🔥 💯 on reactions.
5. add_effect "fx_zoomblast" 0.4 s on 2-3 big moments. Music: "energetic" volume 0.2.`,
  },
  cinematic: {
    emoji: '🍿',
    tag: 'Teal and orange, slow and elegant',
    title: 'Silver Screen',
    aliases: ['film', 'movie', 'cinema', 'cinematic'],
    look: 'Film look: teal and orange, slow camera moves, elegant titles, quiet sound.',
    recipe: `1. set_filter "tealorange" (or "cinematic") on every clip; set_effects ["vignette", "grain"].
2. Each clip: set_animation combo "kenburns" (slow push) or "pullback", alternating.
3. Transitions: "dissolve" or "fadeblack" 0.6-0.8 s between scenes.
4. Title: add_scene #000000 2.5 s at main_index 0, add_text template_id title-elegant (font "cinzel" or "playfair"), anim_in "fade" 1 s, letter-spaced, then fade out.
5. Captions only if there is speech: cap-minimal. Music: "cinematic ambient" volume 0.3, long fades.`,
  },
  vlog: {
    emoji: '☀️',
    tag: 'Warm light, jump cuts, place names',
    title: 'Sunny Day',
    aliases: ['vlog', 'daily vlog', 'lifestyle', 'sunny'],
    look: 'Warm, light and friendly: jump cuts, upbeat music, place names.',
    recipe: `1. remove_silences. set_filter "warm" or "golden" on every clip.
2. Place names: lower third (motion_guide lower_third) when the place changes.
3. add_captions style cap-classic. Transitions "slideleft" between places, whoosh on each.
4. Music: "upbeat vlog" volume 0.2 under speech, louder (0.6) on parts without speech.
5. A light "pop" sfx on fun moments.`,
  },
  podcast: {
    emoji: '🛋️',
    tag: 'Word Sweep captions, clean two-cam cuts',
    title: 'Talk Show',
    aliases: ['podcast', 'interview', 'talking head', 'clip'],
    look: 'Clean clip of a conversation: centered Word Sweep captions, subtle cuts in.',
    recipe: `1. set_aspect_ratio 9:16 if for social. remove_silences.
2. add_captions style cap-karaoke, y 0.65.
3. Alternate framing every 6-10 s: zoom style "cut" 1.15 (like a second camera).
4. Speaker names: lower third at the start (motion_guide lower_third).
5. No music, or very low (0.08).`,
  },
  minimal: {
    emoji: '🫧',
    tag: 'Clean space, thin type, soft fades',
    title: 'Less Is More',
    aliases: ['clean', 'simple', 'minimal'],
    look: 'Clean and calm: white or black space, thin type, soft fades.',
    recipe: `1. set_filter "matte" or "crisp". Transitions "fade" 0.5 s.
2. Titles on add_scene #ffffff (text #111111) or #000000 (text #ffffff), font "montserrat" or "poppins", size 70, anim_in "slideUp" with fade, generous margins.
3. Captions cap-minimal.
4. Music: "soft piano" volume 0.2.`,
  },
  glitch: {
    emoji: '👾',
    tag: 'Neon colors, a glitch on every cut',
    title: 'Neon Static',
    aliases: ['cyber', 'cyberpunk', 'tech', 'neon', 'glitch'],
    look: 'Digital and edgy: neon colors, glitches on cuts, distorted titles.',
    recipe: `1. set_filter "cyber" or "neonpink". set_effects ["grain"].
2. On cuts: add_effect "fx_vhs" or "fx_striped" 0.3 s; transitions "fx_mosaic" / "fx_snapback".
3. Titles: template_id title-glitch, anim_in "glitchIn", anim_loop "glitch".
4. Captions: cap-neon. sfx "glitch" on cuts. Music: "electronic" or "synthwave" 0.25.`,
  },
  retro: {
    emoji: '📻',
    tag: '90s home video, faded and warm',
    title: 'Tape Days',
    aliases: ['vhs', 'vintage', '80s', '90s', 'retro'],
    look: 'Home video from the 90s: VHS noise, faded colors, typewriter text.',
    recipe: `1. set_filter "vintage" or "polaroid"; set_effects ["fx_vhs", "grain"].
2. Date stamp: add_text "PLAY ▶" at x 0.12, y 0.1, font "pixel", color #ffffff for the whole video.
3. Titles: template_id title-typewriter or title-retro. Transitions "fadeblack".
4. sfx "record scratch" on a stop; music "retro" or "lofi" 0.25.`,
  },
  meme: {
    emoji: '💀',
    tag: 'Reaction zooms and meme sounds',
    title: 'Chaos Cut',
    aliases: ['funny', 'troll', 'chaos', 'meme'],
    look: 'Funny edit: zoom on reactions, meme sounds, emojis, shakes.',
    recipe: `1. remove_silences. Captions cap-y2k.
2. On each joke / reaction: zoom style "cut" 1.5 for 1 s, set_animation combo "vibrate" on very short clips, meme sound (search_sounds meme "vine boom", "bruh", "fah").
3. Stickers 😂 💀 😭 on reactions. A "record scratch" before a twist.
4. Do not stack: one meme sound every 5-10 s at most.`,
  },
  documentary: {
    emoji: '🗺️',
    tag: 'Chapters, b-roll and name cards',
    title: 'True Story',
    aliases: ['docu', 'explainer', 'story', 'documentary'],
    look: 'Calm storytelling: chapter title cards, b-roll, names and places, film colors.',
    recipe: `1. set_filter "film". Captions cap-subtitle at the bottom.
2. Chapters: title cards (motion_guide title_card) at each new part.
3. b-roll: search_stock video for the topics mentioned (transcribe), add_stock overlay 3-4 s over the speech, 1 every 15-20 s.
4. Lower thirds for people and places. Transitions "dissolve". Music "documentary" 0.2.`,
  },
  travel: {
    emoji: '🌍',
    tag: 'Big place titles, quick slides',
    title: 'Postcard',
    aliases: ['trip', 'adventure', 'travel'],
    look: 'Sunny and moving: big place titles, quick b-roll, slides.',
    recipe: `1. set_filter "sunset" or "golden".
2. Big place title when the place changes: add_text font "bebas" size 140, anim_in "wordRise".
3. Transitions "slideleft" / "slideright" alternating with whoosh. set_speed 1.2 on calm b-roll.
4. Stock b-roll of the places when the footage is short. Music "travel upbeat" 0.4.`,
  },
  product_ad: {
    emoji: '🏷️',
    tag: 'Logo reveal, features, call to action',
    title: 'Launch Day',
    aliases: ['ad', 'promo', 'commercial', 'saas', 'launch'],
    look: 'Short promo: logo reveal, feature list, punchy zooms, call to action.',
    recipe: `1. Intro: add_scene gradient in the brand colors 2 s, logo reveal (motion_guide logo_reveal).
2. Features: list (motion_guide list) or one card per feature with bubble "rounded".
3. Zooms on the product, "whoosh" and "ding" sfx. Captions cap-boxed.
4. End card with call to action (motion_guide end_card). Music "corporate upbeat" 0.3.`,
  },
  news: {
    emoji: '🔴',
    tag: 'Breaking label and headline boxes',
    title: 'Front Page',
    aliases: ['breaking news', 'news highlight', 'headline', 'news'],
    look: 'News report: BREAKING label, headline boxes, highlighted words.',
    recipe: `1. Label at the top left: add_text "BREAKING" / "عاجل", background_color #dc2626, color #ffffff, bold, x 0.14, y 0.08, anim_in "slideRight", whole video.
2. Headline lower third: background_color #111111, color #ffffff, size 52, y 0.82, anim_in "slideUp".
3. Key words: highlight "marker" or edit_text with background_color #facc15.
4. Captions cap-subtitle. "ding" sfx on each headline; music "news" 0.15.`,
  },
};

export const STYLE_NAMES = Object.keys(EDIT_STYLES);

// The style for a name the user typed ("App Story", "Tube TV", "Loud & Clear style"...), or null.
export function findStyle(name) {
  const norm = (s) => String(s || '').toLowerCase().replace(/style|edit|montage|ستايل/g, '').replace(/[^a-z0-9؀-ۿ]+/g, '');
  const q = norm(name);
  if (!q) return null;
  for (const [id, st] of Object.entries(EDIT_STYLES)) {
    if ([id, st.title, ...st.aliases].some((n) => norm(n) === q)) return id;
  }
  if (q.length < 3) return null;
  for (const [id, st] of Object.entries(EDIT_STYLES)) {
    if ([id, st.title, ...st.aliases].some((n) => norm(n).length >= 3 && (norm(n).includes(q) || q.includes(norm(n))))) return id;
  }
  return null;
}
