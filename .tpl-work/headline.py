
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
