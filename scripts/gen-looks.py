"""Generates shared/looks.json: the single catalog read by the preview (src/looks) and the export (electron/looks.cjs).

Expression language (animations / motion): numbers, + - * / ( ), p (progress 0..1), t (clip-local seconds),
dur (clip length in seconds) and the functions sin cos pow abs min max clip mod lt gt and the constant PI.
These are valid FFmpeg expressions AND are evaluated in JS by src/looks/expr.js, so both sides run the same math.
"""
import json
import sys

out = {}

# ---------------------------------------------------------------- filters (color looks)
# ff: FFmpeg filter chain. css: preview approximation (CSS filter functions or url(#svg-filter)).
F = []
def f(id, name, ff, css, cat):
    F.append({'id': id, 'name': name, 'ff': ff, 'css': css, 'cat': cat})

f('none', 'None', None, '', 'Basic')
f('bw', 'Black & White', 'hue=s=0', 'grayscale(1)', 'Mono')
f('sepia', 'Sepia', 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', 'sepia(1)', 'Vintage')
f('vintage', 'Vintage', 'curves=preset=vintage', 'sepia(0.45) contrast(0.9) saturate(0.85) brightness(1.05)', 'Vintage')
f('warm', 'Warm', 'colorbalance=rs=0.12:gs=0.02:bs=-0.12:rm=0.08:bm=-0.08', 'sepia(0.2) saturate(1.25) hue-rotate(-8deg)', 'Basic')
f('cool', 'Cool', 'colorbalance=rs=-0.1:bs=0.12:rm=-0.06:bm=0.08', 'saturate(1.1) hue-rotate(12deg) brightness(1.02)', 'Basic')
f('vivid', 'Vivid', 'eq=saturation=1.6:contrast=1.12', 'saturate(1.6) contrast(1.12)', 'Basic')
f('fade', 'Faded', 'eq=contrast=0.8:saturation=0.7:brightness=0.06', 'contrast(0.8) saturate(0.7) brightness(1.1)', 'Basic')
f('drama', 'Drama', 'eq=contrast=1.4:saturation=0.8:brightness=-0.05', 'contrast(1.4) saturate(0.8) brightness(0.92)', 'Cinematic')
f('invert', 'Negative', 'negate', 'invert(1)', 'Creative')
f('cinematic', 'Cinematic', 'curves=preset=strong_contrast,colorbalance=rs=-0.05:bs=0.08:rh=0.06:bh=-0.05', 'contrast(1.25) saturate(0.9) hue-rotate(-4deg)', 'Cinematic')
f('tealorange', 'Teal & Orange', 'colorbalance=rs=-0.12:gs=-0.02:bs=0.16:rh=0.16:gh=0.04:bh=-0.14,eq=contrast=1.1:saturation=1.15', 'contrast(1.1) saturate(1.25) hue-rotate(-10deg)', 'Cinematic')
f('bleach', 'Bleach Bypass', 'eq=saturation=0.45:contrast=1.35', 'grayscale(0.55) contrast(1.35)', 'Cinematic')
f('noir', 'Noir', 'hue=s=0,eq=contrast=1.5:brightness=-0.05', 'grayscale(1) contrast(1.5) brightness(0.95)', 'Mono')
f('silver', 'Silver', 'hue=s=0,eq=contrast=1.15:brightness=0.04', 'grayscale(1) contrast(1.15) brightness(1.04)', 'Mono')
f('golden', 'Golden Hour', 'colorbalance=rs=0.1:gs=0.04:bs=-0.15:rm=0.1:gm=0.04:bm=-0.1,eq=saturation=1.2', 'sepia(0.35) saturate(1.3) hue-rotate(-10deg)', 'Warm')
f('sunset', 'Sunset', 'colorbalance=rs=0.18:gs=-0.02:bs=-0.1:rh=0.12:bh=-0.06,eq=saturation=1.25:contrast=1.05', 'sepia(0.3) saturate(1.4) hue-rotate(-18deg)', 'Warm')
f('autumn', 'Autumn', 'colorbalance=rs=0.14:gs=0.04:bs=-0.12:rm=0.08:bm=-0.06,eq=saturation=1.15', 'sepia(0.3) saturate(1.2) hue-rotate(-12deg)', 'Warm')
f('tungsten', 'Tungsten', 'colortemperature=temperature=4000', 'sepia(0.35) saturate(1.1) hue-rotate(-12deg)', 'Warm')
f('moonlight', 'Moonlight', 'colorbalance=rs=-0.12:bs=0.2:rm=-0.08:bm=0.12,eq=brightness=-0.06:saturation=0.8', 'hue-rotate(18deg) brightness(0.9) saturate(0.8)', 'Cool')
f('ice', 'Ice', 'colortemperature=temperature=9500', 'hue-rotate(12deg) brightness(1.04) saturate(0.95)', 'Cool')
f('forest', 'Forest', 'colorbalance=rs=-0.1:gs=0.12:bs=-0.05,eq=saturation=1.25', 'hue-rotate(20deg) saturate(1.25)', 'Cool')
f('pastel', 'Pastel', 'eq=saturation=0.75:brightness=0.08:contrast=0.85', 'saturate(0.75) brightness(1.08) contrast(0.85)', 'Soft')
f('matte', 'Matte', "curves=all='0/0.08 1/0.92'", 'contrast(0.85) brightness(1.05)', 'Soft')
f('highkey', 'High Key', 'eq=brightness=0.12:contrast=0.9:saturation=0.9', 'brightness(1.12) contrast(0.9) saturate(0.9)', 'Soft')
f('lowkey', 'Low Key', 'eq=brightness=-0.1:contrast=1.3', 'brightness(0.9) contrast(1.3)', 'Cinematic')
f('dreamy', 'Dreamy', 'eq=brightness=0.06:saturation=1.1,gblur=sigma=1.2', 'blur(0.6px) brightness(1.06) saturate(1.1)', 'Soft')
f('crisp', 'Crisp', 'unsharp=5:5:1.2,eq=contrast=1.12:saturation=1.15', 'contrast(1.12) saturate(1.15)', 'Sharp')
f('hdr', 'HDR', 'eq=contrast=1.25:saturation=1.35,unsharp=7:7:0.9', 'contrast(1.25) saturate(1.35)', 'Sharp')
f('film', 'Film', 'curves=preset=vintage,noise=alls=10:allf=t,eq=saturation=1.1', 'sepia(0.3) contrast(1.05) saturate(1.1)', 'Vintage')
f('polaroid', 'Polaroid', 'colorbalance=rs=0.08:bs=-0.06,eq=contrast=0.9:saturation=0.85:brightness=0.05', 'sepia(0.25) contrast(0.9) saturate(0.85) brightness(1.05)', 'Vintage')
f('xpro', 'Cross Process', 'curves=preset=cross_process', 'contrast(1.2) saturate(1.3) hue-rotate(-12deg)', 'Creative')
f('cyber', 'Cyber', 'colorbalance=rs=0.1:gs=-0.08:bs=0.18,eq=saturation=1.5:contrast=1.15', 'saturate(1.5) contrast(1.15) hue-rotate(-30deg)', 'Creative')
f('neonpink', 'Neon Pink', 'colorbalance=rs=0.2:gs=-0.1:bs=0.15,eq=saturation=1.4', 'saturate(1.4) hue-rotate(-40deg)', 'Creative')
f('duoblue', 'Duotone Blue', 'hue=s=0,colorize=hue=220:saturation=0.8:lightness=0.5:mix=0.8', 'grayscale(1) sepia(1) hue-rotate(170deg) saturate(2)', 'Creative')
f('duopink', 'Duotone Pink', 'hue=s=0,colorize=hue=330:saturation=0.8:lightness=0.5:mix=0.8', 'grayscale(1) sepia(1) hue-rotate(290deg) saturate(2)', 'Creative')
f('posterize', 'Posterize', "lutrgb=r='floor(val/51)*51':g='floor(val/51)*51':b='floor(val/51)*51'", 'contrast(1.5) saturate(1.4)', 'Creative')
f('sketch', 'Sketch', 'edgedetect=low=0.08:high=0.25,negate', 'grayscale(1) contrast(3) brightness(1.3)', 'Creative')
f('vibrance', 'Vibrance', 'vibrance=intensity=0.8', 'saturate(1.35)', 'Basic')
f('lighten', 'Lighten', 'curves=preset=lighter', 'brightness(1.15)', 'Basic')
f('darken', 'Darken', 'curves=preset=darker', 'brightness(0.85)', 'Basic')
out['filters'] = F

# ---------------------------------------------------------------- effects (toggle several per clip)
# ff: static FFmpeg chain. css: static preview filter. cls: preview overlay class.
# motion: per-frame transform expressions (sx sy dx dy rot bright). cssIf: preview filter active while expr != 0.
E = []
def e(id, name, icon, **kw):
    E.append({'id': id, 'name': name, 'icon': icon, **kw})

e('mirror', 'Mirror', 'mirror', ff='hflip', flipx=True, cat='Basic')
e('flipv', 'Flip', 'flip', ff='vflip', flipy=True, cat='Basic')
e('vignette', 'Vignette', 'vignette', ff='vignette=PI/4', cls='vignette', cat='Basic')
e('grain', 'Grain', 'grain', ff='noise=alls=18:allf=t', cat='Texture')
e('blur', 'Blur', 'blur', css='blur(6px)', cat='Basic')  # ff handled with adjust.blur
e('pixel', 'Pixel', 'pixel', ff='scale=iw/24:ih/24,scale={W}:{H}:flags=neighbor', cat='Texture')
e('sharpen', 'Sharpen', 'sharpen', ff='unsharp=5:5:1.5', css='contrast(1.1)', cat='Basic')
e('rgbsplit', 'RGB Split', 'rgb', ff='rgbashift=rh=-{4u}:bh={4u}', css='url(#fx-rgbsplit)', cat='Glitch')
e('glitch', 'Glitch', 'glitch', ff="rgbashift=rh=-{12u}:bh={12u}:enable='gt(sin(t*13),0.8)'", cssIf={'when': 'gt(sin(t*13),0.8)', 'css': 'url(#fx-rgbsplit-strong)'}, cat='Glitch')
e('vhs', 'VHS', 'vhs', ff='noise=alls=22:allf=t,rgbashift=rh={3u}:bh=-{3u},eq=saturation=1.35:contrast=1.1,gblur=sigma=0.8:sigmaV=0.01', css='url(#fx-rgbsplit) saturate(1.3) contrast(1.1)', cat='Glitch')
e('oldfilm', 'Old Film', 'film', ff="curves=preset=vintage,noise=alls=25:allf=t,vignette=PI/4,eq=brightness='0.04*sin(t*37)':eval=frame", css='sepia(0.6) contrast(1.1)', cls='vignette', cat='Texture')
e('letterbox', 'Cinema Bars', 'bars', ff='drawbox=x=0:y=0:w=iw:h=ih*0.12:color=black:t=fill,drawbox=x=0:y=ih*0.88:w=iw:h=ih*0.12:color=black:t=fill', cls='letterbox', cat='Basic')
e('shake', 'Shake', 'shake', motion={'sx': '1.08', 'sy': '1.08', 'dx': '0.012*sin(t*47)', 'dy': '0.012*cos(t*53)'}, cat='Motion')
e('wobble', 'Wobble', 'wobble', motion={'sx': '1.1', 'sy': '1.1', 'rot': '0.04*sin(t*4)'}, cat='Motion')
e('zoompulse', 'Zoom Pulse', 'pulse', motion={'sx': '1+0.07*pow(abs(sin(t*3)),2)', 'sy': '1+0.07*pow(abs(sin(t*3)),2)'}, cat='Motion')
e('strobe', 'Strobe', 'strobe', motion={'bright': '0.45*pow(max(0,sin(t*9)),10)'}, cat='Motion')
e('bounce', 'Bounce', 'bounce', motion={'sx': '1.06', 'sy': '1.06', 'dy': '0.03*abs(sin(t*6))'}, cat='Motion')
e('spin', 'Slow Spin', 'spin', motion={'sx': '1.5', 'sy': '1.5', 'rot': 't*0.6'}, cat='Motion')
e('driftzoom', 'Slow Zoom', 'zoom', motion={'sx': '1+0.25*clip(t/dur,0,1)', 'sy': '1+0.25*clip(t/dur,0,1)'}, cat='Motion')
out['effects'] = E

# ---------------------------------------------------------------- clip animations
# kind in/out: p = progress of the animation (in: 0 -> 1 at the start; out: 1 -> 0 at the end), identity at p = 1.
# kind combo: p = t / dur over the whole clip. fade: 'black' | 'white' | None. blur: pixels (preview) while active.
A = []
def a(id, name, kind, **kw):
    A.append({'id': id, 'name': name, 'kind': kind, **kw})

EZ = '(1-pow(1-p,3))'
BACK = '(1+2.70158*pow(p-1,3)+1.70158*pow(p-1,2))'
a('none', 'None', 'in'); a('none', 'None', 'out'); a('none', 'None', 'combo')
# --- In
a('fadeIn', 'Fade In', 'in', fade='black')
a('flashIn', 'Flash In', 'in', fade='white')
a('zoomIn', 'Zoom In', 'in', sx='1.5-0.5*' + EZ, sy='1.5-0.5*' + EZ, fade='black')
a('growIn', 'Grow', 'in', sx='0.4+0.6*' + EZ, sy='0.4+0.6*' + EZ, fade='black')
a('popIn', 'Pop', 'in', sx='0.3+0.7*' + BACK, sy='0.3+0.7*' + BACK)
a('slideLeftIn', 'Slide Left', 'in', dx='0.6*pow(1-p,3)')
a('slideRightIn', 'Slide Right', 'in', dx='-0.6*pow(1-p,3)')
a('slideUpIn', 'Slide Up', 'in', dy='0.6*pow(1-p,3)')
a('slideDownIn', 'Slide Down', 'in', dy='-0.6*pow(1-p,3)')
a('spinIn', 'Spin In', 'in', rot='-1.2*pow(1-p,3)', sx='0.5+0.5*' + EZ, sy='0.5+0.5*' + EZ, fade='black')
a('rotateZoomIn', 'Rotate Zoom', 'in', rot='0.8*pow(1-p,2)', sx='1.4-0.4*' + EZ, sy='1.4-0.4*' + EZ, fade='black')
a('flipIn', 'Flip In', 'in', sx='0.02+0.98*' + EZ)
a('dropIn', 'Drop', 'in', dy='-0.45*pow(1-p,2)*abs(cos(p*10))')
a('swingIn', 'Swing', 'in', rot='0.5*pow(1-p,2)*cos(p*14)', fade='black')
a('blurIn', 'Blur In', 'in', blur=14, fade='black')
a('glitchIn', 'Glitch In', 'in', dx='0.04*(1-p)*sin(p*90)', bright='0.3*(1-p)*max(0,sin(p*70))')
a('riseIn', 'Rise', 'in', dy='0.08*(1-p)', fade='black')
a('stretchIn', 'Stretch', 'in', sx='0.2+0.8*' + EZ, sy='1.3-0.3*' + EZ, fade='black')
# --- Out
a('fadeOut', 'Fade Out', 'out', fade='black')
a('flashOut', 'Flash Out', 'out', fade='white')
a('zoomOut', 'Zoom Out', 'out', sx='1.5-0.5*' + EZ, sy='1.5-0.5*' + EZ, fade='black')
a('shrinkOut', 'Shrink', 'out', sx='0.4+0.6*' + EZ, sy='0.4+0.6*' + EZ, fade='black')
a('popOut', 'Pop Out', 'out', sx='0.3+0.7*' + BACK, sy='0.3+0.7*' + BACK)
a('slideLeftOut', 'Slide Left', 'out', dx='-0.6*pow(1-p,3)')
a('slideRightOut', 'Slide Right', 'out', dx='0.6*pow(1-p,3)')
a('slideUpOut', 'Slide Up', 'out', dy='-0.6*pow(1-p,3)')
a('slideDownOut', 'Slide Down', 'out', dy='0.6*pow(1-p,3)')
a('spinOut', 'Spin Out', 'out', rot='1.2*pow(1-p,3)', sx='0.5+0.5*' + EZ, sy='0.5+0.5*' + EZ, fade='black')
a('flipOut', 'Flip Out', 'out', sx='0.02+0.98*' + EZ)
a('dropOut', 'Fall', 'out', dy='0.7*pow(1-p,2)', fade='black')
a('blurOut', 'Blur Out', 'out', blur=14, fade='black')
a('glitchOut', 'Glitch Out', 'out', dx='0.04*(1-p)*sin(p*90)', bright='0.3*(1-p)*max(0,sin(p*70))')
# --- Combo (whole clip)
a('kenIn', 'Ken Burns In', 'combo', sx='1+0.2*p', sy='1+0.2*p')
a('kenOut', 'Ken Burns Out', 'combo', sx='1.2-0.2*p', sy='1.2-0.2*p')
a('panLeft', 'Pan Left', 'combo', sx='1.15', sy='1.15', dx='0.06-0.12*p')
a('panRight', 'Pan Right', 'combo', sx='1.15', sy='1.15', dx='-0.06+0.12*p')
a('panUp', 'Pan Up', 'combo', sx='1.15', sy='1.15', dy='0.06-0.12*p')
a('panDown', 'Pan Down', 'combo', sx='1.15', sy='1.15', dy='-0.06+0.12*p')
a('pulse', 'Pulse', 'combo', sx='1+0.05*sin(t*5)', sy='1+0.05*sin(t*5)')
a('heartbeat', 'Heartbeat', 'combo', sx='1+0.07*pow(max(0,sin(t*6)),6)', sy='1+0.07*pow(max(0,sin(t*6)),6)')
a('sway', 'Sway', 'combo', sx='1.1', sy='1.1', rot='0.05*sin(t*2)')
a('rock', 'Rock', 'combo', sx='1.12', sy='1.12', rot='0.03*sin(t*6)')
a('breathe', 'Breathe', 'combo', sx='1+0.04*sin(t*2)', sy='1+0.04*sin(t*2)')
a('floatC', 'Float', 'combo', sx='1.06', sy='1.06', dy='0.025*sin(t*2)')
a('flicker', 'Flicker', 'combo', bright='0.18*sin(t*40)')
out['anims'] = A

# ---------------------------------------------------------------- transitions (FFmpeg xfade names)
# pv: preview kind used by src/components/Preview.jsx (unknown kinds fall back to a crossfade).
T = []
def t(id, name, pv, cat):
    T.append({'id': id, 'name': name, 'pv': pv, 'cat': cat})

t('fade', 'Crossfade', 'fade', 'Basic'); t('fadeblack', 'Fade to Black', 'fadeblack', 'Basic'); t('fadewhite', 'Fade to White', 'fadewhite', 'Basic')
t('fadegrays', 'Fade Grays', 'fade', 'Basic'); t('fadefast', 'Fast Fade', 'fade', 'Basic'); t('fadeslow', 'Slow Fade', 'fade', 'Basic')
t('dissolve', 'Dissolve', 'fade', 'Basic'); t('pixelize', 'Pixelize', 'fade', 'Basic'); t('distance', 'Distance', 'fade', 'Basic'); t('hblur', 'Horizontal Blur', 'fade', 'Basic')
t('wipeleft', 'Wipe Left', 'wipeleft', 'Wipe'); t('wiperight', 'Wipe Right', 'wiperight', 'Wipe')
t('wipeup', 'Wipe Up', 'wipeup', 'Wipe'); t('wipedown', 'Wipe Down', 'wipedown', 'Wipe')
t('wipetl', 'Wipe Corner TL', 'diag', 'Wipe'); t('wipebr', 'Wipe Corner BR', 'diag', 'Wipe')
t('smoothleft', 'Smooth Left', 'wipeleft', 'Wipe'); t('smoothright', 'Smooth Right', 'wiperight', 'Wipe')
t('smoothup', 'Smooth Up', 'wipeup', 'Wipe'); t('smoothdown', 'Smooth Down', 'wipedown', 'Wipe')
t('slideleft', 'Slide Left', 'slideleft', 'Slide'); t('slideright', 'Slide Right', 'slideright', 'Slide')
t('slideup', 'Slide Up', 'slideup', 'Slide'); t('slidedown', 'Slide Down', 'slidedown', 'Slide')
t('coverleft', 'Cover Left', 'coverleft', 'Slide'); t('coverright', 'Cover Right', 'coverright', 'Slide')
t('coverup', 'Cover Up', 'coverup', 'Slide'); t('coverdown', 'Cover Down', 'coverdown', 'Slide')
t('revealleft', 'Reveal Left', 'revealleft', 'Slide'); t('revealright', 'Reveal Right', 'revealright', 'Slide')
t('circleopen', 'Circle Open', 'circleopen', 'Shape'); t('circleclose', 'Circle Close', 'circleclose', 'Shape')
t('circlecrop', 'Circle Crop', 'circleopen', 'Shape'); t('rectcrop', 'Rect Crop', 'rectcrop', 'Shape')
t('vertopen', 'Vertical Open', 'vertopen', 'Shape'); t('vertclose', 'Vertical Close', 'vertclose', 'Shape')
t('horzopen', 'Horizontal Open', 'horzopen', 'Shape'); t('horzclose', 'Horizontal Close', 'horzclose', 'Shape')
t('radial', 'Radial', 'radial', 'Shape')
t('zoomin', 'Zoom In', 'zoomin', 'Motion'); t('squeezeh', 'Squeeze H', 'squeezeh', 'Motion'); t('squeezev', 'Squeeze V', 'squeezev', 'Motion')
t('diagtl', 'Diagonal TL', 'diag', 'Motion'); t('diagbr', 'Diagonal BR', 'diag', 'Motion')
t('hlslice', 'Slice Left', 'wipeleft', 'Motion'); t('hrslice', 'Slice Right', 'wiperight', 'Motion')
t('vuslice', 'Slice Up', 'wipeup', 'Motion'); t('vdslice', 'Slice Down', 'wipedown', 'Motion')
t('hlwind', 'Wind Left', 'wipeleft', 'Motion'); t('hrwind', 'Wind Right', 'wiperight', 'Motion')
out['transitions'] = T

path = sys.argv[1]
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
print({k: len(v) for k, v in out.items()})
