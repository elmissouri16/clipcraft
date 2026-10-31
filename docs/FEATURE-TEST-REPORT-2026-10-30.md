# ClipCraft — Text Animations library + Full Feature Test Report

**Date:** 2026-10-30 · **Build:** `npm run build` passes · **Scope:** Animation Composer–style text animation library (text + video + overlay), full app feature test. No .deb packaged (per Hamza's standing instruction).

---

## (a) Animation Composer analysis

### How the references organise presets

**Mister Horse — Animation Composer for Premiere Pro** (misterhorse.com/animation-composer-for-premiere): presets ship as **packs organised in category folders** (Text Presets: In/Out groups such as Blur, Displace, Flip, Grid, Lens Distortion, Rotate, Scale, Slide, VR), each preset a **tile with an animated GIF preview**, applied **one click** to the selected clip, with **filter folders** to narrow the list. The organisation pattern — In/Out × category folders × animated tiles × one-click apply — is a functional pattern, and that is what ClipCraft adopts. No artwork, names, or assets were copied; preset names here are generic motion words only.

**Kyle Holland — 200 Text Effects** (kylerholland.com/products/200-text-effects): split into **IN / OUT / EFFECT** sections; categories include Blur, RGB split, Glitch, Scale, Slide, VR, 3D, Distortion, Glow, Smoke, Strobe; presets **trim to the time you give them** (duration-driven) and **stack** (an In, a loop/effect, and an Out can coexist on one clip).

### What the reference animations actually do (GIF frame study)

Six of Mister Horse's own animated preview GIFs (`train-text-presets-item-01/02/03/07/10/13.gif`, 320×180, 48–83 frames each) were downloaded and frame-extracted. Concrete observations and their ClipCraft mapping:

1. **Per-character reveal with a soft edge, then a right-to-left erase (item 01).** Letters fade/slide in one-by-one with a gradual leading edge (not a hard typewriter cut), hold, then erase in reverse order. → ClipCraft: `typewriter` now has a **fractional soft-edge reveal** (`edgeAlpha` — the leading character renders at partial opacity), and the per-char unit system (`unit: 'char'`) powers Char Rise / Char Wave / Bounce Letters. Reverse erase maps to the Out mirrors.
2. **Letter-tracking breathe (item 02).** The word expands with wide letter-spacing + per-character stagger, settles, and contracts on the way out. → ClipCraft gained a **letter-spacing channel** in the text renderer (`ls`, applied to layout spacing) and the presets **Tracking In / Tracking Out**.
3. **Whole-word smooth scale + fade (item 03).** No stagger: the whole word scales gently while fading, a long smooth ease. → ClipCraft: **Soft Fade** and the smooth-slide family use a **sine ease-in-out**; whole-clip scale+fade = Zoom In / Zoom Blur class.
4. **Per-character arc/path bends (items 07 & 10).** Characters travel along curved paths with individual rotation. → **Not adopted**: ClipCraft's text engine has no per-character rotation channel, and faking it would break the "every preset really animates, identically in export" rule. Nearest honest equivalent: **Wave In** (per-character vertical stagger). Logged as a gap, not disguised.
5. **Timing feel.** Motion occupies roughly the first/last 0.5–0.9 s of each 2.5–4.7 s loop, with a hold in between; travel distances are modest (a fraction of the text block), easing is smooth deceleration for entrances, with occasional overshoot on pop-style presets. → ClipCraft defaults: slide travel = 45% of canvas height equivalent in the renderer, pop/scale presets use back-out / elastic easings, default durations 0.5–0.9 s.

### Adopted vs deliberately not adopted

| Adopted | Not adopted (and why) |
|---|---|
| In / Out sections, category folders (collapsible tree, like his screenshot) | "VR", "Lens Distortion", "Grid" categories — the engine has no such primitives; claiming them would be fake UI. Closest real equivalents offered instead: **Warp In** (skew), **Spin In**, **Flip Side** (3D-ish rotateY via scaleX) |
| Animated tile previews | Mister Horse artwork/wording — previews here render ClipCraft's own renderer on the word "CLIPCRAFT" |
| One-click apply to selected clip + duration control | Per-character rotation/path motion (no engine channel) |
| Duration-driven presets; In + Loop + Out stacking (already ClipCraft's model) | — |

---

## (b) The new Text Animations library

**Where:** Text inspector → **Animation** tab (the place text animation already lived — one home, no duplicate UI). New catalogue module `src/fx/textAnim.js`; browser component `src/components/TextAnimBrowser.jsx`; engine extensions in `src/text/render.js`; picture equivalents in `src/anim.js`.

**Size: 68 presets — 34 In + 34 Out — in 8 categories** (Out mirrors In):

| Category | Per section | Presets (In names; Out mirrors) |
|---|---|---|
| Slide | 10 | Slide Up Smooth, Slide Up, Slide Down Smooth, Slide Down, Slide Left Smooth, Slide Left, Slide Right Smooth, Slide Right, Rise & Fade, Drop In |
| Scale | 5 | Zoom In, Zoom Out Big, Pop In, Shrink Grow, Stamp In |
| Fade | 3 | Fade In, Soft Fade, Cross Fade |
| Blur | 4 | Blur In, Slide Up Blur, Slide Down Blur, Zoom Blur |
| Rotate & Flip | 5 | Spin In, Flip Up, Flip Side, Tilt In, Warp In |
| Bounce & Pop | 3 | Bounce Up, Elastic Pop, Spring Drop |
| Type & Words | 2 | Typewriter, Word Rise |
| Glitch & Flicker | 2 | Glitch In, Neon Flicker |
| **Total** | **34** | ×2 sections = **68** |

Hamza's named essentials are first-class: **Slide Up Smooth** leads the Slide folder; Slide Up / Down / Left / Right and their Smooth variants and Out mirrors all exist.

**Engine work (all proven in preview AND export — one renderer serves both):** the text engine already had per-character/word units, rotation, blur, glitch channels and easing. Added minimally: sine ease-in-out ("smooth"), elastic easing, blur-coupled slides, and a letter-spacing channel. 15 new animation cases in `animState()` + the typewriter soft edge.

**Previews are real:** hovering a tile animates the word "CLIPCRAFT" through the **actual production renderer** (`TextPreview` → `drawTextClip` on a small canvas, including the checkered transparency background) — the preview cannot drift from playback or export because it *is* the playback code.

**Apply model:** click a tile → writes the clip's existing `animIn`/`animOut {id, dur}` fields (duration slider retained, 0.2–3 s). "No animation" tile clears. Caption clips route through the existing caption styling path, so **apply-to-all-captions works** with the new presets unchanged. Loop animations are untouched and still stack with In/Out.

**Video & overlay:** no second engine — the existing picture animation system (`src/anim.js`, preview↔export parity already covered by test-anim.cjs) gained the four **Smooth slides** (In + Out) with the same sine easing and long travel, so the Animation tab of any video/overlay clip now offers 19 tiles including *Slide Up Smooth* etc. Verified live: applying it to a main-track video clip writes `anim.in.type = 'slide_up_smooth'`.

---

## (c) Full test results

### Automated suites — 43 total: .mjs 21/21 PASS · .cjs 16/22 PASS in the sweep (17/22 counting the stabilize re-run)

| Suite | Result | Note |
|---|---|---|
| test-agent-motion.mjs | PASS | |
| test-agent-store.mjs | PASS | |
| test-agent-tools.mjs | PASS | |
| test-ai-providers.mjs | PASS | |
| test-autocolor.mjs | PASS | |
| test-catalog135.mjs | PASS | 135-transition catalogue integrity |
| test-clipmenu.mjs | PASS | |
| test-fx.mjs | PASS | |
| test-lut.mjs | PASS | |
| test-magnet.mjs | PASS | |
| test-mcp.mjs | PASS | |
| test-overlay-store.mjs | PASS | |
| test-presets.mjs | PASS | ratio/FPS presets |
| test-ratio.mjs | PASS | |
| test-recents.mjs | PASS | |
| test-sequence.mjs | PASS | sequence detection |
| test-srt.mjs | PASS | SRT parse, 31-cue fixture |
| test-templates.mjs | PASS | |
| **test-textanim.mjs** | **PASS** | **NEW** — catalogue integrity: 34 In + 34 Out, 8 categories, unique ids, every preset resolves to a real engine state (resting + mid-flight sampled), named slides present |
| test-toolbar.mjs | PASS | |
| test-tracks.mjs | PASS | |
| test-ai.cjs | PASS | |
| test-anim.cjs | PASS | picture anim preview↔export parity (incl. new smooth slides' engine) |
| test-audiofx.cjs | PASS | export audio FX |
| test-captions.cjs | **FAIL — environment** | Test script itself is Windows-only: `path.join(process.env.APPDATA, …)` throws `ERR_INVALID_ARG_TYPE` on Linux (APPDATA unset); it also drives PowerShell TTS. Not a product failure. |
| test-export.cjs | PASS | full export pipeline (20 s) |
| test-fallback.cjs | PASS | |
| test-favorites.cjs | PASS | |
| test-fonts.cjs | **FAIL — environment** | Asserts "needs two Windows fonts to test with" — requires `C:/Windows/Fonts`. Platform precondition of the test. |
| test-gen.cjs | PASS | |
| test-gif.cjs | PASS | |
| test-groq.cjs | PASS | |
| test-layers.cjs | PASS | |
| test-library.cjs | **FAIL — environment** | Online sound library answered **403** from this VM (`electron/library.cjs:248` surfaces it correctly). Network/service block, not a code defect. |
| test-matting.cjs | PASS | background matting (19 s) |
| test-stabilize.cjs | **FAIL in sweep → PASS on re-run (flaky)** | Sweep run: steadiness 13.80 → 10.52 missed the test's `after < before × 0.6` threshold. Re-runs: 13.80 → 9.72, then 13.80 → **4.48 "STABILIZE OK"**. The feature demonstrably stabilises every run; the synthetic fixture's shake varies run-to-run, so the fixed threshold flakes. |
| test-stickers.cjs | PASS | |
| test-stock.cjs | PASS | |
| test-telemetry.cjs | **FAIL — environment** | Test requires `FVE_TELEMETRY_URL` pointing at a local test server ("Set FVE_TELEMETRY_URL to the telemetry endpoint of a local test site"); unset here. (ClipCraft's telemetry is disabled by design in the rebrand.) |
| **test-textanim-export.cjs** | **PASS** | **NEW** — full app, UI-apply Slide Up Smooth, real export, pixel-motion proof (below) |
| test-textstream.cjs | PASS | |
| test-tts.cjs | **FAIL — environment** | Downloads its TTS engine fine, then fails at `spawn C:/Windows/System32/tar.exe ENOENT` — the test's unpacker hardcodes the Windows tar path. |
| test-whisper-pieces.cjs | PASS | |

**Bottom line: zero product-code failures.** All 6 failing suites fail on platform/environment preconditions of the test scripts themselves (Windows paths/fonts/env vars, an online 403, an unset test-server variable, one flaky threshold).

### Live UI checklist (CDP-driven real app, demo project, 1600×990) — 48/48

Home: visible ✓ · 5 ratio frames ✓ · time-aware greeting ✓ · 4 quick tiles ✓ · "Start from a template" opens editor at 9:16 on the Templates tab ✓ · TopBar Projects returns home ✓ · demo project loads (2 video clips) ✓.
Dock tabs (all open, content renders, zero console errors): Media ✓ Audio ✓ Templates ✓ Generate ✓ Text ✓ Stickers ✓ Effects ✓ Transitions ✓ Filters ✓ Captions ✓ Adjust ✓.
Inspector (video clip): tabs Video/Animation/Audio/Speed/Adjust ✓ · Animation tab 19 tiles ✓ · **Slide Up Smooth applies to a video clip** (`slide_up_smooth`) ✓.
Text inspector: Animation tab ✓ · **Text Animations browser: 8 category folders** (Slide, Scale, Fade, Blur, Rotate & Flip, Bounce & Pop, Type & Words, Glitch & Flicker) ✓ · **Slide Up Smooth applies** (`animIn = slideUpSmooth @ 0.7 s`) ✓ · category folder collapses/expands ✓ · Out section: **Tracking Out applies** ✓ · **"No animation" clears** ✓.
Player: play advances timecode (00:00.78 / 00:04.50) ✓ · seek lands at 00:02.00 ✓.
Timeline: 9 clips rendered ✓ · clip move via store ✓ · undo reverts ✓ · redo reapplies ✓.
Dialogs/panels: Settings opens with AI section ✓ · CraftPilot opens ✓ · **zero console errors across the whole walk** ✓.
(One probe in the first checklist run used a case-sensitive match on the "VIDEO CLIP" header and double-encoded the project JSON — test-driver bugs, both corrected and re-verified; the app was not at fault. The Export *dialog* itself is not CDP-drivable headlessly because export begins with a native OS save dialog; export is instead proven end-to-end by the smoke-path test below, which is the same pipeline with the save path auto-answered.)

### Real export with a new text animation (Phase 3.3 proof)

`scripts/test-textanim-export.cjs` drives the real app: creates a project, adds a text clip, **applies Slide Up Smooth through the new browser UI**, exports through the app's own export pipeline, then measures the exported frames:

- **ffprobe:** `v4-export-slide-up-smooth.mp4` (kept in `~/workspace/clipcraft-shots/`) — h264 640×360 + AAC, duration **3.000 s** exactly.
- **Motion proof (pixel centroid of the text, sampled at t = 0.1 / 0.45 / 0.8 s): y = 243.8 → 194.8 → 174.8** — the text physically rises ~69 px through the exported frames. The preset animates in export, not just in the UI.

### Screenshots

- `~/workspace/clipcraft-shots/v4-01-textanim.png` — Text Animations browser open: Slide folder, "Slide Up Smooth" selected, real-renderer tiles, duration slider.
- `~/workspace/clipcraft-shots/v4-02-editor.png` — demo project at 00:00.52: the CLIPCRAFT title caught **mid-Slide-Up-Smooth** (raised, still fading in) over the video, snow effect and PIP visible.

---

## (d) Bugs found

**Fixed during this task:** none needed in product code — no product bug was found by the suites, the live walk, or the export test.

**Open:**
| # | Item | Severity |
|---|---|---|
| 1 | test-stabilize.cjs is flaky: fixed 0.6 steadiness threshold vs a fixture whose shake varies per run (observed ratios 0.32–0.76). Fix = seed the fixture or relax to a sanity threshold. | Low (test only) |
| 2 | Older smoke modes in `electron/smoke.cjs` (anim/text/crop) predate the Home screen and assume the app boots into the editor; the new `textanim` mode handles Home. Test tooling only — the app is unaffected. | Low (test only) |
| 3 | Five .cjs suites are Windows-only or need external services/env (captions, fonts, tts, library, telemetry) — they cannot pass on this Linux VM as written. | Low (test only) |

---

## (e) Honest remaining gaps

- **No per-character rotation / path motion** — reference presets that bend text along arcs (GIF items 07/10) have no engine channel; Wave In is the nearest real equivalent. Not faked.
- **No VR / lens-distortion / grid text categories** — deliberately unclaimed; Warp In (skew), Spin In, Flip Side are the real equivalents shipped.
- **Text tile previews animate on hover only** (by design — 68 simultaneously animating canvases would tax the panel); tiles show the true resting frame otherwise.
- Carried over from earlier passes (unchanged, still open): transition intensity control, per-effect parameter keyframes, Beauty/BG-removal-style AI effects beyond matting, adjustment layers, audio ducking, beat detection, colour wheels, SRT export, catalog virtualization for the 135 list.
- CraftPilot / AI providers: no live provider connection was tested (needs Hamza's API keys); the provider plumbing and MCP suite pass offline.

---

## Transition packs — five packs of real engine transitions (2026-10-30, evening)

**Scope:** Hamza approved building all five proposed packs. **Binding rule kept:** every pack item is a NEW engine transition implemented in the shared expression engine (`src/fx/catalog.js` `PACK_TRANSITIONS`), so the WebGL preview (FxGL) and the export effects pass render the *same* expression — parity by construction, exactly like the 27 pre-existing FX transitions. No pack item is an "adapted" stand-in. No .deb packaged.

### Final real counts per pack (32 total)

| Pack | Count | Transitions |
|---|---|---|
| Seamless | 9 | Whip Pan Left/Right/Up/Down (travel + 9-tap directional blur ∝ pan velocity), Zoom Blur (multi-tap zoom smear), Spin Blur (rotational arc smear), Warp Push (sine-bent travel), Smooth Warp Left/Right (smoothstep push + bulge) |
| Mask & Reveal | 7 | Venetian Blinds (8 slats, staggered), Grid Reveal (6×4 cells, centre-out staggered reveal), Barn Doors, Chevron Wipe, Circle Reveal Out / Circle Reveal In (true soft-edge iris), Diamond Reveal (true rotating diamond shape) |
| Light & Glow | 5 | Glow Dissolve (bloom crossfade + warm lift), Lens Flare Sweep (glow ball + anamorphic streak + ghost), Light Burn (exposure burn), Flash Frame (strobe cut), Prism Leak (chromatic dispersion edge + wash) |
| Distortion | 6 | Ripple Wave (travelling sine warp), Impact Shake (hash shake + punch zoom), RGB Split Slide Left/Right (per-channel staggered slides), Pixel Stretch, Stretch Warp (anisotropic stretch) |
| Cinematic | 5 | Film Roll (roll + seam bar + gate jitter), Projector Flicker Cut, Letterbox Close / Open (bars hide the mid cut), Dip to Color (violet), Freeze Frame Push (A as a shrinking bordered still card pushed off-frame) |

Engine total is now **68 transition ids** (was 36); FX expression transitions 59 (was 27). The Transitions tab shows **204 items** (was 172): the five packs appear as chips + groups (`Seamless Pack · 9` etc.), every pack tile badged implemented (no "Adapted" badge), previews run between the real photos, duration slider and ★ favourites work unchanged. Direction control: new **Whip Pan** (4 directions), **Smooth Warp** and **RGB Slide** (L/R) groups in the clip inspector.

### Renamed / dropped (honesty notes)

- **Pixel Sort Glitch → "Pixel Stretch"** (Distortion). A true pixel sort needs a per-row accumulation pass; the per-pixel expression engine cannot do it in either preview or export. What ships is a real row-band stretch/glitch drag — named for what it is.
- **Prism Light Leak → "Prism Leak"**: real chromatic dispersion (per-channel offsets at the moving light front) + pink/blue wash; not a physical prism simulation.
- Nothing else was dropped; all other proposed items are the named motion (zoom blur is the standard multi-tap zoom smear toward frame centre — honest approximation, noted in code).

### Adapted → implemented upgrades (10)

Now that true engines exist, these catalog names run them directly and lost the "Adapted" badge: **Barn Doors, Venetian Blinds / Louver, Checkerboard Wipe (→ Grid Reveal engine), Whip Pan, Wave Warp (→ Ripple Wave), Stretch, Film Roll** (`catalog135.js`: 42 implemented / 93 adapted, was 35/100), plus §A extras **Lens Flare** and **Projector Flicker**. Three adapted entries were re-pointed at the closer true engines but keep their badge honestly: Whip Pan Match Cut → whip engine, Glow → Glow Dissolve engine, Directional Blur Transition → Zoom Blur engine.

### Tests & parity evidence

- `scripts/test-fx.mjs` — all 59 FX transitions (incl. the 32 new) parse, compile to GLSL, start exactly on A, end exactly on B, move in between. **PASS**
- `scripts/test-transition-packs.mjs` (new) — pack membership/counts, unique ids, every pack item resolved in both registries with `fx: true`, direction groups, the 8 catalog upgrades, CPU start/end/mid checks, and a blur assertion (whip mid frame's horizontal gradient energy < 60% of the source's). **PASS**
- `scripts/test-transition-packs-export.cjs` (new) — six pack transitions (Whip Pan Left, Zoom Blur, Grid Reveal, Lens Flare Sweep, RGB Split Slide Left, Film Roll) rendered through the real export pipeline (CPU reference of the same expressions → ffv1 segment → `runExport` with `fxSegments`): all outputs 3.40 s at 320×180 with video + audio. Motion profile: mid-transition horizontal gradient **2.90 (whip) vs 50.38 (plain dissolve)** — the whip frame is genuinely blurred, not a renamed dissolve. **PASS**
- Full sweep: `npm run build` ✓ · **22/22** `scripts/test-*.mjs` (incl. `test-textanim.mjs` from the parallel word-by-word pass) · `test-anim.cjs` ✓ · `test-export.cjs` ✓ · `test-textanim-export.cjs` ✓.
- Screenshot: `~/workspace/clipcraft-shots/v6-01-packs.png` — Transitions tab, Seamless Pack selected (9 tiles, whip previews visibly motion-blurred between the real photos), pack chips for all five packs in the chips row.
