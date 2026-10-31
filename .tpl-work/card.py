
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
