
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
