// CraftAI's editorial playbook: how an experienced editor approaches each kind
// of video. Returned by the edit_guide tool on demand so it does not weigh on
// every request. Numbers are starting points; the footage and brief win.

export const EDIT_WORKFLOW = `Editor workflow for any substantial edit (full edit, restructure, "make it better", a new short):
1. Understand: log_footage (speech, sentences, shots, fillers, retakes, hook candidates). Read the user's goal, platform and length.
2. Decide: pick the story — the hook (strongest line or moment), the order of the kept sentences, what to drop. Plan b-roll, music, captions and titles.
3. Propose: call propose_edit_plan and stop for approval unless the user already said to go ahead, the request is a small fix, or you are continuing an approved plan.
4. Execute in this order: format → remove_retakes → remove_fillers → remove_silences → keep_ranges/cuts for story → speed/zooms → b-roll → captions → titles → music (get_beats when cutting to music) → audio finishing and ducking.
5. Critique: critique_edit, fix every high and medium issue (or state why it is intentional), inspect key frames, then finish.`;

export const EDIT_GUIDE = {
  principles: `Principles of a strong edit:
- The first 1–3 s decide retention. Open on the most interesting line or image, never on "hi guys" or setup. A hook title (3–7 words) and a zoom or fast cut make the opening move.
- Cut on meaning, not only on silence: remove retakes, false starts, filler words and tangents before tightening pauses. Keep breaths that carry emotion.
- Every 3–6 s on vertical video (6–12 s on horizontal) something should change: a cut, a punch-in zoom (1.1–1.25×), b-roll, a title or a caption emphasis.
- Jump cuts on a talking head are fine when covered: alternate zoom levels (1.0 / 1.15) between consecutive cuts so the cut reads as intentional.
- One idea per caption: 3–5 words for vertical, up to 8 for horizontal; under ~20 characters per second. Keep captions in the safe area.
- Music supports, never competes: −20 to −25 dB below speech (volume 0.12–0.3), ducked under speech, faded out at the end. Cut on downbeats when the edit is music-driven.
- Audio target: speech clean and consistent (clear-voice or podcast preset), about −14 LUFS overall, no peaks above −1 dBTP.
- Restraint: straight cuts by default; transitions only between sections, 0.2–0.5 s. One focal point at a time.
- End with purpose: a clear final line, a call to action or a loopable last beat for shorts.`,

  tiktok: `TikTok / Reels / Shorts (9:16, 15–60 s):
- Format 9:16. Target 20–45 s unless asked; every second must earn its place.
- Hook in the first 1.5 s: the strongest sentence from find_highlights, a bold hook title (size 90–130, y 0.25–0.35) and a zoom in.
- Remove all retakes, fillers and pauses longer than 0.3 s (remove_silences min_silence_sec 0.3, keep_padding_sec 0.06).
- Captions: bold animated style, 2–4 words per caption, y 0.68–0.75 (above the app buttons). Highlight key words.
- Visual change every 2–4 s: alternate zoom levels on jump cuts, b-roll on concrete nouns, emoji/sfx sparingly (2–3 pops per video).
- Music: trending-feel track at 0.12–0.2 volume, ducked; cut the hook and section changes on beats (get_beats).
- End: no goodbye. End on the payoff or a loop back to the hook.`,

  youtube: `YouTube talking head / explainer (16:9, 3–15 min):
- Format 16:9. Cold open: the most compelling 5–15 s from later in the video, then title card or straight into the topic.
- Remove retakes and fillers; tighten pauses to 0.4–0.6 s (keep some breathing room for longer formats).
- Visual change every 6–12 s: punch-ins on emphasis, b-roll and on-screen text for lists, numbers and names (lower thirds).
- Chapters: a short title card or text at each section change; transitions only there.
- Captions optional (2 lines, 6–8 words); always for shorts cut from it.
- Music: low bed (0.1–0.2), different energy per section, ducked; silence for serious moments.
- End: summary line + call to action (subscribe / next video) in the last 5–10 s.`,

  podcast: `Podcast clip (9:16 or 1:1, 30–90 s, from a long conversation):
- Use find_highlights to choose one self-contained idea with a strong first sentence; keep_ranges around it (pad 0.2 s).
- Reframe to the active speaker (track_subject / set_transform focus) when the source is wide.
- Remove fillers and retakes; keep natural pauses under 0.5 s so the conversation still breathes.
- Captions are essential: 3–5 words, high contrast, speaker emphasis on key words.
- Title at the top: the question or claim being answered (3–8 words) for the first 3 s.
- Audio: podcast preset, loudnorm, no music or a very low bed (0.08–0.12).`,

  tutorial: `Tutorial / how-to (any format):
- Start with the result (show the finished thing) in the first 3 s, then the steps.
- Number the steps with on-screen text; one step per section; zoom into the detail being explained.
- Remove dead time (loading, typing, waiting) with cuts or speed-ups (set_speed 2–4 on idle stretches).
- Captions or step titles must stay on screen long enough to read (0.3 s per word + 0.6 s).
- Calm music bed (0.1–0.15) or none; clear-voice preset on narration.
- End with the result again and one-line recap.`,

  vlog: `Vlog / story (any format):
- Hook with the most emotional or surprising moment, then go back to the start of the story.
- Structure: setup → rising moments → peak → resolution. Drop moments that do not move the story.
- Mix talking clips with b-roll and ambient sound; J/L feel: let ambient audio start just before the picture of a new place.
- Music drives the mood: change track or energy at story beats; cut b-roll montages on beats (get_beats).
- Light color look (set_filter) consistent across clips; captions for speech segments.
- End on a reflective line or a strong final shot with music fade out.`,

  ad: `Product ad / promo (9:16 or 1:1 or 16:9, 15–30 s):
- Hook: the problem or the most striking product shot in the first second; bold text.
- Structure: problem → product → 2–3 benefits (one per shot, 2–3 s each, with a short text) → proof → offer/CTA.
- Fast pace: a visual change every 1–2 s, cut on beats, punchy sfx on reveals.
- Text: short benefit statements (max 5 words), brand colors, always readable.
- End card 2–3 s with the call to action and product name; music resolves on the last frame.`,
};

export const GUIDE_TOPICS = Object.keys(EDIT_GUIDE);
