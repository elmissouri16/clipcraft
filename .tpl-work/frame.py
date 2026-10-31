
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
