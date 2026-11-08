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
