// Bundled template packages, rebuilt to the AutoAE standard (see
// ~/workspace/research_notes/autoae-template-system-analysis-20261031-0024/report.md §5):
// every template is ONE designed scene — placeholder media are composed set pieces (layered
// gradients, soft glows, grain, vignette, and the bundled preview PHOTOS as plates where the
// concept fits), never bare gradients. Typography is locked to the app's text styles with a
// hero/supporting contrast; every text enters with its own animation on a staggered build
// (0.15–0.3 s offsets) and the last beat settles. Each package's meta carries the slot
// contract — duration · ratio · N texts · N media — which the Templates UI prints.
// Names stay "Concept | Mechanics", tags come from the fixed taxonomy, and hero designs
// multiply as accent variants (clip-level colour overrides + re-graded scenes).
// Placeholder media is GENERATED locally (PIL scenes + ffmpeg), never downloaded.
// Run: node scripts/make-bundled-templates.cjs
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ff = require('../electron/ffmpeg.cjs');
const { pack } = require('../electron/templates.cjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'bundled-templates');
const WORK = path.join(ROOT, '.tpl-work');
const PHOTOS = path.join(ROOT, 'public', 'preview');
const FFMPEG = ff.ffmpegPath;

const TAXONOMY = ['Text Animation', 'Logo Animation', 'UI Animation', 'Engagement', 'Mockup', 'Process', 'Promo', 'Social'];

// ---- Scene composer (PIL + numpy): one art-directed still per placeholder medium. ----
// Modes: glow (soft key light on a dark ground), horizon (landscape set), diag (angled light
// sweep), grid (tech/UI studio), paper (warm paper set), stage (two side glows), photo (a
// bundled photograph graded with the template's accent, darkened for text).
const SCENE_PY = path.join(WORK, 'scene.py');
const SCENE_SRC = `
import sys
import numpy as np
from PIL import Image

mode, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
def hx(s):
    s = s[2:] if s.startswith('0x') else s.lstrip('#')
    return np.array([int(s[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float32)
c0, c1, acc = hx(sys.argv[4]), hx(sys.argv[5]), hx(sys.argv[6])
photo, out = sys.argv[7], sys.argv[8]

yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
xn, yn = xx / max(1, w - 1), yy / max(1, h - 1)
X, Y = xx / h, yy / h            # height units, so glows stay round
WU = w / h

def vgrad(stops, t):
    img = np.zeros((*t.shape, 3), np.float32)
    for (p0, a), (p1, b) in zip(stops, stops[1:]):
        m = np.clip((t - p0) / max(1e-6, p1 - p0), 0, 1)[..., None]
        sel = ((t >= p0 - 1e-6) & (t <= p1 + 1e-6))[..., None]
        img = np.where(sel, a * (1 - m) + b * m, img)
    return img

def glow(cx, cy, r, color, amp):
    # amp = peak ADDED bytes at the centre, in the direction of color (normalized).
    d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    return (np.exp(-(d ** 2) / (2 * r * r)) * amp)[..., None] * (color / 255.0)

def smooth(a, b, t):
    u = np.clip((t - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)

mid = (c0 + c1) / 2
if mode == 'photo':
    im = Image.open(photo).convert('RGB')
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    if s > 2.5:  # a small photo stretched over a portrait frame: soften it into an intentional backdrop
        from PIL import ImageFilter
        im = im.filter(ImageFilter.GaussianBlur(2.2))
    l, t = (im.width - w) // 2, (im.height - h) // 2
    img = np.asarray(im.crop((l, t, l + w, t + h)), dtype=np.float32)
    img = img * 0.9 + acc * 0.10                                   # accent grade
    img *= (1 - 0.5 * smooth(0.45, 1.0, yn))[..., None]            # legibility shade, bottom
    img *= (1 - 0.28 * smooth(0.3, 0.0, yn))[..., None]            # and top
    img += glow(0.5 * WU, 0.34, 0.5, acc, 22)
elif mode == 'horizon':
    img = vgrad([(0, c0), (0.55, mid), (0.68, c1)], yn)
    img += glow(0.66 * WU, 0.6, 0.34, acc, 120)                    # low sun
    img *= (1 - 0.38 * smooth(0.68, 1.0, yn))[..., None]           # ground falls off
    img += (np.exp(-((yn - 0.665) ** 2) / (2 * 0.004 ** 2)) * 0.5)[..., None] * acc   # horizon line
    img += glow(0.16 * WU, 0.14, 0.5, c1, 26)
elif mode == 'diag':
    img = vgrad([(0, c0), (1, c1)], (xn + yn) / 2)
    band = np.exp(-(((xn - yn) - 0.12) ** 2) / (2 * 0.085 ** 2))
    img += (band * 0.4)[..., None] * acc                           # the light sweep
    img += glow(0.06 * WU, 0.02, 0.55, c1, 30)
    img += glow(0.97 * WU, 0.95, 0.5, acc, 26)
elif mode == 'grid':
    img = vgrad([(0, c0), (1, c1)], yn)
    dots = ((xx % 24 < 3) & (yy % 24 < 3)).astype(np.float32)
    img += (dots * 26)[..., None]                                  # faint dot grid
    img += glow(0.08 * WU, 0.92, 0.6, acc, 34)
    img += glow(0.95 * WU, 0.06, 0.5, c1, 22)
    img += (smooth(0.014, 0.0, yn) * 0.3)[..., None] * acc         # top hairline
    img *= (1 - 0.25 * smooth(0.86, 1.0, yn))[..., None]           # studio desk band
elif mode == 'paper':
    img = vgrad([(0, c0), (1, c1)], yn)
    sh = np.exp(-(((xn - yn) - 0.35) ** 2) / (2 * 0.3 ** 2))
    img *= (1 - 0.16 * sh)[..., None]                              # soft diagonal shadow
    img += glow(0.5 * WU, 0.3, 0.7, np.array([255, 250, 238], np.float32), 20)
elif mode == 'stage':
    img = vgrad([(0, c0), (0.7, c0 * 0.68 + c1 * 0.32), (1, c0)], yn)
    img += glow(0.03 * WU, 0.52, 0.45, acc, 72)                    # side glows
    img += glow(1.0 * WU, 0.48, 0.45, c1, 64)
    img += glow(0.5 * WU, 1.04, 0.55, acc, 30)                     # floor bounce
    img += (np.exp(-((yn - 0.78) ** 2) / (2 * 0.006 ** 2)) * 0.22)[..., None] * acc   # floor edge line
else:  # glow
    img = vgrad([(0, c0), (0.6, c0 * 0.55 + mid * 0.45), (1, c0 * 0.4 + c1 * 0.6)], yn)
    img += glow(0.5 * WU, 0.36, 0.55, acc, 62)                     # key light
    img += glow(0.94 * WU, 0.92, 0.5, c1, 30)
    img *= (1 - 0.22 * smooth(0.78, 1.0, yn))[..., None]           # floor shade

rng = np.random.default_rng(11)
sigma = 8.5 if mode == 'paper' else 5.0
img += rng.normal(0, sigma, (h, w, 1)).astype(np.float32)          # grain
d = np.sqrt((X - WU / 2) ** 2 + (Y - 0.5) ** 2)
img *= (1 - 0.26 * smooth(0.55, 1.15, d))[..., None]               # vignette
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out)
`;

// ---- Portfolio card: a photograph on a designed card (rounded corners, border, shadow, accent foot). ----
const CARD_PY = path.join(WORK, 'card.py');
const CARD_SRC = `
import sys
from PIL import Image, ImageDraw, ImageFilter
photo, w, h, accent, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
acc = tuple(int(accent.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
im = Image.open(photo).convert('RGB')
s = max(w / im.width, h / im.height)
im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
l, t = (im.width - w) // 2, (im.height - h) // 2
im = im.crop((l, t, l + w, t + h))
canvas = Image.new('RGBA', (w + 48, h + 48), (0, 0, 0, 0))
shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([24, 34, 24 + w, 34 + h], radius=30, fill=(0, 0, 0, 150))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(12)))
mask = Image.new('L', (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, w, h], radius=30, fill=255)
canvas.paste(im, (24, 24), mask)
d = ImageDraw.Draw(canvas)
d.rounded_rectangle([24, 24, 24 + w, 24 + h], radius=30, outline=(255, 255, 255, 235), width=5)
d.rounded_rectangle([24, 24 + h - 16, 24 + w, 24 + h], radius=8, fill=acc + (255,))
canvas.save(out)
`;

// ---- Phone frame (transparent centre, border + notch), drawn with PIL. ----
const FRAME_PY = path.join(WORK, 'frame.py');
const FRAME_SRC = `
import sys
from PIL import Image, ImageDraw
w, h, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
inset, t = 26, 15
d.rounded_rectangle([inset, inset, w - inset, h - inset], radius=54, outline=(255, 255, 255, 255), width=t)
nw = 170
d.rounded_rectangle([(w - nw) / 2, inset, (w + nw) / 2, inset + 34], radius=16, fill=(255, 255, 255, 255))
img.save(out)
`;

// ---- Preview headline plate: the template's own first two texts at their own heights,
// with the accent bar the design system uses, rasterised (ffmpeg-static has no drawtext). ----
const HEADLINE_PY = path.join(WORK, 'headline.py');
const HEADLINE_SRC = `
import sys
from PIL import Image, ImageDraw, ImageFont
head, sub, accent, y_head, y_sub, w, h, out = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), int(sys.argv[6]), int(sys.argv[7]), sys.argv[8]
acc = tuple(int(accent.lstrip('#')[i:i+2], 16) for i in (0, 2, 4)) + (255,)
img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def block(text, size):
    font = ImageFont.truetype(FONT, size)
    while max((d.textlength(wd, font=font) for wd in text.split()), default=0) > w - 40 and size > 13:
        size = int(size * 0.9); font = ImageFont.truetype(FONT, size)
    words, lines, cur = text.split(), [], ''
    for wd in words:
        trial = (cur + ' ' + wd).strip()
        if d.textlength(trial, font=font) <= w - 40 or not cur: cur = trial
        else: lines.append(cur); cur = wd
    if cur: lines.append(cur)
    return font, size, lines
if head:
    font, size, lines = block(head, max(20, h // 11))
    lh = int(size * 1.22); total = lh * len(lines)
    top = min(max(0, int(h * y_head - total / 2)), h - total)
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=font)
        d.text(((w - tw) / 2, top + i * lh), line, font=font, fill=(255, 255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0, 170))
    bw = 62
    d.rounded_rectangle([(w - bw) / 2, top + total + 8, (w + bw) / 2, top + total + 15], radius=3, fill=acc)
if sub:
    font, size, lines = block(sub, max(13, h // 22))
    lh = int(size * 1.25); total = lh * len(lines)
    top = min(max(0, int(h * y_sub - total / 2)), h - total)
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=font)
        d.text(((w - tw) / 2, top + i * lh), line, font=font, fill=(255, 255, 255, 235), stroke_width=2, stroke_fill=(0, 0, 0, 150))
img.save(out)
`;

// def: slug, title ("Concept | Mechanics"), cat, ratio, pal [c0, c1] (scene ground),
// scene (composer mode), accent (the ONE accent colour, '#rrggbb'), plate {slotIdx: photo},
// slots [durations] (replaceable main-track videos), bed (music), tags [],
// texts [{ text, at, dur, y, tpl, x?, style?, anim? [animIn id, dur] }] — style/anim are
// clip-level and beat the text style's own patch, so the design stays locked per template.
const DEFS = [
  { slug: 'vertical-reel-hook', title: 'Reel Hook | Bold Title Pops Over Two Shots', cat: 'Social', ratio: [1080, 1920], pal: ['0x1B1035', '0x825CFB'], scene: 'stage', accent: '#825cfb', slots: [2.5, 2.5], tags: ['Promo', 'Social', 'Text Animation'],
    texts: [{ text: 'STOP SCROLLING', at: 0.2, dur: 2.2, y: 0.16, tpl: 'cap-hormozi', anim: ['pop', 0.45], style: { highlight: { mode: 'scale', color: '#c4b5fd' } } }, { text: 'Watch what happens next', at: 2.6, dur: 2, y: 0.8, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'podcast-clip', title: 'Podcast Clip | Speaker Lower-Third Over One Long Take', cat: 'Podcast', ratio: [1080, 1920], pal: ['0x101418', '0x3E4C59'], scene: 'glow', accent: '#7d93a8', slots: [6], tags: ['Social', 'Promo'],
    texts: [{ text: 'YOUR GUEST — THEIR TITLE', at: 0.4, dur: 3.4, y: 0.78, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.6] }, { text: '“The one thing nobody tells you…”', at: 3.4, dur: 2.2, y: 0.14, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'product-promo', title: 'Product Promo | Price Splash and Call to Action End Card', cat: 'Business', ratio: [1080, 1080], pal: ['0x231303', '0xF59E0B'], scene: 'glow', accent: '#f59e0b', plate: { 0: 'p1060.jpg' }, slots: [3, 2], bed: true, tags: ['Promo', 'Social'],
    texts: [{ text: 'NEW ARRIVAL', at: 0.2, dur: 2.6, y: 0.14, tpl: 'mat-accent-bar', anim: ['fadeUp', 0.55] }, { text: 'Only 499 MAD', at: 0.45, dur: 2.5, y: 0.78, tpl: 'mat-big-number', anim: ['zoomIn', 0.55], style: { color: '#fbbf24' } }, { text: 'Order yours today', at: 3.1, dur: 1.5, y: 0.5, tpl: 'mat-pill-label', anim: ['settleUp', 0.7] }] },
  { slug: 'before-after', title: 'Before / After | Side-by-Side Labels With a Wipe Between', cat: 'Social', ratio: [1920, 1080], pal: ['0x3F3F46', '0x22C55E'], scene: 'diag', accent: '#22c55e', slots: [2.5, 2.5], transition: 'wipeleft', tags: ['Engagement', 'Social'],
    texts: [{ text: 'BEFORE', at: 0.2, dur: 2.2, y: 0.12, tpl: 'mat-pill-label', anim: ['fadeDown', 0.5] }, { text: 'AFTER', at: 2.7, dur: 2.2, y: 0.12, tpl: 'label-tag', anim: ['fadeDown', 0.5] }] },
  { slug: 'quote-card', title: 'Quote Card | Centred Quote Fades In Over Your Footage', cat: 'Social', ratio: [1080, 1080], pal: ['0x111827', '0x374151'], scene: 'photo', accent: '#e7c88a', plate: { 0: 'p1016.jpg' }, slots: [5], tags: ['Social', 'Text Animation'],
    texts: [{ text: '“Small steps every day.”', at: 0.3, dur: 4.4, y: 0.42, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: '— DAILY WISDOM', at: 1, dur: 3.6, y: 0.62, tpl: 'mat-pill-label', anim: ['fadeUp', 0.6] }] },
  { slug: 'tutorial-steps', title: 'Tutorial Steps | Numbered Step Titles Over Each Shot', cat: 'Education', ratio: [1920, 1080], pal: ['0x0B2537', '0x0EA5E9'], scene: 'grid', accent: '#0ea5e9', slots: [2, 2, 2], tags: ['Process', 'Social'],
    texts: [{ text: 'STEP 1 — PREPARE', at: 0.15, dur: 1.8, y: 0.82, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] }, { text: 'STEP 2 — BUILD', at: 2.15, dur: 1.8, y: 0.82, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] }, { text: 'STEP 3 — FINISH', at: 4.15, dur: 1.8, y: 0.82, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] }] },
  { slug: 'sale-countdown', title: 'Flash Sale | Giant Discount Number With an Urgency Line', cat: 'Business', ratio: [1080, 1920], pal: ['0x2A0A0A', '0xEF4444'], scene: 'stage', accent: '#ef4444', slots: [4], tags: ['Promo', 'Engagement'],
    texts: [{ text: 'FLASH SALE', at: 0.2, dur: 3.6, y: 0.2, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.5] }, { text: '-50%', at: 0.45, dur: 3.4, y: 0.45, tpl: 'mat-big-number', anim: ['zoomIn', 0.55], style: { color: '#fca5a5' } }, { text: 'This weekend only', at: 1.05, dur: 2.4, y: 0.72, tpl: 'cap-subtitle', anim: ['fadeUp', 0.55] }] },
  { slug: 'testimonial', title: 'Testimonial | Customer Quote With Name and Role Bars', cat: 'Business', ratio: [1080, 1920], pal: ['0x0F2027', '0x2C5364'], scene: 'glow', accent: '#7fb2c9', slots: [5], tags: ['Promo', 'Social'],
    texts: [{ text: '“Best decision we ever made.”', at: 0.3, dur: 4.4, y: 0.3, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: 'Sara B. — Store owner', at: 2, dur: 2.8, y: 0.68, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.6] }] },
  { slug: 'travel-vlog', title: 'Travel Vlog | Location Title Over Two Scenes', cat: 'Travel', ratio: [1920, 1080], pal: ['0x082F2E', '0x14B8A6'], scene: 'photo', accent: '#14b8a6', plate: { 0: 'p1015.jpg', 1: 'p1018.jpg' }, slots: [3, 3], tags: ['Social'],
    texts: [{ text: 'MARRAKECH', at: 0.3, dur: 2.5, y: 0.4, tpl: 'mat-duo-title', anim: ['glideUp', 0.9], style: { color2: '#14b8a6' } }, { text: 'Day one — the old town', at: 3.3, dur: 2.3, y: 0.8, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'fitness-post', title: 'Fitness Post | Strong Title and a Closing Push Line', cat: 'Fitness', ratio: [1080, 1920], pal: ['0x181203', '0xEAB308'], scene: 'stage', accent: '#eab308', slots: [4], bed: true, tags: ['Social', 'Engagement'],
    texts: [{ text: 'NO EXCUSES', at: 0.2, dur: 3.6, y: 0.18, tpl: 'mat-duo-title', anim: ['settleUp', 0.8], style: { color2: '#eab308' } }, { text: 'Day 12 — keep going', at: 2.5, dur: 1.2, y: 0.8, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.5] }] },
  { slug: 'news-update', title: 'News Update | Headline Bar, Lower-Third and Bottom Ticker', cat: 'News', ratio: [1920, 1080], pal: ['0x0A1128', '0x1D4ED8'], scene: 'grid', accent: '#3b82f6', slots: [6], tags: ['UI Animation', 'Social'],
    texts: [{ text: 'BREAKING', at: 0.2, dur: 5.6, y: 0.1, tpl: 'label-tag', anim: ['fadeDown', 0.45] }, { text: 'Your headline goes here', at: 0.35, dur: 5.5, y: 0.66, tpl: 'mat-headline-bar', anim: ['slideUpSmooth', 0.6] }, { text: 'Full story at the link in bio', at: 1, dur: 4.8, y: 0.86, tpl: 'cap-subtitle', anim: ['fadeUp', 0.55] }] },
  { slug: 'real-estate-tour', title: 'Real Estate Tour | Address Title and Price Lower-Third', cat: 'Business', ratio: [1920, 1080], pal: ['0x1C1917', '0xB45309'], scene: 'horizon', accent: '#d97706', plate: { 1: 'p1016.jpg' }, slots: [3, 3], tags: ['Promo', 'Social'],
    texts: [{ text: 'SUNSET APARTMENT', at: 0.3, dur: 2.5, y: 0.16, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.55] }, { text: '3 rooms — 850,000 MAD', at: 3.3, dur: 2.3, y: 0.8, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.6] }] },
  { slug: 'recipe-steps', title: 'Recipe Steps | One Instruction Title Per Shot', cat: 'Food', ratio: [1080, 1920], pal: ['0x231208', '0xEA580C'], scene: 'photo', accent: '#ea580c', plate: { 0: 'p292.jpg', 1: 'p292.jpg' }, slots: [2.5, 2.5], tags: ['Process', 'Social'],
    texts: [{ text: '1 — CHOP THE ONIONS', at: 0.15, dur: 2.2, y: 0.14, tpl: 'mat-pill-label', anim: ['fadeDown', 0.5] }, { text: '2 — SIMMER 20 MINUTES', at: 2.6, dur: 2.2, y: 0.14, tpl: 'mat-pill-label', anim: ['fadeDown', 0.5] }] },
  { slug: 'motivational-quote', title: 'Motivational Quote | Quote and Sign-Off Over Moody Footage', cat: 'Social', ratio: [1080, 1920], pal: ['0x312E81', '0x825CFB'], scene: 'photo', accent: '#a78bfa', plate: { 0: 'p1025.jpg' }, slots: [5], tags: ['Social', 'Text Animation'],
    texts: [{ text: 'Discipline beats motivation.', at: 0.3, dur: 4.4, y: 0.4, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: '— MORNING MINDSET', at: 1.2, dur: 3.4, y: 0.58, tpl: 'mat-pill-label', anim: ['fadeUp', 0.6], style: { bubbleColor: '#6d28e0' } }] },
  { slug: 'music-visual', title: 'Music Visual | Track Title and Artist Over a Synth Bed', cat: 'Music', ratio: [1920, 1080], pal: ['0x2E1065', '0xDB2777'], scene: 'stage', accent: '#db2777', slots: [6], bed: true, tags: ['Promo', 'Social'],
    texts: [{ text: 'MIDNIGHT DRIVE', at: 0.4, dur: 5.2, y: 0.42, tpl: 'mat-duo-title', anim: ['glideUp', 0.9], style: { color2: '#db2777' } }, { text: 'Your Artist — new single', at: 1.2, dur: 4.4, y: 0.6, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },

  // ---- Colour variants of the first two heroes (same mechanics, different accent system). ----
  { slug: 'vertical-reel-hook-teal', title: 'Reel Hook | Bold Title Pops Over Two Shots — Teal', cat: 'Social', ratio: [1080, 1920], pal: ['0x04201C', '0x14B8A6'], scene: 'stage', accent: '#14b8a6', slots: [2.5, 2.5], tags: ['Promo', 'Social', 'Text Animation'],
    texts: [{ text: 'STOP SCROLLING', at: 0.2, dur: 2.2, y: 0.16, tpl: 'cap-hormozi', anim: ['pop', 0.45], style: { highlight: { mode: 'scale', color: '#2dd4bf' } } }, { text: 'Watch what happens next', at: 2.6, dur: 2, y: 0.8, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'vertical-reel-hook-coral', title: 'Reel Hook | Bold Title Pops Over Two Shots — Coral', cat: 'Social', ratio: [1080, 1920], pal: ['0x2B0E0A', '0xF97066'], scene: 'stage', accent: '#f97066', slots: [2.5, 2.5], tags: ['Promo', 'Social', 'Text Animation'],
    texts: [{ text: 'STOP SCROLLING', at: 0.2, dur: 2.2, y: 0.16, tpl: 'cap-hormozi', anim: ['pop', 0.45], style: { highlight: { mode: 'scale', color: '#fdba74' } } }, { text: 'Watch what happens next', at: 2.6, dur: 2, y: 0.8, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'quote-card-violet', title: 'Quote Card | Centred Quote Fades In Over Your Footage — Violet', cat: 'Social', ratio: [1080, 1080], pal: ['0x1E1B4B', '0x825CFB'], scene: 'photo', accent: '#825cfb', plate: { 0: 'p1016.jpg' }, slots: [5], tags: ['Social', 'Text Animation'],
    texts: [{ text: '“Small steps every day.”', at: 0.3, dur: 4.4, y: 0.42, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: '— DAILY WISDOM', at: 1, dur: 3.6, y: 0.62, tpl: 'mat-pill-label', anim: ['fadeUp', 0.6], style: { bubbleColor: '#6d28e0' } }] },
  { slug: 'quote-card-teal', title: 'Quote Card | Centred Quote Fades In Over Your Footage — Teal', cat: 'Social', ratio: [1080, 1080], pal: ['0x04201C', '0x0D9488'], scene: 'photo', accent: '#0d9488', plate: { 0: 'p1016.jpg' }, slots: [5], tags: ['Social', 'Text Animation'],
    texts: [{ text: '“Small steps every day.”', at: 0.3, dur: 4.4, y: 0.42, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: '— DAILY WISDOM', at: 1, dur: 3.6, y: 0.62, tpl: 'mat-pill-label', anim: ['fadeUp', 0.6], style: { bubbleColor: '#0d9488' } }] },
  { slug: 'quote-card-coral', title: 'Quote Card | Centred Quote Fades In Over Your Footage — Coral', cat: 'Social', ratio: [1080, 1080], pal: ['0x2B0E0A', '0xF43F5E'], scene: 'photo', accent: '#f43f5e', plate: { 0: 'p1016.jpg' }, slots: [5], tags: ['Social', 'Text Animation'],
    texts: [{ text: '“Small steps every day.”', at: 0.3, dur: 4.4, y: 0.42, tpl: 'mat-quote', anim: ['softFade', 0.9] }, { text: '— DAILY WISDOM', at: 1, dur: 3.6, y: 0.62, tpl: 'mat-pill-label', anim: ['fadeUp', 0.6], style: { bubbleColor: '#e11d48' } }] },

  // ---- Templates modelled on the hooks library (only mechanics the engine renders). ----
  { slug: 'search-bar-promo', title: 'Search Bar Promo | Typewriter Query Types Into a Search Pill', cat: 'Business', ratio: [1080, 1920], pal: ['0x0B1220', '0x2563EB'], scene: 'grid', accent: '#2563eb', slots: [5], tags: ['UI Animation', 'Promo', 'Text Animation'],
    texts: [{ text: 'SEARCH', at: 0.3, dur: 4.4, y: 0.3, tpl: 'mat-pill-label', anim: ['fadeDown', 0.5] }, { text: 'best coffee near me', at: 0.6, dur: 4.1, y: 0.44, tpl: 'title-typewriter' }, { text: 'Tap the link to try it', at: 2.8, dur: 1.8, y: 0.78, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'number-counter', title: 'Number Counter | Stepped Numbers Count Up to the Final Figure', cat: 'Business', ratio: [1080, 1080], pal: ['0x111827', '0x22C55E'], scene: 'glow', accent: '#22c55e', slots: [5], tags: ['Text Animation', 'Promo', 'Engagement'],
    texts: [{ text: 'HAPPY CUSTOMERS', at: 0.2, dur: 4.6, y: 0.24, tpl: 'mat-pill-label', anim: ['fadeDown', 0.5] }, { text: '0', at: 0.3, dur: 0.55, y: 0.46, tpl: 'mat-big-number', anim: ['pop', 0.3], style: { color: '#4ade80' } }, { text: '250', at: 0.9, dur: 0.55, y: 0.46, tpl: 'mat-big-number', anim: ['pop', 0.3], style: { color: '#4ade80' } }, { text: '500', at: 1.5, dur: 0.55, y: 0.46, tpl: 'mat-big-number', anim: ['pop', 0.3], style: { color: '#4ade80' } }, { text: '750', at: 2.1, dur: 0.55, y: 0.46, tpl: 'mat-big-number', anim: ['pop', 0.3], style: { color: '#4ade80' } }, { text: '1,000+', at: 2.7, dur: 2.1, y: 0.46, tpl: 'mat-big-number', anim: ['zoomIn', 0.6], style: { color: '#4ade80' } }] },
  { slug: 'portfolio-showcase', title: 'Portfolio Card Showcase | Photo Cards Slide In Over Your Backdrop', cat: 'Business', ratio: [1920, 1080], pal: ['0x101018', '0x3B3B52'], scene: 'glow', accent: '#825cfb', slots: [6], tags: ['Mockup', 'Promo', 'Social'],
    cards: [{ photo: 'p1015.jpg', at: 0.4, x: -0.31, anim: 'slide_up' }, { photo: 'p1060.jpg', at: 1, x: 0, anim: 'slide_up' }, { photo: 'p292.jpg', at: 1.6, x: 0.31, anim: 'slide_up' }],
    texts: [{ text: 'SELECTED WORK', at: 0.3, dur: 5.4, y: 0.12, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.55] }, { text: 'Replace each card with your own photos', at: 2.4, dur: 3.3, y: 0.84, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.55] }] },
  { slug: 'paper-strip-headline', title: 'Paper Strip Headline | Coloured Strips Slide In With Your Lines', cat: 'Social', ratio: [1080, 1920], pal: ['0xF3EAD8', '0xE4D5B8'], scene: 'paper', accent: '#f59e0b', slots: [5], tags: ['Text Animation', 'Social', 'Promo'],
    texts: [{ text: 'YOUR FIRST LINE', at: 0.3, dur: 4.4, y: 0.3, tpl: 'mat-headline-bar', x: -0.05, anim: ['slideLeftSmooth', 0.6], style: { bg: { on: true, color: '#f59e0b', opacity: 1, radius: 4, padding: 0.3, mode: 'block' }, color: '#16161f' } },
      { text: 'YOUR SECOND LINE', at: 0.55, dur: 4.15, y: 0.46, tpl: 'mat-headline-bar', x: 0.05, anim: ['slideRightSmooth', 0.6], style: { bg: { on: true, color: '#825cfb', opacity: 1, radius: 4, padding: 0.3, mode: 'block' }, color: '#ffffff' } },
      { text: 'AND THE PUNCHLINE', at: 0.8, dur: 3.9, y: 0.62, tpl: 'mat-headline-bar', x: -0.03, anim: ['settleUp', 0.7], style: { bg: { on: true, color: '#14b8a6', opacity: 1, radius: 4, padding: 0.3, mode: 'block' }, color: '#06251f' } }] },
  { slug: 'five-step-process', title: '5-Step Process | Numbered Steps Appear One by One', cat: 'Education', ratio: [1920, 1080], pal: ['0x0B2537', '0x0EA5E9'], scene: 'grid', accent: '#0ea5e9', slots: [6], tags: ['Process', 'UI Animation'],
    texts: [{ text: 'HOW IT WORKS', at: 0.2, dur: 5.6, y: 0.1, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.55] },
      { text: '1 — TELL US YOUR GOAL', at: 0.5, dur: 5.3, y: 0.28, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] }, { text: '2 — WE PLAN IT WITH YOU', at: 1.5, dur: 4.3, y: 0.42, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] },
      { text: '3 — THE WORK BEGINS', at: 2.5, dur: 3.3, y: 0.56, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] }, { text: '4 — YOU REVIEW EVERY STEP', at: 3.5, dur: 2.3, y: 0.7, tpl: 'mat-lower-third', anim: ['slideUpSmooth', 0.55] },
      { text: '5 — LAUNCH DAY', at: 4.5, dur: 1.3, y: 0.84, tpl: 'mat-lower-third', anim: ['settleUp', 0.65] }] },
  { slug: 'logo-reveal', title: 'Logo Reveal | Your Logo Scales and Fades In Over the Shot', cat: 'Business', ratio: [1920, 1080], pal: ['0x0A0A13', '0x1B1B2E'], scene: 'glow', accent: '#825cfb', slots: [4], tags: ['Logo Animation', 'Promo'],
    logo: { at: 0.4, dur: 3.3, scale: 0.42, y: -0.06 },
    texts: [{ text: 'YOUR TAGLINE HERE', at: 1.2, dur: 2.5, y: 0.68, tpl: 'mat-caption-chip', anim: ['fadeUp', 0.6] }] },
  { slug: 'phone-mockup-promo', title: 'Phone Mockup Promo | Your Video Plays Inside a Phone Frame', cat: 'Business', ratio: [1080, 1920], pal: ['0x0B1220', '0x1E293B'], scene: 'grid', accent: '#38bdf8', plate: { 0: 'p1060.jpg' }, slots: [5], tags: ['Mockup', 'Promo', 'Social'],
    frame: true,
    texts: [{ text: 'SEE IT IN THE APP', at: 0.3, dur: 4.4, y: 0.07, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.55] }] },
  { slug: 'word-wheel', title: 'Word Wheel | One Word Rotates Through Your Message', cat: 'Social', ratio: [1080, 1080], pal: ['0x14101F', '0x4C1D95'], scene: 'stage', accent: '#8b5cf6', slots: [5], tags: ['Text Animation', 'Engagement', 'Social'],
    texts: [{ text: 'Made for', at: 0.2, dur: 4.4, y: 0.34, tpl: 'mat-accent-bar', anim: ['fadeDown', 0.55] }, { text: 'CREATORS', at: 0.3, dur: 0.9, y: 0.55, tpl: 'mat-duo-title', anim: ['slideUpSmooth', 0.4] }, { text: 'TEACHERS', at: 1.3, dur: 0.9, y: 0.55, tpl: 'mat-duo-title', anim: ['slideUpSmooth', 0.4] }, { text: 'SELLERS', at: 2.3, dur: 0.9, y: 0.55, tpl: 'mat-duo-title', anim: ['slideUpSmooth', 0.4] }, { text: 'YOU', at: 3.3, dur: 1.4, y: 0.55, tpl: 'mat-duo-title', anim: ['settleUp', 0.7] }] },
];

// ---- Variant multiplication: accent variants for four more hero designs (report §5.1 —
// variants multiply listings; the scene re-grades and the hero text takes the accent). ----
const VARIANT_SETS = [
  { base: 'product-promo', hero: 1, prop: 'color', sets: [['teal', '0x04201C', '0x14B8A6', '#2dd4bf'], ['coral', '0x2B0E0A', '0xF97066', '#fdba74'], ['violet', '0x1E1B4B', '0x825CFB', '#c4b5fd']] },
  { base: 'sale-countdown', hero: 1, prop: 'color', sets: [['teal', '0x04201C', '0x14B8A6', '#5eead4'], ['violet', '0x1E1B4B', '0x825CFB', '#c4b5fd'], ['amber', '0x231303', '0xF59E0B', '#fcd34d']] },
  { base: 'motivational-quote', hero: 1, prop: 'bubbleColor', sets: [['teal', '0x04201C', '0x0D9488', '#0d9488'], ['coral', '0x2B0E0A', '0xF43F5E', '#e11d48'], ['amber', '0x231303', '0xD97706', '#d97706']] },
  { base: 'travel-vlog', hero: 0, prop: 'color2', sets: [['coral', '0x2B0E0A', '0xF97066', '#f97066'], ['violet', '0x1E1B4B', '0x825CFB', '#a78bfa'], ['amber', '0x231303', '0xF59E0B', '#fbbf24']] },
];
for (const vs of VARIANT_SETS) {
  const base = DEFS.find((d) => d.slug === vs.base);
  for (const [name, ground, acc0x, accCss] of vs.sets) {
    const def = JSON.parse(JSON.stringify(base));
    def.slug = `${vs.base}-${name}`;
    def.title = `${base.title} — ${name[0].toUpperCase() + name.slice(1)}`;
    def.pal = [ground, acc0x];
    def.accent = accCss;
    def.texts[vs.hero].style = { ...(def.texts[vs.hero].style || {}), [vs.prop]: accCss };
    DEFS.push(def);
  }
}

const total = (def) => def.slots.reduce((a, b) => a + b, 0);

function run(args) { execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' }); }
function py(script, args) { execFileSync('python3', [script, ...args.map(String)], { stdio: 'pipe' }); }

// One designed still for a slot: a graded photo plate where the concept fits, else a composed scene.
function stillFor(def, i, w, h) {
  const file = path.join(WORK, `${def.slug}-still${i}.png`);
  const photo = def.plate?.[i] ? path.join(PHOTOS, def.plate[i]) : '-';
  py(SCENE_PY, [def.plate?.[i] ? 'photo' : def.scene, w, h, def.pal[0], def.pal[1], def.accent, photo, file]);
  return file;
}

// The still becomes a living shot: a slow push-in (zoompan), never a frozen card.
async function mediaFor(def, i, dur) {
  const [w, h] = def.ratio;
  const mw = Math.min(w, 720);
  const mh = Math.round(mw * h / w / 2) * 2;
  const sw = Math.min(1080, Math.round(mw * 1.5));
  const sh = Math.round(sw * h / w / 2) * 2;
  const still = stillFor(def, i, sw, sh);
  const file = path.join(WORK, `${def.slug}-m${i}.mp4`);
  const frames = Math.max(15, Math.round(dur * 30));
  run(['-i', still, '-vf', `zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${mw}x${mh}:fps=30`, '-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  return { id: `m${i}`, name: `Replace me ${i + 1}.mp4`, path: file, ...(await ff.probe(file)) };
}

async function cardFor(def, name, c) {
  const file = path.join(WORK, `${def.slug}-${name}.png`);
  const src = c.photo ? path.join(PHOTOS, c.photo) : stillFor(def, `card${name}`, 640, 400);
  py(CARD_PY, [src, 592, 352, def.accent.replace('#', ''), file]);
  return { id: name, name: `${name}.png`, path: file, ...(await ff.probe(file)) };
}

async function bedFor(def, dur) {
  const file = path.join(WORK, `${def.slug}-bed.m4a`);
  run(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=' + dur, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=' + dur,
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first,volume=0.2', '-c:a', 'aac', file]);
  return { id: 'bed', name: 'Music bed (placeholder).m4a', path: file, ...(await ff.probe(file)) };
}

// ~3s animated preview rendered from the template itself: its own first scene (looped to
// length) with its own first two texts at their own heights plus the accent bar.
function previewFor(def, mediaFile, dir) {
  const out = path.join(dir, 'preview.mp4');
  const [w, h] = def.ratio;
  const pw = 480, ph = Math.round(pw * h / w / 2) * 2;
  const head = (def.texts[0]?.text || def.title.split('|')[0].trim()).slice(0, 42);
  const sub = def.texts[1] && def.texts[1].y !== def.texts[0]?.y && !def.texts[1].tpl.includes('big-number') ? def.texts[1].text.slice(0, 42) : '';
  const png = path.join(WORK, `${def.slug}-headline.png`);
  py(HEADLINE_PY, [head, sub, def.accent.replace('#', ''), def.texts[0]?.y ?? 0.42, def.texts[1]?.y ?? 0.6, pw, ph, png]);
  run(['-stream_loop', '-1', '-i', mediaFile, '-i', png, '-filter_complex', `[0:v]scale=${pw}:${ph}[bg];[bg][1:v]overlay=0:0[v]`, '-map', '[v]', '-t', '3', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  return out;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(SCENE_PY, SCENE_SRC);
  fs.writeFileSync(CARD_PY, CARD_SRC);
  fs.writeFileSync(FRAME_PY, FRAME_SRC);
  fs.writeFileSync(HEADLINE_PY, HEADLINE_SRC);
  for (const def of DEFS) {
    if (!def.tags?.length || def.tags.some((t) => !TAXONOMY.includes(t))) throw new Error(`${def.slug}: tags must come from the taxonomy`);
    const [w, h] = def.ratio;
    const dur = total(def);
    let uid = 0; const nid = (p) => `${p}${++uid}`;
    const media = []; const videoClips = []; const overlayClips = []; const audioClips = []; const textClips = [];
    for (let i = 0; i < def.slots.length; i++) {
      const m = await mediaFor(def, i, def.slots[i] + (def.transition ? 0.6 : 0));
      media.push(m);
      videoClips.push({ id: nid('v'), mediaId: m.id, in: 0, out: def.slots[i], speed: 1, volume: 1, muted: false, slot: true, ...(def.transition && i > 0 ? { transition: { type: def.transition, duration: 0.5 } } : {}) });
    }
    if (def.bed) { const b = await bedFor(def, dur); media.push(b); audioClips.push({ id: nid('a'), mediaId: b.id, in: 0, out: dur, start: 0, volume: 0.8 }); }
    // Portfolio cards: replaceable photo cards on designed card stock, staggered in.
    for (let i = 0; i < (def.cards || []).length; i++) {
      const c = def.cards[i];
      const m = await cardFor(def, `card${i}`, c); media.push(m);
      overlayClips.push({ id: nid('o'), mediaId: m.id, in: 0, out: Math.max(0.5, dur - c.at), start: c.at, speed: 1, volume: 0, muted: true, slot: true, transform: { scale: 0.3, x: c.x, y: 0.04, rot: 0 }, anim: { in: { type: c.anim, duration: 0.55 } } });
    }
    // Logo reveal: the app's own mark stands in for the user's logo (a replaceable overlay slot).
    if (def.logo) {
      const file = path.join(WORK, `${def.slug}-logo.png`);
      fs.copyFileSync(path.join(ROOT, 'public', 'logo.png'), file);
      const m = { id: 'logo', name: 'Your logo.png', path: file, ...(await ff.probe(file)) };
      media.push(m);
      overlayClips.push({ id: nid('o'), mediaId: m.id, in: 0, out: def.logo.dur, start: def.logo.at, speed: 1, volume: 0, muted: true, slot: true, transform: { scale: def.logo.scale, x: 0, y: def.logo.y, rot: 0 }, anim: { in: { type: 'zoom_in', duration: 0.7 }, out: { type: 'fade_out', duration: 0.5 } } });
    }
    // Phone mockup: a frame (transparent centre, border + notch) over the slot video.
    if (def.frame) {
      const fw = 720, fh = Math.round(720 * h / w);
      const file = path.join(WORK, `${def.slug}-frame.png`);
      py(FRAME_PY, [fw, fh, file]);
      const m = { id: 'frame', name: 'Phone frame.png', path: file, ...(await ff.probe(file)) };
      media.push(m);
      overlayClips.push({ id: nid('o'), mediaId: m.id, in: 0, out: dur, start: 0, speed: 1, volume: 0, muted: true, transform: { scale: 1, x: 0, y: 0, rot: 0 } });
    }
    (def.texts || []).forEach((t) => textClips.push({ id: nid('t'), text: t.text, start: t.at, duration: t.dur, ...(t.x !== undefined ? { x: t.x } : {}), y: t.y, template: t.tpl, ...(t.anim ? { animIn: { id: t.anim[0], dur: t.anim[1], unit: 'whole' } } : {}), ...(t.style || {}) }));
    const slots = videoClips.filter((c) => c.slot).length + overlayClips.filter((c) => c.slot).length;
    const project = { name: def.title, ratio: `${w}:${h}`, width: w, height: h, fps: 30, media, videoClips, overlayClips, audioClips, textClips, stickerClips: [] };
    // The slot contract (report §2.1): duration · ratio · N texts · N media, computed, not typed.
    const meta = { ratio: project.ratio, width: w, height: h, duration: Math.round(dur * 100) / 100, slots, texts: textClips.length, media: slots };
    const res = await pack(project, meta, OUT, { ffmpegPath: FFMPEG });
    const dir = path.join(OUT, def.slug);
    fs.renameSync(res.dir, dir);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
    doc.info = { title: def.title, category: def.cat, description: `${def.title.split('|')[1]?.trim() || def.title}. Placeholder scenes and music are generated samples — replace the marked clips with your own.`, tags: def.tags };
    fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify(doc, null, 1), 'utf8');
    previewFor(def, media[0].path, dir);
    console.log('built', def.slug, `(${slots} slots, ${textClips.length} texts, ${def.tags.join('/')})`);
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`Done: ${DEFS.length} bundled templates.`);
})().catch((e) => { console.error(e); process.exit(1); });
