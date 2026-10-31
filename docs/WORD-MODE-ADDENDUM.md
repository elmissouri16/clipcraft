# Word-by-word unit mode — addendum (2026-10-30)

Follow-up to `FEATURE-TEST-REPORT-2026-10-30.md`. Hamza asked: *"add if you want to select word by
word, or does it stay just like this?"* — a preset no longer has to animate the whole text at once.

## What shipped

Every Text Animations preset (In and Out) can now play in one of three **units**, chosen per slot in
the Text inspector → Animation tab, in the new **Animate** control inside the preset browser:

- **Whole text** — the original behaviour; the default, so existing projects are unchanged.
- **Word by word** — each word plays the same motion in turn, first word to last.
- **Letters** — each letter plays the motion in turn, split only inside its own word.

The choice is stored on the same record as the preset — `animIn.unit` / `animOut.unit` next to
`{ id, dur }` — so In and Out can use different units, the duration slider still sets the total span,
and captions pick the unit up through the existing "apply to all captions" style routing.

## Stagger formula

Defined once in `src/text/units.js` and applied by the shared renderer (`src/text/render.js`), so the
panel preview, the player and the export compute the same numbers. With `n` units, an animation
duration `D` and global progress `p = lt / D` (entrances) or `p = (clipDur − lt) / D` (exits):

- Each unit owns a window of **0.62** of the progress span.
- Unit `i` starts at `i × step`, with `step = (1 − 0.62) / (n − 1)` (for `n ≥ 2`; a single unit just
  follows `p`).
- Local progress of unit `i`: `clamp01((p − i·step) / 0.62)`.

Consequences: unit 0 starts exactly at `p = 0`; the last unit finishes exactly at `p = 1` — the
stagger never stretches the animation past its duration; start times are strictly increasing;
neighbouring units overlap by ~38 % of a window, the cascade feel of the reference preset packs.
Exits mirror entrances with the offsets reversed (`(n − 1 − i) × step`), so the first word in reading
order also leaves first while the exit progresses. Units flow in reading order **across lines** —
layout already numbers words globally in reading order, and each unit animates around its own laid-out
position (a word slides up into its own slot, not the block's). Caption word timings (Whisper/SRT)
are *not* used for the stagger; it is uniform by design, so it behaves identically on titles and
captions.

Each unit replays the preset's own motion state (translation, scale, rotation, alpha, blur, glitch)
at its local progress. Letter tracking (`Tracking In/Out`) is a property of the shared layout, so it
still settles globally while the other channels stagger per unit.

## Letters and Arabic

Letters mode **shipped**, with one hard rule from the renderer: characters are only ever split inside
a word, and text the layout flags as RTL is **never** split into characters — joined script would
break. For Arabic (and other RTL) text, `effectiveUnit('char', rtl)` returns `'word'`, so every unit
is still a whole, correctly shaped word; the browser says exactly this under the control ("Arabic text
animates word by word instead — its letters stay joined"). Latin text gets true per-letter motion
(verified by the frame analysis pattern of the export test and the unit-math suite; the renderer path
is the same per-character painter the typewriter and wave presets already used).

Presets that already animate per unit on their own — Typewriter (per character), Word Pop / Word Rise
(per word), Letter Rise / Letters Out (per character) — ignore the unit setting, and the Animate
control is **disabled with an explanation** while one of them is active, rather than pretending to
change them.

## Parity evidence (preview = player = export, one renderer)

- `scripts/test-textanim.mjs` — stagger math: first unit starts at 0, starts strictly increase, last
  unit completes exactly at `p = 1` for n = 2, 3, 5, 12; monotonic in `p`; exit mirroring (first word
  leaves first); single-unit identity; unit vocabulary; RTL char→word fallback; renderer/browser
  wiring. **Pass.**
- `scripts/test-textanim-word-export.cjs` — drives the real app: applies Slide Up to "HELLO WORLD",
  clicks **Word by word**, exports through the real pipeline, then measures the MP4: at t = 0.10 s
  word 1 has **5,248 bright px** in its band at centroid y 203.3 (mid-rise, rest is 176.4) while word
  2's band has **0 px**; at t = 0.30 s word 2 is on screen at centroid y **198.4**, still ~22 px above
  its rest line 176.4; both words rest at 4.00 s, 640×360. **Pass.**
- `scripts/test-textanim-export.cjs` (previous whole-text test) still passes with identical numbers
  (centroid y 243.8 → 194.8 → 174.8) — whole-text behaviour is untouched.
- Full `.mjs` sweep: **21/21 pass**; `npm run build` passes.
- Screenshot: `~/workspace/clipcraft-shots/v5-01-wordmode.png` — Animate control with Word by word
  selected; the player paused at p = 0.5 of the entrance shows "CUT IT YOUR" landed on line 1 while
  "WAY" is still ghosting in on line 2 (reading order across lines).

## Notes from the first run

The first export test used "HELLO WORLD" at size 72, where the phrase is wider than the layout's
max width and wraps to two lines — the frame analysis briefly "found" word 2 early because it was
looking at the wrong line. Inspection of the actual frames showed the stagger working correctly
across the two lines. The test now uses size 60 (single line) with bands under each word and a dead
zone over the space.
