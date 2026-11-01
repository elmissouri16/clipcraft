# ClipCraft Design System — proposed official tokens

Derived from the two preserved surfaces (Home Screen + icon dock), the pass-2 floating-deck
shell, and the logo palette. Values are the ones those surfaces actually use today; where
the current `styles.css` diverges, the divergence is named and a single ruling is proposed.
This is a spec for the redesign phases — it changes nothing by itself.

## 1. Color

### Surfaces (dark navy scale)
| Token | Value | Used for |
|---|---|---|
| `--canvas` | `#07070e` | app background behind the decks |
| `--bg` | `#0a0a13` | deepest in-panel wells (stage, thumb wells) |
| `--surface-1` | `#12121d` | deck base, cards |
| `--surface-2` | `#181826` | raised card, panel group |
| `--surface-3` | `#20202f` | control fill, menus |
| `--surface-4` | `#2b2b3d` | hover fill, active-neutral, slider track |
| deck gradient | `linear-gradient(180deg, #141422, #12121d 30%)` | deck surfaces (`.left/.player/.inspector/.topbar`) |

### Borders
| Token | Value |
|---|---|
| `--border` | `rgba(255,255,255,0.07)` |
| deck border | `rgba(255,255,255,0.09)` |
| `--border-strong` | `rgba(255,255,255,0.13)` |
| input hover | `rgba(255,255,255,0.20)` |

### Text
| Token | Value |
|---|---|
| `--text` | `#eef0f5` |
| `--text-2` | `#a8afc0` |
| `--text-3` | `#6f7789` |
| accent text | `#c4b5fd` (on primary-soft fills) |

### Brand (from the logo)
| Token | Value |
|---|---|
| `--primary` | `#825cfb` |
| `--primary-2` | `#6d28e0` |
| `--accent` | `#8b5cf6` |
| `--primary-soft` | `rgba(130,92,251,0.16)` |
| `--accent-soft` | `rgba(139,92,246,0.18)` |
| `--focus` | `#a78bfa` |
| brand gradient | `linear-gradient(135deg, #825cfb, #6d28e0)` (active dock, primary buttons, play) |
| wordmark gradient | `linear-gradient(92deg, #ddd0ff, #825cfb 52%, #8b5cf6)` |
| ambient violet | `rgba(130,92,251,0.13)` max — canvas corners only; do not add more glow (Hamza's ceiling) |

### States
| Token | Value |
|---|---|
| `--success` | `#22c55e` |
| `--warning` | `#f59e0b` |
| `--danger` | `#ef4444` |
| error text | `#fca5a5` on `rgba(239,68,68,0.08)` fill, border `rgba(239,68,68,0.3)` |
| favourite star | `#fbbf24` |

### Timeline lane / clip colors (one table for heads, clips, add buttons)
| Lane | Value |
|---|---|
| video | `#2b5ccf` (clip body) — head accent currently resolves to this; brand-led alternative `#825cfb` is used by overlay today. **Ruling needed:** keep blue video body (media convention) but heads use the color-mix tint of the same hue (already implemented via `--lane-accent`). |
| overlay | `#825cfb` |
| text | `#7c4ddb` (captions `#5b3fb0`) |
| audio | `#0f8f6a` |
| effect | `#a855f7` |

## 2. Typography

Font: `'Inter Variable', 'Segoe UI', system-ui, sans-serif`; base **13px / 1.45**;
`font-feature-settings: 'cv11','ss01'`; tabular numerals for all time/values.

| Step | Size / weight | Use |
|---|---|---|
| display | 35px / 800 / −0.6px | Home hero only |
| h-display-sm | 27px / 600 | dialog hero (About) |
| h1 | 24px / 600–800 | brand name, large panel titles |
| h2 | 15px / 650–700 | section titles (`.lib-head h2`, `.tab-title` 13.5/650) |
| body | 13px / 400–500 | default |
| body-sm | 12.5px / 400 | menu items, side rows |
| label | 12px / 500–600 | field labels, buttons |
| micro | 11.5px / 500 | tile labels, seg buttons |
| micro-label | 11px / 700 / +1.1px uppercase | panel titles (`.panel-title`) |
| eyebrow | 11px / 700 / +1.4px uppercase, `#c4b5fd` | Home eyebrows |
| field micro-label | 10.5px / 700 / +0.7px uppercase, text-3 | inspector field labels |
| dock label | 10px / 500 | dock buttons |
| caption | 11px | meta text, durations |

Half-steps (10.5/12.5/13.5) are in real use — codified above rather than rounded away.
Weight 650 is in real use (`.tab-title`, home h2) — treat as a valid step.

## 3. Spacing

Scale (px): **2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 30**.
- App frame: padding 8px 10px 10px; deck gap **10px**.
- Panel padding: **14px** sides (`.fields`, `.pad-block` 12/14/16 — converge to 14).
- Card padding 14px; card gap 10px; section gap 12–14px.
- Tile grid gap 8px; chip gap 5px; button icon gap 7px.
- Home rhythm (preserved): body gap 30px, hero padding 28px.

## 4. Radii

Tokens today: `--r-sm 6px · --r-md 9px · --r-lg 12px`. The deck language extends them:
| Radius | Use |
|---|---|
| 6px | small controls (btn, inputs today) — see divergence D2 |
| 9px (`--r-md`) | tiles, side rows, menus (target) |
| 10px | transport menus, stage |
| 12px (`--r-lg`) | cards, dock buttons, home cards |
| 14px | TopBar card, home frame cards |
| 16px | decks (`.left/.player/.inspector`), dialogs (legacy `.modal`) |
| 18px | timeline deck |
| 20px | hero dialogs (About spec — proposed dialog standard) |
| 22px | Home hero |
| 99px | pills: seg controls, chips (13px at 26px height), transport pill, project pill, version pill |

## 5. Elevation

| Level | Value | Use |
|---|---|---|
| deck | `0 16px 36px rgba(0,0,0,0.42)` + `inset 0 1px 0 rgba(255,255,255,0.04)` | shell decks |
| bar | `0 12px 28px rgba(0,0,0,0.38)` + inset highlight | TopBar, transport pill (0.5 alpha) |
| dialog | `0 10px 30px rgba(0,0,0,0.45)` (`--shadow`) — About uses `0 30px 80px rgba(0,0,0,0.55)`; **proposed standard: the About value** |
| menu | `0 12px 32px rgba(0,0,0,0.5)` | context/transport menus |
| brand glow | `0 6px 16–18px rgba(130,92,251,0.45–0.5)` | active dock, play button, logo only |

## 6. Iconography

Lucide only. Sizes: dock **19px, strokeWidth 1.8**; toolbar/player **16px**; panel &
menu **14–15px**; inline/meta **12–13px**; empty-state chip **26px** in a 48px disc.
Default strokeWidth 2 except the dock. Icons inherit `currentColor`; active icon = white
on brand gradient or `#c4b5fd` on primary-soft.

## 7. Component specs

### Buttons
- `.btn`: h **32px**, padding 0 13px, radius 6px (→ D2), surface-3 fill, border-strong,
  13px/500, icon gap 7px. Hover surface-4; active translateY(1px); disabled opacity .4.
- `.btn-sm`: 28px, 0 10px, 12px. `.btn-block`: full width.
- Primary: flat `--primary`, hover `--primary-2`. (Dock/play use the 135deg gradient +
  glow — reserved for the single primary action per surface.)
- Export: gradient `135deg #a78bfa → #825cfb 45% → #a855f7`, 600 weight, glow .35.
- Ghost: transparent, text-2 → surface-3 hover.
- Danger: flat `--danger`.
- `.icon-btn`: 30×30, radius 6px, transparent → surface-3 hover; `.sm` 24×24;
  `.active`: surface-4 + inset 1px border-strong ring.

### Inputs & selects
- Text/number/password/search/textarea: h **32px**, padding 0 10px, radius 6px,
  **surface-1** fill, 1px border-strong. Hover border `rgba(255,255,255,.2)`.
  Focus: border `--primary` + `0 0 0 3px primary-soft` ring, no outline.
- Native `<select>` uses the same box. Creative choices should not be native selects
  (audit #24) — use segmented/chips below.
- Color input: 38×26 swatch, radius 6px. Checkbox: 16px, `accent-color: primary`.
- `.switch` exists (5 rules) — the toggle standard; on = primary.

### Search (one spec — today there are three)
Target: h **34px**, radius 9px, surface-2 fill, 1px border, leading 14px search icon
in text-3, 12.5px text, clear (×) button when non-empty, `:focus-within` border
`--primary`. (Current: `.lib-search` matches except radius/focus ring; `.search` is
32px/radius 6/surface-1; `.home-search` is a 99px pill — Home is preserved, panels
converge on `.lib-search` values + focus ring.)

### Segmented controls (two dialects — converge)
- Pill seg (Home `.seg`): container surface-2, 99px, padding 3px; button h 26px,
  99px, 12px/600 text-2; on = `--primary` fill, white.
- Tab seg (`.seg-tabs`): container surface-2, radius 9px, padding 3px, gap 2px;
  button h 28px, radius 6px, 11.5px/500; on = **surface-4** fill (neutral).
**Ruling:** pill seg for standalone choices (fps, quality); tab seg for view switching.
Never mix the two in one panel.

### Sliders
Global (late CSS block, the standard): track 4px / 99px / surface-4; thumb **14px**
primary disc, 2px `#d9ceff` border, glow `0 2px 8px rgba(130,92,251,.55)`; height 18px.
Grade sliders (`.grade-range`) keep colored tracks by channel but adopt the same
thumb and 4px track. Zoom slider in the timeline uses the global spec.

### Chips
h **26px**, padding 0 9px, radius 13px, surface-3, 1px border, 12px text-2.
On: primary-soft fill, primary border, `#c4b5fd` text. Scroll-x rows hide scrollbars.

### Tiles (effects / transitions / filters / templates)
`.tile`: surface-2, 1px border, radius 9px (→ propose 12px to match cards), padding
6px, gap 6px; preview well **60px** h, radius 6px, surface-1 (bg #000 for media);
label 11px text-2, ellipsis. Hover: border-strong + surface-3. On: primary border +
primary-soft + label `#c4b5fd`. Badge (Adapted) and ★ (28px, amber when on) are
absolute overlays. Grid: `auto-fill minmax(96px,1fr)`, gap 8px, 14px side padding;
2 columns under 1280px viewport.

### Asset cards (media grid)
Thumb 16:9 (ratio-true for sprites), radius 9px, #000 well, 1px border → primary on
hover; duration chip bottom-right `rgba(0,0,0,.65)` white 11px; hover action buttons
(+ add, overlay, ★, trash) as 26–30px dark discs; name 12px under the thumb.

### Library rows (audio/stock lists)
`.lib-row`: flex, gap 10px, padding 7px 8px, radius 9px, surface-2, transparent
border → border-strong hover; on: primary border + primary-soft. Play button 30px
radius 8px brand gradient; add button 30px surface-4 → primary hover. Title 13px/600,
sub-line 11.5px text-3 with license pill (`Free` / `Credit`).

### Cards
`.card`: surface-2, 1px border, radius 12px, padding 14px, gap 10px, margin
0 14px 12px. Icon chip 34px radius 9px surface-4 (accent variant: primary-soft +
primary icon). Captions/Stock/TTS cards converge here.

### Panels & decks
Deck: radius **16px** (timeline 18px), deck gradient + deck shadow + 1px
`rgba(255,255,255,.09)` border. Panel head: glassy strip
`linear-gradient(180deg, rgba(255,255,255,.05), transparent 140%)` + `.panel-title`
micro-label (11px/700/+1.1px uppercase, text-2). Library `h2` headers (15px/700)
are the divergence to retire (audit #25).

### Dialogs
Backdrop: `rgba(0,0,0,.6)` + `blur(3px)`, z 40. Dialog standard (from About):
width 400–440px, radius **20px**, padding 26–30px, surface gradient
`radial-gradient(120% 90% at 50% 0%, #1b1b2e, #12121d 55%)`, 1px border-strong,
dialog shadow (§5). Hero icon: 52px disc primary-soft (status variants success/
danger at .14 alpha) — About's 92px halo is for brand moments only. Actions row:
gap 8px, primary right. Legacy `.modal` (16px radius, flat surface-2) is the
divergence to migrate (audit #21).

### Menus & popovers
`.ctx-menu` / `.transport-menu` unified spec: surface-3, 1px border-strong,
radius **12px** (ctx is 9px, transport 10px today), padding 5px, menu shadow.
Item: h 30px, padding 0 10px, radius 6px, 12.5px, icon 15px + label + right-aligned
`<kbd>` hint; hover surface-4; disabled opacity .4 with hint tooltip. Two-line
items (transport menus): bold 13px name + 11.5px text-3 description + 14px check.

### Tooltips
No custom tooltip component exists — everything uses native `title`. Spec: keep
native tooltips (instant enough for a desktop tool, zero risk); write titles as
"Action (Shortcut)" consistently. Do not introduce a tooltip library.

### Scrollbars
One spec (the late block wins): **9px**, thumb `#2e2e44` radius 99px, hover
`--primary-2`, transparent track. Hidden in: dock, chips scroll-x, tab bar.

### Focus
`:focus-visible`: 2px `--focus` outline, offset 2px (global). Inputs use the
border+ring treatment instead (§Inputs) — the two are deliberate: outline for
buttons/tiles, ring for text fields. Do not add a third.

### States summary
- Hover: fill steps one surface up (or border → border-strong for bordered controls).
- Active/pressed: translateY(1px) on buttons; toggles use `.on`.
- Selected: primary border + primary-soft fill + `#c4b5fd` text (chips, tiles,
  seg-neutral excluded — seg uses surface-4).
- Disabled: opacity .4, `cursor: not-allowed`.
- Focus: §Focus above.
- Motion: `--t-fast 120ms`, `--t-med 200ms`, `--ease cubic-bezier(.2,.7,.2,1)`;
  `prefers-reduced-motion` block already collapses all motion — keep.

### Empty / loading / error (proposed single patterns)
- Empty: centered column, 48px primary-soft disc + 26px icon, 14px/600 title,
  12px text-3 guidance, optional `.btn-sm` action. (Home's mini-stage + dropzone
  are the rich variants; panels get the disc variant.)
- Loading: spinner 16px + 12.5px text-2 in a row (`.lib-loading`); grids use
  surface-2 skeleton tiles at tile size, no spinner boxes.
- Error: `.error-box` card (danger .08 fill, .3 border, #fecaca text) with a
  Retry `.btn-sm` — retire the inline `.lib-error` dialect into it.

## 8. Divergences in the current styles.css (fix list for Phase 2)

| # | Divergence | Ruling |
|---|---|---|
| D1 | Scrollbars defined twice (10px/surface-4/bordered vs 9px/#2e2e44/violet-hover) | Keep the 9px late spec |
| D2 | `.btn` radius 6px vs deck-era radii (12–16px) everywhere else | Buttons → 9px radius |
| D3 | Range inputs defined twice (`accent-color` early vs full custom webkit late) | Keep the custom late spec |
| D4 | Three search implementations (`.search`, `.lib-search`, `.home-search`) | Panels converge per §Search; Home untouched |
| D5 | Two segmented dialects (`.seg` pill/primary vs `.seg-tabs` neutral) | Keep both, with the usage ruling in §Segmented |
| D6 | `.modal` (16px, flat) vs `.about2` (20px, gradient, bigger shadow) | About spec becomes the dialog standard |
| D7 | `--border-2` referenced by About but never defined (falls back to #2b2b3d) | Define `--border-2: #2b2b3d` or replace with border-strong |
| D8 | `.filter-thumb i` drawn gradient placeholder (amber/violet/green) still ships | Replace with surface-2 skeleton |
| D9 | Font weights 650 and half-step sizes used but uncodified | Codified in §2 |
| D10 | Video lane blue `#2b5ccf` vs violet-led identity | Keep hue, tint via color-mix (already done for heads); document, don't recolor clips |
