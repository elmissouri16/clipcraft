// Animated effects and transitions in the style of CapCut's, written from scratch.
//
// Transitions and "pixel" effects are expressions (see expr.js): the export prints them for FFmpeg (xfade custom /
// geq) and the preview compiles the very same text to JavaScript, so both show the same picture. Sizes are always
// relative to W and H so a smaller preview canvas gives the same look. In transitions P goes 0 -> 1, A(x,y) is the
// outgoing clip and B(x,y) the incoming one; in effects T is the time in the clip and S(x,y) the source picture.

// Rounded-rectangle test (1 inside, 0 outside) for centre (cx, cy), half size (hw, hh), corner radius r.
const inRound = (cx, cy, hw, hh, r) =>
  `lt(hypot(max(abs(X-(${cx}))-(${hw})+(${r}),0),max(abs(Y-(${cy}))-(${hh})+(${r}),0))+min(max(abs(X-(${cx}))-(${hw})+(${r}),abs(Y-(${cy}))-(${hh})+(${r})),0)-(${r}),0)`;

// ---- Transitions from Transition Studio (github.com/Rhitottam/transition-studio, MIT, (c) 2025 rhitottaM) ----
// Its license:
//
// MIT License
//
// Copyright (c) 2025 rhitottaM
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Its WebGL shaders rewritten in this expression language. Changes: every one starts exactly on the outgoing clip
// and ends exactly on the incoming one (ripple, kaleidoscope and dreamy fade their effect in and out; page curl,
// diamond and crosshatch reach the whole frame), sizes follow the frame height (the same look at any resolution),
// rotations / circles keep the picture's proportions, and computed sample points get half a pixel so rounding never
// lands on the neighbouring pixel. The rise and fall of an effect is 4P(1-P) rather than
// sin(PI*P): it is exactly 0 at both ends, so the last frame is not shifted by a rounding error.
const inFrame = (x, y) => `between(${x}, 0, W)*between(${y}, 0, H)`;
// 9-tap horizontal blur of clip F (A or B) at X, Y, d pixels apart (weights of the original, which add up to 0.98:
// divided by that so the picture keeps its brightness).
const blur9 = (F, d) => `(${[[-4, 0.05], [-3, 0.09], [-2, 0.12], [-1, 0.15], [0, 0.16], [1, 0.15], [2, 0.12], [3, 0.09], [4, 0.05]]
  .map(([k, w]) => `${w}*${F}(X+(${k})*${d}, Y)`).join('+')})/0.98`;
// 3x3 box blur of clip F, d pixels apart (the original's 7x7 dreamy blur, lighter).
const box9 = (F, d) => [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => `${F}(X+(${i})*${d}, Y+(${j})*${d})`)).join('+');
// 10 samples towards the center (radial blur), amount a.
const radial10 = (F, a) => Array.from({ length: 10 }, (_, i) => `${F}(W/2+(X-W/2)*(1-(${a})*${i / 20})+0.5, H/2+(Y-H/2)*(1-(${a})*${i / 20})+0.5)`).join('+');

// ---- Helpers for the transition packs (below): offset multi-tap blurs and rotation / zoom sampling. ----
// 9-tap blur of clip F along X, centred at X + off, tap distance d (same weights as blur9).
const TAPW = [[-4, 0.05], [-3, 0.09], [-2, 0.12], [-1, 0.15], [0, 0.16], [1, 0.15], [2, 0.12], [3, 0.09], [4, 0.05]];
const hblurAt = (F, off, d) => `(${TAPW.map(([k, w]) => `${w}*${F}(X+(${off})+(${k})*(${d}), Y)`).join('+')})/0.98`;
const vblurAt = (F, off, d) => `(${TAPW.map(([k, w]) => `${w}*${F}(X, Y+(${off})+(${k})*(${d}))`).join('+')})/0.98`;
// Zoom blur of F: the frame is scaled by z (sampling a 1/z region) and streaked towards the centre by b
// (6 taps along the ray, b = 0 is a plain zoom; at z = 1 and b = 0 every tap is the pixel itself).
const zoomBlur = (F, z, b) => `(${Array.from({ length: 6 }, (_, i) => `${F}(W/2+(X-W/2)/(${z})*(1-(${b})*${(i / 5).toFixed(3)})+0.5, H/2+(Y-H/2)/(${z})*(1-(${b})*${(i / 5).toFixed(3)})+0.5)`).join('+')})/6`;
// Sample F rotated by angle a around the centre (the picture turns the other way), and an arc blur of F:
// 5 taps spread along the rotation arc around the base angle.
const rotSmp = (F, a) => `${F}(W/2+(X-W/2)*cos(${a})+(Y-H/2)*sin(${a})+0.5, H/2-(X-W/2)*sin(${a})+(Y-H/2)*cos(${a})+0.5)`;
const spinBlur = (F, ang, spread) => `(${[-1, -0.5, 0, 0.5, 1].map((k) => rotSmp(F, `(${ang})+(${spread})*${k}`)).join('+')})/5`;

export const STUDIO_TRANSITIONS = [
  { id: 'fx_wipeup', name: 'Wipe Up', duration: 0.6, expr: 'if(gt(Y, H*(1-P)), B(X, Y), A(X, Y))' },
  { id: 'fx_wipedown', name: 'Wipe Down', duration: 0.6, expr: 'if(lt(Y, H*P), B(X, Y), A(X, Y))' },
  {
    id: 'fx_diamond', name: 'Diamond Wipe', duration: 0.8,
    expr: `st(0, abs(X/W-0.5)+abs(Y/H-0.5)); st(1, smooth(P*1.06-0.05, P*1.06-0.01, ld(0)));
      B(X, Y)*(1-ld(1)) + A(X, Y)*ld(1)`,
  },
  { id: 'fx_slideup', name: 'Slide Up', duration: 0.6, expr: 'st(0, H*(1-P)); if(gte(Y, ld(0)), B(X, Y-ld(0)), A(X, Y))' },
  { id: 'fx_slidedown', name: 'Slide Down', duration: 0.6, expr: 'st(0, H*(1-P)); if(lte(Y, H-ld(0)), B(X, Y+ld(0)), A(X, Y))' },
  {
    id: 'fx_zoomin', name: 'Zoom In', duration: 0.7,
    // The next clip grows from the middle over the current one.
    expr: `st(0, max(P, 0.001)); st(1, W/2+(X-W/2)/ld(0)+0.5); st(2, H/2+(Y-H/2)/ld(0)+0.5);
      A(X, Y)*(1-P) + if(${inFrame('ld(1)', 'ld(2)')}, B(ld(1), ld(2)), 0)*P`,
  },
  {
    id: 'fx_zoomout', name: 'Zoom Out', duration: 0.7,
    // The current clip shrinks into the middle, uncovering the next one.
    expr: `st(0, max(1-P, 0.001)); st(1, W/2+(X-W/2)/ld(0)+0.5); st(2, H/2+(Y-H/2)/ld(0)+0.5);
      if(${inFrame('ld(1)', 'ld(2)')}, A(ld(1), ld(2)), 0)*(1-P) + B(X, Y)*P`,
  },
  {
    id: 'fx_spinout', name: 'Scale & Rotate', duration: 0.8,
    // The current clip turns a quarter and shrinks to half while the next one shows through.
    expr: `st(0, P*PI/2); st(1, 1-P*0.5); st(2, X-W/2); st(3, Y-H/2);
      st(4, (ld(2)*cos(ld(0))-ld(3)*sin(ld(0)))/ld(1)+W/2+0.5); st(5, (ld(2)*sin(ld(0))+ld(3)*cos(ld(0)))/ld(1)+H/2+0.5);
      if(${inFrame('ld(4)', 'ld(5)')}, A(ld(4), ld(5)), 0)*(1-P) + B(X, Y)*P`,
  },
  {
    id: 'fx_pixelate', name: 'Pixelate', duration: 0.8,
    expr: `st(0, max(1, (1+49*(4*P*(1-P)))*H/720)); st(1, floor(X/ld(0))*ld(0)+ld(0)/2); st(2, floor(Y/ld(0))*ld(0)+ld(0)/2);
      A(ld(1), ld(2))*(1-P) + B(ld(1), ld(2))*P`,
  },
  {
    id: 'fx_blur', name: 'Blur', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*20*H/720); (${blur9('A', 'ld(0)')})*(1-P) + (${blur9('B', 'ld(0)')})*P`,
  },
  {
    id: 'fx_glitch', name: 'Glitch', duration: 0.6,
    // Rows jump sideways with a red / blue split, strongest in the middle.
    expr: `st(0, (hash(floor(Y/(H*0.015))*1.37+floor(P*30)*7.13)-0.5)*(4*P*(1-P))*0.3*W);
      A(X+ld(0)*C(2, 1, 1), Y)*(1-P) + B(X-ld(0)*C(1, 1, 2), Y)*P`,
  },
  {
    id: 'fx_ripple', name: 'Ripple', duration: 1,
    expr: `st(0, hypot(X-W/2, Y-H/2)/H); st(1, sin((ld(0)-P)*30)*0.02*H*(4*P*(1-P))); st(2, max(ld(0)*H, 0.001));
      st(3, X+(X-W/2)/ld(2)*ld(1)+0.5); st(4, Y+(Y-H/2)/ld(2)*ld(1)+0.5);
      A(ld(3), ld(4))*(1-P) + B(ld(3), ld(4))*P`,
  },
  {
    id: 'fx_swirl', name: 'Swirl', duration: 1,
    // The current clip twists away from the middle; the next one untwists into place.
    expr: `st(0, X-W/2); st(1, Y-H/2); st(2, hypot(ld(0), ld(1))); st(3, atan2(ld(1), ld(0)));
      st(4, 2*PI*max(0, 1-ld(2)/H)); st(5, ld(3)+P*ld(4)); st(6, ld(3)+(1-P)*ld(4));
      A(W/2+ld(2)*cos(ld(5))+0.5, H/2+ld(2)*sin(ld(5))+0.5)*(1-P) + B(W/2+ld(2)*cos(ld(6))+0.5, H/2+ld(2)*sin(ld(6))+0.5)*P`,
  },
  {
    id: 'fx_kaleido', name: 'Kaleidoscope', duration: 1.2,
    // Six mirrored slices around the middle, fading in and out while the clips cross.
    expr: `st(0, hypot(X-W/2, Y-H/2)); st(1, atan2(Y-H/2, X-W/2)+PI); st(2, PI/3);
      st(3, floor(ld(1)/ld(2))); st(4, ld(1)-ld(3)*ld(2)); st(4, if(lt(fract(ld(3)/2), 0.25), ld(2)-ld(4), ld(4)));
      st(5, W/2+ld(0)*cos(ld(4))+0.5); st(6, H/2+ld(0)*sin(ld(4))+0.5); st(7, smooth(0, 1, P)); st(8, (4*P*(1-P)));
      (A(X, Y)*(1-ld(7)) + B(X, Y)*ld(7))*(1-ld(8)) + (A(ld(5), ld(6))*(1-ld(7)) + B(ld(5), ld(6))*ld(7))*ld(8)`,
  },
  {
    id: 'fx_dreamy', name: 'Dreamy', duration: 1.2,
    // A soft glow with a violet tint at the middle of the cross.
    expr: `st(0, (4*P*(1-P))); st(1, 4*H/720);
      st(2, A(X, Y)*(1-ld(0)) + (${box9('A', 'ld(1)')})/9*ld(0)); st(3, B(X, Y)*(1-ld(0)) + (${box9('B', 'ld(1)')})/9*ld(0));
      ld(2)*(1-P) + ld(3)*P + C(26, 13, 38)*ld(0)`,
  },
  {
    id: 'fx_pagecurl', name: 'Page Curl', duration: 1,
    // The page lifts from the right with a shadow on its edge and uncovers the next one.
    expr: `st(0, 1.3-P*1.7); st(1, X/W); st(2, smooth(ld(0)-0.3, ld(0)+0.1, ld(1)));
      st(3, smooth(ld(0), ld(0)+0.2, ld(1))*(1-smooth(ld(0)+0.2, ld(0)+0.4, ld(1))));
      A(X, Y)*(1-ld(3)*0.6)*(1-ld(2)) + B(X, Y)*ld(2)`,
  },
  {
    id: 'fx_warp', name: 'Directional Warp', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*0.1*W*sin(Y/H*10)); A(X+ld(0), Y)*(1-P) + B(X-ld(0), Y)*P`,
  },
  {
    id: 'fx_tiles', name: 'Mosaic Tiles', duration: 1,
    // The frame splits into tiles (largest mid-way, single pixels at both ends) that flip one by one to the next clip.
    expr: `st(0, max(1, H*0.08*(4*P*(1-P)))); st(1, floor(X/ld(0))); st(2, floor(Y/ld(0)));
      st(3, ld(1)*ld(0)+ld(0)/2); st(4, ld(2)*ld(0)+ld(0)/2);
      if(lt(hash(ld(1)*12.9898+ld(2)*78.233), P), B(ld(3), ld(4)), A(ld(3), ld(4)))`,
  },
  {
    id: 'fx_radialblur', name: 'Radial Blur', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*2); (${radial10('A', 'ld(0)')})/10*(1-P) + (${radial10('B', 'ld(0)')})/10*P`,
  },
  {
    id: 'fx_crosshatch', name: 'Crosshatch', duration: 1,
    // Diagonal stripes reveal the next clip, getting finer until it fills the frame.
    expr: `st(0, 5+45*P); st(1, (X*0.7071-Y*0.7071)/100*ld(0)); st(2, gte(fract(ld(1)), 0.5));
      st(3, min(1, ld(2)*smooth(0, 0.6, P) + smooth(0.5, 1, P)));
      A(X, Y)*(1-ld(3)) + B(X, Y)*ld(3)`,
  },
];

// ---- Transition packs: five packs of real engine transitions (Seamless, Mask & Reveal, Light & Glow,
// Distortion, Cinematic). Every one is written in the same expression language as the studio set, so the
// WebGL preview and the export render the identical motion. Each starts exactly on A and ends exactly
// on B: every blur / warp / shake amount is multiplied by a bell (4P(1-P) or sin(PI*P)) that is 0 at
// both ends, and every travel covers exactly one frame width / height at P = 1.
export const PACK_TRANSITIONS = [
  // -- Seamless: fast travel with blur coupled to the travel speed.
  {
    id: 'fx_whipleft', name: 'Whip Pan Left', duration: 0.5, pack: 'seamless',
    // Both clips race left; the 9-tap horizontal blur grows with the bell of speed, so mid-travel frames smear.
    expr: `st(0, W*P); st(1, (4*P*(1-P))*16*H/720);
      if(lt(X, W-ld(0)), ${hblurAt('A', 'ld(0)', 'ld(1)')}, ${hblurAt('B', 'ld(0)-W', 'ld(1)')})`,
  },
  {
    id: 'fx_whipright', name: 'Whip Pan Right', duration: 0.5, pack: 'seamless',
    expr: `st(0, W*P); st(1, (4*P*(1-P))*16*H/720);
      if(gte(X, ld(0)), ${hblurAt('A', '-ld(0)', 'ld(1)')}, ${hblurAt('B', 'W-ld(0)', 'ld(1)')})`,
  },
  {
    id: 'fx_whipup', name: 'Whip Pan Up', duration: 0.5, pack: 'seamless',
    expr: `st(0, H*P); st(1, (4*P*(1-P))*16*H/720);
      if(lt(Y, H-ld(0)), ${vblurAt('A', 'ld(0)', 'ld(1)')}, ${vblurAt('B', 'ld(0)-H', 'ld(1)')})`,
  },
  {
    id: 'fx_whipdown', name: 'Whip Pan Down', duration: 0.5, pack: 'seamless',
    expr: `st(0, H*P); st(1, (4*P*(1-P))*16*H/720);
      if(gte(Y, ld(0)), ${vblurAt('A', '-ld(0)', 'ld(1)')}, ${vblurAt('B', 'H-ld(0)', 'ld(1)')})`,
  },
  {
    id: 'fx_zoomblur', name: 'Zoom Blur', duration: 0.7, pack: 'seamless',
    // A punches in while its rays streak; B falls back from the same zoom, streaks fading as it lands.
    expr: `${zoomBlur('A', '1+0.9*P', '0.3*P')}*(1-P) + ${zoomBlur('B', '1+0.9*(1-P)', '0.3*(1-P)')}*P`,
  },
  {
    id: 'fx_spinblur', name: 'Spin Blur', duration: 0.8, pack: 'seamless',
    // A spins away, B counter-spins in; both are blurred along the rotation arc, most at mid-turn.
    expr: `${spinBlur('A', '-0.9*P', '0.55*P')}*(1-P) + ${spinBlur('B', '0.9*(1-P)', '0.55*(1-P)')}*P`,
  },
  {
    id: 'fx_warppush', name: 'Warp Push', duration: 0.6, pack: 'seamless',
    // A push left whose seam ripples: the travel coordinate itself is bent by a sine of Y, strongest mid-way.
    expr: `st(0, W*P); st(1, (4*P*(1-P))*0.06*W*sin(Y/H*PI*3)); st(2, X+ld(0)+ld(1));
      if(lt(ld(2), W), A(ld(2), Y), B(ld(2)-W, Y))`,
  },
  {
    id: 'fx_warpsmoothl', name: 'Smooth Warp Left', duration: 0.7, pack: 'seamless',
    // An eased push left with a gentle lens bulge across the frame that swells and settles.
    expr: `st(0, smooth(0, 1, P)); st(1, X+W*ld(0)+(4*P*(1-P))*0.07*W*sin(PI*X/W));
      if(lt(ld(1), W), A(ld(1), Y), B(ld(1)-W, Y))`,
  },
  {
    id: 'fx_warpsmoothr', name: 'Smooth Warp Right', duration: 0.7, pack: 'seamless',
    expr: `st(0, smooth(0, 1, P)); st(1, X-W*ld(0)+(4*P*(1-P))*0.07*W*sin(PI*X/W));
      if(gte(ld(1), 0), A(ld(1), Y), B(ld(1)+W, Y))`,
  },
  // -- Mask & Reveal: shaped reveals.
  {
    id: 'fx_blinds', name: 'Venetian Blinds', duration: 0.8, pack: 'reveal',
    // Eight horizontal slats; each slat's opening grows top-down, later slats a touch behind the first.
    expr: `st(0, H/8); st(1, floor(Y/ld(0))); st(2, clip(P*1.18-ld(1)*0.02, 0, 1));
      if(lt(fract(Y/ld(0)), ld(2)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_gridreveal', name: 'Grid Reveal', duration: 0.9, pack: 'reveal',
    // A 6x4 grid; every cell opens from its own centre at its own hashed moment, so the reveal ripples cell by cell.
    expr: `st(0, floor(X/(W/6))); st(1, floor(Y/(H/4)));
      st(2, (X-ld(0)*(W/6))/(W/6)); st(3, (Y-ld(1)*(H/4))/(H/4));
      st(4, clip(P*1.7-hash(ld(0)*7.13+ld(1)*3.71)*0.7, 0, 1));
      if(lt(max(abs(ld(2)-0.5), abs(ld(3)-0.5)), ld(4)*0.56), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_barndoors', name: 'Barn Doors', duration: 0.8, pack: 'reveal',
    // The two halves of A slide out to the sides like doors, uncovering B already in place behind them.
    expr: `st(0, W*0.5*(1-P)); st(1, W*0.5*P);
      if(lt(X, ld(0)), A(X+ld(1), Y), if(gt(X, W-ld(0)), A(X-ld(1), Y), B(X, Y)))`,
  },
  {
    id: 'fx_chevron', name: 'Chevron Wipe', duration: 0.7, pack: 'reveal',
    // An arrowhead boundary sweeps left to right, its tip at mid-height.
    expr: `st(0, W*(1.6*P-0.3)-abs(Y-H/2)/H*W*0.5);
      if(lt(X, ld(0)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_irisout', name: 'Circle Reveal Out', duration: 0.8, pack: 'reveal',
    // A true iris: B opens as a soft-edged circle from the centre over A.
    expr: `st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));
      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))`,
  },
  {
    id: 'fx_irisin', name: 'Circle Reveal In', duration: 0.8, pack: 'reveal',
    // The reverse iris: A shrinks away as a closing circle into the centre, B around it.
    expr: `st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth((1-P)*1.05-0.04, (1-P)*1.05, ld(0)));
      A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_diamondreveal', name: 'Diamond Reveal', duration: 0.9, pack: 'reveal',
    // A diamond grows from the centre while rotating into its final orientation, B inside it.
    expr: `st(0, (X-W/2)/H); st(1, (Y-H/2)/H); st(2, (1-P)*0.6);
      st(3, ld(0)*cos(ld(2))+ld(1)*sin(ld(2))); st(4, -ld(0)*sin(ld(2))+ld(1)*cos(ld(2)));
      st(5, (abs(ld(3))+abs(ld(4)))*H/(0.78*hypot(W, H)));
      st(6, smooth(P*1.06-0.05, P*1.06-0.01, ld(5)));
      A(X, Y)*ld(6) + B(X, Y)*(1-ld(6))`,
  },
  {
    id: 'fx_rects', name: 'Rectangles', duration: 0.8, pack: 'reveal',
    // A 6x4 grid of rectangular blocks sweeps across (left first, top rows a touch ahead); as each
    // block flips to B its reveal edge flashes one of two colors — warm or cyan by block parity.
    expr: `st(0, W/6); st(1, H/4); st(2, floor(X/ld(0))); st(3, floor(Y/ld(1)));
      st(4, clip((P-(ld(2)+ld(3)*0.35)/6.05*0.8)/0.2, 0, 1));
      st(5, fract(X/ld(0))); st(6, fract((ld(2)+ld(3))/2)*2);
      if(lt(ld(5), ld(4)),
        if(lt(ld(4)-ld(5), 0.18),
          if(lt(ld(4), 1), B(X, Y)*0.15 + if(lt(ld(6), 0.5), C(255, 210, 90), C(90, 200, 255))*0.85, B(X, Y)),
          B(X, Y)),
        A(X, Y))`,
  },
  {
    id: 'fx_circlecorner', name: 'Circles From Corner', duration: 0.8, pack: 'reveal',
    // An iris anchored at the top-left corner instead of the centre: B opens as a soft-edged
    // circle from the corner across A.
    expr: `st(0, hypot(X, Y)/(hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));
      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))`,
  },
  {
    id: 'fx_diagstripes', name: 'Diagonal Stripes', duration: 0.8, pack: 'reveal',
    // Seven diagonal bands sweep across in sequence; inside each band B wipes in along the diagonal.
    expr: `st(0, (X*0.7071+Y*0.7071)/(0.7071*(W+H))); st(1, floor(ld(0)*7)); st(2, fract(ld(0)*7));
      st(3, clip((P-ld(1)/7*0.65)/0.35, 0, 1));
      if(lt(ld(2), ld(3)), B(X, Y), A(X, Y))`,
  },
  // -- Light & Glow.
  {
    id: 'fx_glowdissolve', name: 'Glow Dissolve', duration: 1, pack: 'glowpack',
    // Both clips soften into a box blur and lift in brightness as they cross, with a warm glow at the peak.
    expr: `st(0, 4*P*(1-P)); st(1, 4*H/720);
      st(2, A(X, Y)*(1-ld(0)) + (${box9('A', 'ld(1)')}/9)*ld(0));
      st(3, B(X, Y)*(1-ld(0)) + (${box9('B', 'ld(1)')}/9)*ld(0));
      (ld(2)*(1-P) + ld(3)*P)*(1+0.3*ld(0)) + C(255, 244, 230)*ld(0)*0.15`,
  },
  {
    id: 'fx_flaresweep', name: 'Lens Flare Sweep', duration: 1.1, pack: 'glowpack',
    // A flare ball with an anamorphic streak and a ghost orb crosses the frame; the clips cross under its peak.
    expr: `st(0, 4*P*(1-P)); st(1, smooth(0.34, 0.66, P));
      st(2, A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1));
      st(3, W*(-0.25+1.5*P));
      st(4, exp(-pow((X-ld(3))/(W*0.16), 2))*exp(-pow((Y-H*0.42)/(H*0.3), 2)));
      st(5, exp(-pow((Y-H*0.42)/(H*0.035), 2)));
      st(6, exp(-pow((X-(W-ld(3)*0.55))/(W*0.05), 2))*exp(-pow((Y-H*0.58)/(H*0.09), 2)));
      st(7, min(1, (ld(4)*1.1+ld(5)*0.4+ld(6)*0.5)*ld(0)));
      ld(2)*(1-ld(7)) + C(255, 240, 214)*ld(7)`,
  },
  {
    id: 'fx_lightburn', name: 'Light Burn', duration: 0.9, pack: 'glowpack',
    // A overexposes hotter and hotter (a warm tint rides the exposure) until B fades in out of the blow-out.
    expr: `st(0, smooth(0, 0.5, P)); st(1, smooth(0.45, 0.7, P));
      st(2, A(X, Y)*(1+2.4*ld(0)) + C(255, 196, 130)*ld(0)*0.35);
      ld(2)*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_flashframe', name: 'Flash Frame', duration: 0.6, pack: 'glowpack',
    // Strobe flashes (white frames pulsing around the cut) hide a hard cut at the middle.
    expr: `st(0, 4*P*(1-P)); st(1, ld(0)*pow(0.5+0.5*sin(P*44), 3));
      st(2, if(lt(P, 0.5), A(X, Y), B(X, Y)));
      ld(2)*(1-ld(1)) + C(255, 250, 238)*ld(1)`,
  },
  {
    id: 'fx_prismleak', name: 'Prism Leak', duration: 1, pack: 'glowpack',
    // A diagonal light front crosses; at the front the channels split apart (red one way, blue the other,
    // per-channel offsets via C()) and a pink / blue wash leaks in, then everything settles onto B.
    expr: `st(0, 4*P*(1-P)); st(1, (X/W+Y/H)*0.7); st(2, -0.3+1.9*P);
      st(3, ld(0)*exp(-pow(ld(1)-ld(2), 2)/0.03));
      st(4, ld(3)*W*0.045);
      st(5, smooth(0.3, 0.7, P));
      st(6, A(X+ld(4)*C(1, 0, -1), Y+ld(4)*C(1, 0, -1)*0.6)*(1-ld(5)) + B(X+ld(4)*C(1, 0, -1), Y+ld(4)*C(1, 0, -1)*0.6)*ld(5));
      ld(6) + C(255, 130, 190)*ld(3)*0.12 + C(120, 200, 255)*ld(3)*0.08`,
  },
  // -- Distortion.
  {
    id: 'fx_ripplewave', name: 'Ripple Wave', duration: 0.9, pack: 'distortion',
    // Travelling waves on both axes bend both clips as they cross (the warp peaks mid-way, flat at the ends).
    expr: `st(0, (4*P*(1-P))*0.035*H);
      st(1, sin(Y/H*22-P*12.56)*ld(0)); st(2, cos(X/W*16-P*9.42)*ld(0)*0.7);
      st(3, smooth(0, 1, P));
      A(X+ld(1), Y+ld(2))*(1-ld(3)) + B(X+ld(1), Y+ld(2))*ld(3)`,
  },
  {
    id: 'fx_impactshake', name: 'Impact Shake', duration: 0.6, pack: 'distortion',
    // A hard cut at the middle lands with an impact: the frame punches in slightly and shakes, decay set by sin(PI*P).
    expr: `st(0, sin(PI*P));
      st(1, (hash(floor(P*26)+3.1)-0.5)*ld(0)*W*0.07);
      st(2, (hash(floor(P*26)+7.7)-0.5)*ld(0)*H*0.07);
      st(3, 1+0.1*ld(0));
      if(lt(P, 0.5), A(W/2+(X-W/2)/ld(3)+ld(1), H/2+(Y-H/2)/ld(3)+ld(2)), B(W/2+(X-W/2)/ld(3)+ld(1), H/2+(Y-H/2)/ld(3)+ld(2)))`,
  },
  {
    id: 'fx_rgbslidel', name: 'RGB Split Slide Left', duration: 0.6, pack: 'distortion',
    // A slide left where the channels travel on staggered clocks (per-channel progress via C()), so the
    // seam fringes red / green / blue before the channels land together on B.
    expr: `st(0, C(0, 0.05, 0.1)); st(1, clip((P-ld(0))/0.9, 0, 1)); st(2, X+W*ld(1));
      if(lt(ld(2), W), A(ld(2), Y), B(ld(2)-W, Y))`,
  },
  {
    id: 'fx_rgbslider', name: 'RGB Split Slide Right', duration: 0.6, pack: 'distortion',
    expr: `st(0, C(0, 0.05, 0.1)); st(1, clip((P-ld(0))/0.9, 0, 1)); st(2, X-W*ld(1));
      if(gte(ld(2), 0), A(ld(2), Y), B(ld(2)+W, Y))`,
  },
  {
    id: 'fx_pixelstretch', name: 'Pixel Stretch', duration: 0.7, pack: 'distortion',
    // Thin row bands drag sideways by hashed amounts (a pixel-stretch smear; a true pixel sort needs a
    // per-row accumulation a per-pixel expression cannot do, so this is the honest streak version).
    expr: `st(0, 4*P*(1-P)); st(1, floor(Y/(H*0.045)));
      st(2, ld(0)*(hash(ld(1)*3.77)-0.35)*W*0.22);
      st(3, smooth(0, 1, P));
      A(X-ld(2), Y)*(1-ld(3)) + B(X-ld(2), Y)*ld(3)`,
  },
  {
    id: 'fx_stretchwarp', name: 'Stretch Warp', duration: 0.7, pack: 'distortion',
    // The frame stretches wide (and squeezes a little vertically) at mid-transition while the clips cross.
    expr: `st(0, 4*P*(1-P)); st(1, 1+1.6*ld(0));
      st(2, W/2+(X-W/2)/ld(1)); st(3, H/2+(Y-H/2)*(1+0.25*ld(0)));
      st(4, smooth(0, 1, P));
      A(ld(2), ld(3))*(1-ld(4)) + B(ld(2), ld(3))*ld(4)`,
  },
  // -- Cinematic.
  {
    id: 'fx_filmroll', name: 'Film Roll', duration: 0.9, pack: 'cinematic',
    // The strip rolls up like film through a gate: a dark seam bar, a whisper of gate jitter and flicker.
    expr: `st(0, 4*P*(1-P)); st(1, H*(1-P));
      st(2, (hash(floor(P*22)+1.3)-0.5)*ld(0)*H*0.012);
      st(3, if(gte(Y+ld(2), ld(1)), B(X, Y+ld(2)-ld(1)), A(X, Y+ld(2))));
      st(4, ld(3)*(1-0.22*ld(0)*hash(floor(P*22)+4.9)));
      st(5, exp(-pow((Y-ld(1))/(H*0.018), 2))*ld(0));
      ld(4)*(1-ld(5)) + 10*ld(5)`,
  },
  {
    id: 'fx_projector', name: 'Projector Flicker Cut', duration: 0.8, pack: 'cinematic',
    // An old projector cut: brightness flicker, small frame jumps and a warm tint, all dying out after the cut.
    expr: `st(0, 4*P*(1-P));
      st(1, (hash(floor(P*30)+2.2)-0.5)*ld(0)*H*0.02);
      st(2, if(lt(P, 0.5), A(X, Y+ld(1)), B(X, Y+ld(1))));
      ld(2)*(1-0.3*ld(0)*(0.5+0.5*sin(P*46))) + C(255, 214, 150)*0.06*ld(0)`,
  },
  {
    id: 'fx_letterbox', name: 'Letterbox Close / Open', duration: 0.9, pack: 'cinematic',
    // Black bars close to a slit at the middle (where the cut hides) and open again on the next clip.
    expr: `st(0, sin(PI*P)*H*0.44);
      if(lt(Y, ld(0)), 0, if(gt(Y, H-ld(0)), 0, if(lt(P, 0.5), A(X, Y), B(X, Y))))`,
  },
  {
    id: 'fx_dipcolor', name: 'Dip to Color', duration: 0.8, pack: 'cinematic',
    // A dips into a deep violet and B rises out of it (a coloured dip, where fadeblack dips to black).
    expr: `st(0, smooth(0.02, 0.5, P)); st(1, smooth(0.5, 0.98, P));
      (A(X, Y)*(1-ld(0)) + C(56, 24, 120)*ld(0))*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_freezepush', name: 'Freeze Frame Push', duration: 0.9, pack: 'cinematic',
    // A becomes a bordered still card that shrinks and is pushed off to the left, uncovering B in place.
    expr: `st(0, smooth(0, 1, P)); st(1, 1-0.5*ld(0)); st(2, W/2-W*ld(0));
      st(3, H*0.012*ld(0));
      st(4, ${inRound('ld(2)', 'H/2', 'W/2*ld(1)', 'H/2*ld(1)', 'H*0.03*ld(0)+0.001')});
      st(5, ${inRound('ld(2)', 'H/2', 'W/2*ld(1)-ld(3)', 'H/2*ld(1)-ld(3)', 'H*0.02*ld(0)+0.001')});
      if(ld(5), A(W/2+(X-ld(2))/ld(1), H/2+(Y-H/2)/ld(1)), if(ld(4), 245, B(X, Y)))`,
  },
];

export const FX_TRANSITIONS = [
  {
    id: 'fx_mosaic', name: 'Mosaic Wipe', duration: 1,
    // Blocks grow towards the middle of the transition while a ragged edge sweeps left to right.
    expr: `st(0, max(1, floor(H*0.07*sin(PI*P))));
      st(1, floor(X/ld(0))*ld(0)+ld(0)/2);
      st(2, floor(Y/ld(0))*ld(0)+ld(0)/2);
      st(3, W*(-0.25+1.5*P)+(hash(floor(Y/ld(0))+0.5)-0.5)*W*0.35);
      if(lt(ld(1), ld(3)), B(ld(1), ld(2)), A(ld(1), ld(2)))`,
  },
  {
    id: 'fx_snapback', name: 'Snap Back', duration: 0.8,
    // The outgoing clip punches in, the incoming one snaps back from the same zoom.
    expr: `st(0, smooth(0, 0.55, P)); st(1, 1-smooth(0.45, 1, P));
      st(2, 1+1.6*ld(0)*ld(0)); st(3, 1+1.6*ld(1)*ld(1));
      st(4, smooth(0.44, 0.56, P));
      A(W/2+(X-W/2)/ld(2), H/2+(Y-H/2)/ld(2))*(1-ld(4)) + B(W/2+(X-W/2)/ld(3), H/2+(Y-H/2)/ld(3))*ld(4)`,
  },
  {
    id: 'fx_flare', name: 'Flare Wipe', duration: 1.2,
    // A warm lens flare sweeps across and washes the picture out while the clips cross.
    expr: `st(0, smooth(0, 0.5, P)*(1-smooth(0.5, 1, P)));
      st(1, smooth(0.38, 0.62, P));
      st(2, A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1));
      st(3, hypot((X-W*(-0.3+1.6*P))/W, (Y-H*0.38)/H*0.7));
      st(4, min(1, ld(0)*(1.3*exp(-ld(3)*ld(3)*9)+0.45)));
      ld(2) + (C(255, 236, 205)-ld(2))*ld(4)`,
  },
  {
    id: 'fx_comic', name: 'Comic Cut', duration: 0.8,
    // A torn diagonal cut with halftone dots along the tear reveals the next clip.
    expr: `st(0, W*(1.5*P-0.25) + (Y-H/2)*0.35 + (abs(fract(Y/(H*0.07))-0.5)-0.25)*W*0.06);
      st(1, W*0.05*sin(PI*P));
      st(2, X-ld(0));
      st(3, lt(hypot(fract(X/(W*0.014))-0.5, fract(Y/(W*0.014))-0.5), 0.32));
      if(lt(ld(2), -ld(1)), B(X, Y), if(gt(ld(2), ld(1)), A(X, Y), if(ld(3), 25, 245)))`,
  },
  {
    id: 'fx_brush', name: 'Brush Cuts', duration: 1.2,
    // Diagonal brush strokes paint the next clip in, one after another, with ragged ends.
    expr: `st(0, (X*0.8+Y*0.6)/W);
      st(1, floor(((Y*0.8-X*0.6)/H+1.2)*3.2));
      st(2, P*2.1-hash(ld(1)*1.7)*0.8-0.1);
      st(3, (hash(floor(ld(0)*55)+ld(1)*13.1)-0.5)*0.06 + (hash(floor((Y*0.8-X*0.6)/H*90))-0.5)*0.05);
      if(lt(ld(0)+ld(3), ld(2)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_phone', name: 'Phone Reveal', duration: 1.6,
    // A phone rises with the next clip on its screen, then zooms until the screen fills the frame.
    expr: `st(0, smooth(0, 0.5, P)); st(1, smooth(0.55, 1, P));
      st(2, H*0.42+(H*0.08+1)*ld(1)); st(3, H*0.2016+(W*0.5+1-H*0.2016)*ld(1));
      st(4, H*1.6-H*1.1*ld(0)); st(5, H*0.03*(1-ld(1)));
      st(6, ${inRound('W/2', 'ld(4)', 'ld(3)', 'ld(2)', 'H*0.06*(1-ld(1))+0.001')});
      st(7, ${inRound('W/2', 'ld(4)', 'ld(3)-ld(5)', 'ld(2)-ld(5)', 'H*0.05*(1-ld(1))+0.001')});
      st(8, max(2*(ld(3)-ld(5)-ld(1))/W, 2*(ld(2)-ld(5)-ld(1))/H));
      if(ld(7), B(W/2+(X-W/2)/ld(8), H/2+(Y-ld(4))/ld(8)), if(ld(6), C(18, 18, 22), A(X, Y)))`,
  },
  {
    id: 'fx_swipe', name: 'Finger Swipe', duration: 1.6,
    // The clip shrinks into a card, a finger swipes it away and the next card slides in and opens up.
    expr: `st(0, 1-0.38*smooth(0, 0.3, P)); st(1, -W*1.05*smooth(0.32, 0.68, P));
      st(2, 0.62+0.38*smooth(0.72, 1, P)); st(3, W*1.05*(1-smooth(0.32, 0.68, P)));
      st(4, ${inRound('W/2+ld(3)', 'H/2', 'W/2*ld(2)+1', 'H/2*ld(2)+1', 'H*0.07*(1-smooth(0.72, 1, P))+0.001')});
      st(5, ${inRound('W/2+ld(1)', 'H/2', 'W/2*ld(0)+1', 'H/2*ld(0)+1', 'H*0.07*smooth(0, 0.3, P)+0.001')});
      st(6, lt(hypot(X-(W/2+ld(3)+W*0.2*ld(2)), Y-H*0.7), H*0.055)*between(P, 0.28, 0.74));
      if(ld(6), C(238, 192, 160), if(ld(4), B(W/2+(X-W/2-ld(3))/ld(2), H/2+(Y-H/2)/ld(2)), if(ld(5), A(W/2+(X-W/2-ld(1))/ld(0), H/2+(Y-H/2)/ld(0)), 236)))`,
  },
  // The five transition packs (Seamless / Mask & Reveal / Light & Glow / Distortion / Cinematic).
  ...PACK_TRANSITIONS,
  // From Transition Studio (above).
  ...STUDIO_TRANSITIONS,
];

// Effects that change the picture itself (geq in the export, canvas pixels in the preview).
export const PIXEL_EFFECTS = [
  {
    id: 'fx_vhs', name: 'VHS Noise', icon: '📼',
    // Colour bleed, scan lines and grain all the time; every couple of seconds a tracking burst bends the lines.
    expr: `st(0, lt(fract(T/2.3), 0.12) + gt(hash(floor(T*5)+0.3), 0.93));
      st(1, (sin(Y/H*34+T*42)*0.014 + (hash(floor(Y/(H*0.025))+floor(T*30)*0.37)-0.5)*0.05)*W*min(ld(0), 1) + sin(Y/H*7+T*3)*W*0.0016);
      st(2, W*(0.0035+0.006*min(ld(0), 1)));
      st(3, S(X+ld(1)+C(ld(2), 0, -ld(2)), Y));
      (ld(3)*(1-0.22*min(ld(0), 1)) + 40*min(ld(0), 1) + C(-6, 0, 12) + (hash(X*0.37+Y*1.31+floor(T*30)*7.1)-0.5)*30)
        * (1-0.12*fract(floor(Y/max(1, H/240))/2)*2)`,
  },
  {
    id: 'fx_striped', name: 'Striped Erosion', icon: '▤',
    // Glitch bursts: horizontal bands tear sideways, with magenta streaks and colour fringes.
    expr: `st(0, gt(hash(floor(T*6)+0.7), 0.55));
      st(1, hash(floor(Y/(H/22))*3.1+floor(T*12)*0.77));
      st(2, if(gt(ld(1), 0.7), (ld(1)-0.85)*W*0.7, 0)*ld(0));
      if(ld(0)*gt(ld(1), 0.955), C(205, 70, 255), S(X+ld(2)+C(W*0.006, 0, -W*0.006)*ld(0), Y))`,
  },
  {
    id: 'fx_bwgrit', name: 'BW Grit', icon: '🎞',
    // Hard black-and-white film: contrast, grain, flicker, frame jitter, scratches and dust.
    expr: `st(0, (hash(floor(T*12)+0.2)-0.5)*W*0.005);
      st(1, (L(X+ld(0), Y)-128)*1.4+128);
      st(1, ld(1)*(0.9+0.1*hash(floor(T*24)+3.3)) + (hash(X*0.71+Y*1.93+floor(T*24)*3.3)-0.5)*44);
      st(2, lt(abs(X-W*hash(floor(T*8)+11.1)), W*0.0016)*gt(hash(floor(T*8)+5.5), 0.35));
      st(3, gt(hash(floor(X/(W*0.005))*7.7+floor(Y/(W*0.005))*3.1+floor(T*12)*1.3), 0.9986));
      if(ld(2), 232, if(ld(3), 18, ld(1)))`,
  },
  {
    id: 'fx_zoomblast', name: 'Zoom Blast', icon: '💥',
    // The clip starts zoomed in and rushes back with a radial blur (first 0.7 s).
    expr: `if(gt(T, 0.7), S(X, Y),
      st(0, 1+2.2*(1-smooth(0, 0.7, T))^2);
      (S(W/2+(X-W/2)/ld(0), H/2+(Y-H/2)/ld(0)) + S(W/2+(X-W/2)/(ld(0)*1.05), H/2+(Y-H/2)/(ld(0)*1.05))
        + S(W/2+(X-W/2)/(ld(0)*1.1), H/2+(Y-H/2)/(ld(0)*1.1)) + S(W/2+(X-W/2)/(ld(0)*1.15), H/2+(Y-H/2)/(ld(0)*1.15)))/4)`,
  },
  // ---- The expanded library: parameterized families built from the same primitives. Every
  // variant carries its own constants/structure (the sampling suite proves pairwise-distinct
  // frames across the whole library — no tile is a rename of another tile's render).
  ...pixelLibrary(),
];

// Builders for the expanded pixel library (defined below the classic four for readability).
function crossBlur(r) {
  return `st(0, H*${r}); (S(X, Y) + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0)))/5`;
}
function blurN(r) {
  return `st(0, H*${r}); (S(X, Y)*2 + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0))
    + S(X+ld(0), Y+ld(0)) + S(X-ld(0), Y-ld(0)) + S(X+ld(0), Y-ld(0)) + S(X-ld(0), Y+ld(0)))/10`;
}
function leak(fx, fy, cr, cg, cb, inten, ph) {
  return `st(0, clip(1 - hypot(X - W*${fx}, Y - H*${fy})/(H*1.05), 0, 1));
    S(X, Y) + C(${cr}, ${cg}, ${cb}) * ld(0) * ld(0) * ${inten} * (0.8 + 0.2*sin(T*0.6 + ${ph}))`;
}
function kaleido(n) {
  return `st(0, atan2(Y - H/2, X - W/2)); st(1, hypot(X - W/2, Y - H/2)); st(2, 6.28319/${n});
    st(3, ld(2)/2 - abs(mod(ld(0) + 6.28319, ld(2)) - ld(2)/2));
    S(W/2 + ld(1)*cos(ld(3)), H/2 + ld(1)*sin(ld(3)))`;
}
function radialTaps(scales) {
  const taps = scales.map((s) => `S(W/2+(X-W/2)*${s}, H/2+(Y-H/2)*${s})`).join(' + ');
  return `(${taps})/${scales.length}`;
}
function twirl(amt, rad) {
  return `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, ${amt}*max(0, 1 - ld(0)/${rad}));
    st(2, cos(ld(1))); st(3, sin(ld(1)));
    S(W/2 + (X - W/2)*ld(2) - (Y - H/2)*ld(3), H/2 + (X - W/2)*ld(3) + (Y - H/2)*ld(2))`;
}
function pixelLibrary() {
  return [
  // -- Glitch & Digital --
  { id: 'fx_rgb2', name: 'RGB Split Light', icon: '🔀', expr: `S(X + C(W*0.003, 0, -W*0.003), Y)` },
  { id: 'fx_rgb6', name: 'RGB Split Heavy', icon: '🔀', expr: `S(X + C(W*0.009, 0, -W*0.009) + (hash(floor(T*24)+0.5)-0.5)*W*0.002, Y)` },
  { id: 'fx_rgb8', name: 'RGB Split Extreme', icon: '🔀', expr: `S(X + C(W*0.02, 0, -W*0.02) + (hash(floor(Y/(H/9))*1.7+floor(T*18)*0.53)-0.5)*W*0.004, Y)` },
  { id: 'fx_rgbv', name: 'RGB Split Vertical', icon: '🔀', expr: `S(X, Y + C(H*0.006, 0, -H*0.006))` },
  { id: 'fx_slices', name: 'Slice Shift', icon: '🍰', expr: `st(0, hash(floor(Y/(H/14))*3.3+floor(T*8)*0.91)); S(X + if(gt(ld(0), 0.55), (ld(0)-0.55)*W*0.5, 0), Y)` },
  { id: 'fx_slicesbig', name: 'Slice Shift Wide', icon: '🍰', expr: `st(0, hash(floor(Y/(H/6))*5.1+floor(T*5)*0.77)); S(X + if(gt(ld(0), 0.45), (ld(0)-0.5)*W*0.9, 0), Y)` },
  { id: 'fx_mosh', name: 'Datamosh Smear', icon: '🫠', expr: `st(0, hash(floor(X/(W/9))*7.7+floor(T*2)*0.31)); S(X + if(gt(ld(0), 0.62), (ld(0)-0.62)*W*0.55, 0), Y)` },
  { id: 'fx_mosaic60', name: 'Mosaic Fine', icon: '🧩', expr: `st(0, max(2, W/90)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)` },
  { id: 'fx_mosaic24', name: 'Mosaic Medium', icon: '🧩', expr: `st(0, max(2, W/36)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)` },
  { id: 'fx_mosaic10', name: 'Mosaic Chunky', icon: '🧩', expr: `st(0, max(2, W/14)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)` },
  { id: 'fx_poster4', name: 'Posterize 4', icon: '🎛', expr: `floor(S(X, Y)/64)*64 + 32` },
  { id: 'fx_poster6', name: 'Posterize 6', icon: '🎛', expr: `floor(S(X, Y)/43)*43 + 21` },
  { id: 'fx_solar', name: 'Solarize', icon: '☀', expr: `if(gt(S(X, Y), 130), 255 - S(X, Y), S(X, Y))` },
  { id: 'fx_invert', name: 'Negative', icon: '◐', expr: `255 - S(X, Y)` },
  { id: 'fx_bitcut', name: 'Bit Crush', icon: '👾', expr: `floor(S(X, Y)/32)*32*(0.82 + 0.18*fract(Y/2))` },
  { id: 'fx_scanline', name: 'Scanlines', icon: '📺', expr: `S(X, Y) * (1 - 0.38*fract(floor(Y/max(1, H/220))/2)*2)` },
  { id: 'fx_crt', name: 'CRT Grille', icon: '📺', expr: `S(X, Y) * if(lt(fract(X/3), 0.34), C(1.15, 0.62, 0.62), if(lt(fract(X/3), 0.67), C(0.62, 1.15, 0.62), C(0.62, 0.62, 1.15)))` },
  { id: 'fx_vhstrack', name: 'VHS Tracking Band', icon: '📼', expr: `st(0, fract(T*0.14)*1.15 - 0.06); st(1, clip(1 - abs(Y/H - ld(0))/0.09, 0, 1)); S(X + ld(1)*W*0.02*sin(Y*0.4 + T*30), Y) * (1 + ld(1)*0.35) + ld(1)*22` },
  // -- Blur & Focus --
  { id: 'fx_soft1', name: 'Soft Blur', icon: '🌫', expr: crossBlur(0.004) },
  { id: 'fx_soft2', name: 'Dream Blur', icon: '🌫', expr: `${blurN(0.01)} * 1.02 + 4` },
  { id: 'fx_soft3', name: 'Gauze Blur', icon: '🌫', expr: `${blurN(0.02)} * 1.03 + 7` },
  { id: 'fx_mblurh', name: 'Motion Blur H', icon: '💨', expr: `st(0, H*0.009); (S(X - ld(0)*2, Y) + S(X - ld(0), Y) + S(X, Y) + S(X + ld(0), Y) + S(X + ld(0)*2, Y))/5` },
  { id: 'fx_mblurv', name: 'Motion Blur V', icon: '💨', expr: `st(0, H*0.009); (S(X, Y - ld(0)*2) + S(X, Y - ld(0)) + S(X, Y) + S(X, Y + ld(0)) + S(X, Y + ld(0)*2))/5` },
  { id: 'fx_mblurd', name: 'Motion Blur Diagonal', icon: '💨', expr: `st(0, H*0.008); (S(X - ld(0), Y - ld(0)) + S(X - ld(0)/2, Y - ld(0)/2) + S(X, Y) + S(X + ld(0)/2, Y + ld(0)/2) + S(X + ld(0), Y + ld(0)))/5` },
  { id: 'fx_radial1', name: 'Radial Blur', icon: '🌀', expr: radialTaps([1, 0.96, 0.92, 0.88]) },
  { id: 'fx_radial2', name: 'Radial Blur Strong', icon: '🌀', expr: radialTaps([1, 0.94, 0.88, 0.82, 0.76]) },
  { id: 'fx_tilt', name: 'Tilt Shift', icon: '🎯', expr: `st(1, clip(abs(Y - H*0.46)/(H*0.42), 0, 1)); S(X, Y)*(1 - ld(1)) + (${crossBlur(0.008)})*ld(1)` },
  { id: 'fx_tiltwide', name: 'Tilt Shift Wide', icon: '🎯', expr: `st(1, clip(abs(Y - H*0.5)/(H*0.3), 0, 1)); S(X, Y)*(1 - ld(1)) + (${blurN(0.012)})*ld(1)` },
  { id: 'fx_spinblur2', name: 'Spin Blur Soft', icon: '🌀', expr: `(S(W/2 + (X - W/2)*0.99875 - (Y - H/2)*0.04998, H/2 + (X - W/2)*0.04998 + (Y - H/2)*0.99875) + S(X, Y) + S(W/2 + (X - W/2)*0.99875 + (Y - H/2)*0.04998, H/2 - (X - W/2)*0.04998 + (Y - H/2)*0.99875))/3` },
  // -- Distortion & Mirror --
  { id: 'fx_kaleido4', name: 'Kaleidoscope 4', icon: '🔮', expr: kaleido(4) },
  { id: 'fx_kaleido6', name: 'Kaleidoscope 6', icon: '🔮', expr: kaleido(6) },
  { id: 'fx_kaleido8', name: 'Kaleidoscope 8', icon: '🔮', expr: kaleido(8) },
  { id: 'fx_kaleido12', name: 'Kaleidoscope 12', icon: '🔮', expr: kaleido(12) },
  { id: 'fx_mirrorquad', name: 'Mirror Quad', icon: '🪞', expr: `S(W/2 - abs(X - W/2), H/2 - abs(Y - H/2))` },
  { id: 'fx_twirl1', name: 'Twirl', icon: '🌪', expr: twirl(0.9, 1) },
  { id: 'fx_twirl2', name: 'Twirl Strong', icon: '🌪', expr: twirl(2.3, 0.55) },
  { id: 'fx_bulge', name: 'Bulge', icon: '🔍', expr: `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, 1 - 0.4*max(0, 1 - ld(0)*ld(0))); S(W/2 + (X - W/2)*ld(1), H/2 + (Y - H/2)*ld(1))` },
  { id: 'fx_pinch', name: 'Pinch', icon: '🤏', expr: `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, 1 + 0.45*max(0, 1 - ld(0)*ld(0))); S(W/2 + (X - W/2)*ld(1), H/2 + (Y - H/2)*ld(1))` },
  { id: 'fx_squeeze', name: 'Squeeze In', icon: '↔', expr: `S(X*1.18 - W*0.09, Y)` },
  { id: 'fx_stretchx', name: 'Stretch Wide', icon: '↔', expr: `S(X*0.84 + W*0.08, Y)` },
  { id: 'fx_wavewarp', name: 'Wave Warp', icon: '〰', expr: `S(X + sin(Y/H*12.56 + T*2.2)*W*0.008, Y)` },
  { id: 'fx_tunnel', name: 'Tunnel Pulse', icon: '🚇', expr: `st(0, 0.78 + 0.1*sin(T*1.6)); S(W/2 + (X - W/2)*ld(0), H/2 + (Y - H/2)*ld(0))` },
  { id: 'fx_prism', name: 'Prism Fringe', icon: '🌈', expr: `S(W/2 + (X - W/2)*(1 + C(0.025, 0, -0.025)), H/2 + (Y - H/2)*(1 + C(0.025, 0, -0.025)))` },
  // -- Film & Vintage --
  { id: 'fx_grainfine', name: 'Fine Grain', icon: '🎞', expr: `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*16` },
  { id: 'fx_grainheavy', name: 'Heavy Grain', icon: '🎞', expr: `S(X, Y) + (hash(floor(X/3)*1.37 + floor(Y/3)*2.11 + floor(T*18)*7.7) - 0.5)*52` },
  { id: 'fx_sepia', name: 'Sepia', icon: '📜', expr: `L(X, Y)*C(1.08, 0.87, 0.6) + C(16, 9, 2)` },
  { id: 'fx_faded', name: 'Faded Film', icon: '📜', expr: `(S(X, Y)*0.5 + L(X, Y)*0.5)*0.8 + 34` },
  { id: 'fx_bleach', name: 'Bleach Bypass', icon: '📜', expr: `(S(X, Y)*0.45 + L(X, Y)*0.55)*1.3 - 26` },
  { id: 'fx_infrared', name: 'Infrared', icon: '🌡', expr: `L(X, Y)*C(1.15, 0.3, 0.42) + (255 - L(X, Y))*C(0.08, 0.28, 0.55)` },
  { id: 'fx_duotone', name: 'Duotone Blue-Gold', icon: '🎨', expr: `L(X, Y)*C(0.82, 0.68, 0.28) + C(22, 20, 54)` },
  { id: 'fx_halftone', name: 'Halftone', icon: '🗞', expr: `st(0, max(2, W/110)); st(1, hypot(fract(X/ld(0)) - 0.5, fract(Y/ld(0)) - 0.5)); S(X, Y) * (0.3 + 0.7*clip(0.72 - ld(1) + L(X, Y)/255*0.45, 0, 1))` },
  { id: 'fx_scratch', name: 'Scratches & Dust', icon: '🎞', expr: `st(0, W*0.31 + sin(T*0.9)*W*0.012); st(1, W*0.68 + cos(T*0.7)*W*0.014); st(2, lt(abs(X - ld(0)), W*0.0024) + lt(abs(X - ld(1)), W*0.0018)); st(3, gt(hash(floor(X/(W*0.005))*7.7 + floor(Y/(W*0.005))*3.1 + floor(T*11)*1.3), 0.9965)); if(ld(3), 240, S(X, Y) * (1 - 0.4*clip(ld(2), 0, 1)) * (0.965 + 0.055*hash(floor(T*11) + 0.7)) + ld(2)*7)` },
  { id: 'fx_flicker', name: 'Film Flicker', icon: '🎞', expr: `S(X + (hash(floor(T*14) + 0.2) - 0.5)*W*0.004, Y) * (0.9 + 0.16*hash(floor(T*14) + 3.3))` },
  { id: 'fx_oldphoto', name: 'Old Photo', icon: '📜', expr: `(L(X, Y)*C(1.05, 0.85, 0.58) + C(14, 8, 2)) * (0.7 + 0.3*clip(1 - hypot(X - W/2, Y - H/2)/(0.75*hypot(W, H)), 0, 1)) + (hash(X*1.37 + Y*2.11 + floor(T*9)*7.7) - 0.5)*14` },
  { id: 'fx_noir', name: 'Noir Contrast', icon: '🎬', expr: `st(0, (L(X, Y) - 128)*1.65 + 128); (ld(0) - 128)*1.2 + 128` },
  // -- Light & Glow --
  { id: 'fx_leaktl', name: 'Light Leak Top Left', icon: '🌅', expr: leak(0, 0, 255, 150, 60, 0.85, 0) },
  { id: 'fx_leaktr', name: 'Light Leak Top Right', icon: '🌅', expr: leak(1, 0, 255, 160, 70, 0.85, 2.1) },
  { id: 'fx_leakbl', name: 'Light Leak Bottom', icon: '🌅', expr: leak(0.5, 1.15, 255, 110, 40, 0.95, 4.2) },
  { id: 'fx_leakcool', name: 'Light Leak Cool', icon: '🌅', expr: leak(1, 0.3, 90, 160, 255, 0.8, 1.3) },
  { id: 'fx_leakmagenta', name: 'Light Leak Magenta', icon: '🌅', expr: leak(0.15, 1, 255, 70, 190, 0.8, 5.3) },
  { id: 'fx_leakedge', name: 'Edge Burn', icon: '🔥', expr: `st(0, clip((Y/H - 0.55)/0.45, 0, 1)); S(X, Y) + C(255, 120, 30)*ld(0)*ld(0)*0.75*(0.85 + 0.15*sin(T*3.1))` },
  { id: 'fx_bloom1', name: 'Soft Bloom', icon: '✨', expr: `S(X, Y) + (${crossBlur(0.006)})*0.45` },
  { id: 'fx_bloom2', name: 'Glow Bloom', icon: '✨', expr: `S(X, Y)*1.05 + (${blurN(0.014)})*0.7 + 6` },
  { id: 'fx_spotlight', name: 'Spotlight', icon: '🔦', expr: `S(X, Y) * (0.4 + 0.95*clip(1 - hypot(X - W/2, Y - H/2)/(0.62*hypot(W, H)), 0, 1))` },
  { id: 'fx_whitevig', name: 'White Vignette', icon: '🤍', expr: `st(0, smooth(0.3, 0.78, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H)))); S(X, Y)*(1 - ld(0)) + 255*ld(0)` },
  { id: 'fx_washgold', name: 'Golden Wash', icon: '🌇', expr: `S(X, Y)*0.85 + C(96, 58, 8)*(Y/H)` },
  { id: 'fx_washteal', name: 'Teal Wash', icon: '🌊', expr: `S(X, Y)*0.85 + C(6, 62, 66)*(1 - Y/H)` },
  { id: 'fx_glowpulse', name: 'Glow Pulse', icon: '✨', expr: `(S(X, Y) + (${crossBlur(0.005)})*0.3) * (1 + 0.13*sin(T*2.6))` },
  // -- Motion --
  { id: 'fx_shake1', name: 'Camera Shake', icon: '📳', expr: `S(X + sin(T*43)*W*0.004 + sin(T*97)*W*0.0015, Y + cos(T*37)*H*0.005)` },
  { id: 'fx_shake2', name: 'Impact Tremor', icon: '📳', expr: `S(X + sin(T*61)*W*0.011 + sin(T*131)*W*0.003, Y + cos(T*53)*H*0.012)` },
  { id: 'fx_jitter', name: 'Frame Jitter', icon: '📳', expr: `st(0, hash(floor(T*12) + 0.4)); st(1, hash(floor(T*12) + 8.4)); S(X + (ld(0) - 0.5)*W*0.012, Y + (ld(1) - 0.5)*H*0.012)` },
  { id: 'fx_drift', name: 'Handheld Drift', icon: '📳', expr: `S(X + sin(T*0.45)*W*0.02 + sin(T*1.3)*W*0.004, Y + cos(T*0.38)*H*0.018)` },
  { id: 'fx_pulsezoom', name: 'Pulse Zoom', icon: '💓', expr: `st(0, 1 + 0.07*sin(T*2.2)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))` },
  { id: 'fx_breathe', name: 'Breathing', icon: '💓', expr: `st(0, 1 + 0.022*sin(T*0.9)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))*1.03` },
  { id: 'fx_strobe', name: 'Strobe', icon: '⚡', expr: `S(X, Y) * if(gt(sin(T*22), 0.1), 1.12, 0.45)` },
  { id: 'fx_spinslow', name: 'Slow Sway', icon: '💓', expr: `st(0, sin(T*0.7)*0.045); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + (X - W/2)*ld(1) + (Y - H/2)*ld(2), H/2 - (X - W/2)*ld(2) + (Y - H/2)*ld(1))` },
  { id: 'fx_zoomslow', name: 'Slow Zoom', icon: '💓', expr: `st(0, 1 + 0.3*smooth(0, 6, T)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))` },
  ];
}

// ---- Effects drawn on top of the clip (canvas; the export renders them with the text layer). ----
const rnd = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

function drawSnow(ctx, W, H, t, count = 170, wind = 0.06) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const depth = 0.35 + rnd(i * 3.7) * 0.65; // nearer flakes are bigger, faster and blurrier
    const speed = (0.18 + 0.35 * depth) * H;
    const y = ((rnd(i * 1.3) * H + t * speed) % (H * 1.1)) - H * 0.05;
    const x = ((rnd(i * 7.1) * W + t * W * wind * depth + Math.sin(t * 1.7 + i) * W * 0.01) % (W * 1.05)) - W * 0.02;
    const r = Math.max(1, H * 0.0035 * depth);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.55 * depth})`;
    ctx.lineWidth = r;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - W * 0.004 * depth, y - speed * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}

function star(ctx, x, y, s, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.15, `rgba(225,240,255,${a * 0.8})`);
  g.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
  ctx.lineWidth = Math.max(1, s * 0.05);
  for (const [dx, dy, k] of [[1, 0, 2.2], [0, 1, 2.2], [0.7, 0.7, 1], [0.7, -0.7, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x - dx * s * k, y - dy * s * k);
    ctx.lineTo(x + dx * s * k, y + dy * s * k);
    ctx.stroke();
  }
}

function drawLimelight(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const period = 1.6 + rnd(i * 2.3) * 1.8;
    const phase = ((t + rnd(i * 5.1) * period) % period) / period;
    const a = Math.sin(Math.PI * phase) ** 2;
    if (a < 0.02) continue;
    const x = W * rnd(i * 9.7 + Math.floor((t + rnd(i * 5.1) * period) / period) * 0.37);
    const y = H * rnd(i * 4.4 + Math.floor((t + rnd(i * 5.1) * period) / period) * 0.91) * 0.85;
    star(ctx, x, y, H * (0.012 + 0.03 * rnd(i * 1.9)) * (0.6 + 0.4 * a), a);
  }
  ctx.restore();
}

function drawFire(ctx, W, H, t, heat = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createLinearGradient(0, H, 0, H * 0.55);
  glow.addColorStop(0, `rgba(255,110,20,${0.55 * heat})`);
  glow.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  for (let i = 0; i < 260; i++) {
    const life = 0.7 + rnd(i * 2.9) * 0.8;
    const age = ((t + rnd(i * 6.1) * life) % life) / life; // 0 just born .. 1 gone
    const x = W * rnd(i * 3.3) + Math.sin(t * 3 + i) * W * 0.01 * age;
    const y = H * (1.02 - age * (0.22 + 0.25 * rnd(i * 8.8)) * heat);
    const r = H * (0.05 + 0.05 * rnd(i * 1.1)) * (1 - age * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = (1 - age) * 0.5;
    g.addColorStop(0, `rgba(255,${200 - age * 120},${60 - age * 50},${a})`);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBurning(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const f = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 5.3 + 1);
  for (const [cx, cy, r] of [[0, H, H * 0.9], [W, H * 0.9, H * 0.8], [W * 0.5, H * 1.1, H * 0.7]]) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,150,40,${0.6 * f})`);
    g.addColorStop(0.5, `rgba(255,80,10,${0.25 * f})`);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 60; i++) { // embers
    const life = 1.5 + rnd(i * 4.1) * 1.5;
    const age = ((t + rnd(i * 7.3) * life) % life) / life;
    const x = W * rnd(i * 2.2) + Math.sin(t * 2 + i) * W * 0.03;
    const y = H * (1 - age * 0.9);
    ctx.fillStyle = `rgba(255,${170 + 60 * rnd(i)},80,${(1 - age) * 0.9})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, H * 0.003 * (1 + rnd(i * 9))), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRain(ctx, W, H, t, { n, len, speed, alpha }) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(190, 215, 255, ${alpha})`;
  for (let i = 0; i < n; i++) {
    const depth = 0.4 + rnd(i * 3.1) * 0.6;
    const v = speed * (0.6 + 0.5 * depth) * H;
    const y = ((rnd(i * 1.7) * H + t * v) % (H * 1.15)) - H * 0.08;
    const x = ((rnd(i * 6.3) * W + t * v * 0.18) % (W * 1.1)) - W * 0.05;
    ctx.lineWidth = Math.max(1, H * 0.0016 * depth);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - H * len * 0.18 * depth, y - H * len * depth);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDust(ctx, W, H, t, rgb, n) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const depth = 0.3 + rnd(i * 2.9) * 0.7;
    const x = (rnd(i * 5.7) * W + Math.sin(t * 0.22 * depth + i * 1.7) * W * 0.02 + t * W * 0.008 * depth) % W;
    const y = (rnd(i * 3.9) * H - t * H * 0.012 * depth + H) % H;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + depth) + i * 2.3);
    ctx.fillStyle = `${rgb}${(0.1 + 0.3 * depth) * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.7, H * 0.0028 * depth), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSparkles(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const period = 1.1 + rnd(i * 2.7) * 1.6;
    const phase = ((t + rnd(i * 4.3) * period) % period) / period;
    const a = Math.sin(Math.PI * phase) ** 2;
    if (a < 0.03) continue;
    const cyc = Math.floor((t + rnd(i * 4.3) * period) / period);
    const x = W * rnd(i * 8.9 + cyc * 0.31);
    const y = H * rnd(i * 3.3 + cyc * 0.77);
    const s = H * (0.014 + 0.03 * rnd(i * 1.3)) * (0.5 + 0.5 * a);
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, `rgba(255, 240, 200, ${a})`);
    g.addColorStop(0.25, `rgba(255, 205, 110, ${a * 0.7})`);
    g.addColorStop(1, 'rgba(255, 180, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 235, 190, ${a * 0.85})`;
    ctx.lineWidth = Math.max(1, s * 0.06);
    for (const [dx, dy, k] of [[1, 0, 2], [0, 1, 2], [0.7, 0.7, 0.9], [0.7, -0.7, 0.9]]) {
      ctx.beginPath();
      ctx.moveTo(x - dx * s * k, y - dy * s * k);
      ctx.lineTo(x + dx * s * k, y + dy * s * k);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEmbers(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    const life = 1.6 + rnd(i * 3.7) * 2.2;
    const age = ((t + rnd(i * 6.7) * life) % life) / life;
    const x = W * rnd(i * 2.6) + Math.sin(t * 1.8 + i * 1.3) * W * 0.015;
    const y = H * (1.02 - age * 0.96);
    const a = (1 - age) * (0.35 + 0.55 * rnd(i * 5.1));
    const r = Math.max(0.8, H * 0.0032 * (1 - age * 0.5) * (0.6 + rnd(i * 8.2)));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(255, ${170 + Math.floor(60 * rnd(i * 4.4))}, 70, ${a})`);
    g.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawAsh(ctx, W, H, t) {
  ctx.save();
  for (let i = 0; i < 130; i++) {
    const depth = 0.35 + rnd(i * 3.3) * 0.65;
    const y = ((rnd(i * 1.9) * H + t * H * 0.05 * depth) % (H * 1.08)) - H * 0.04;
    const x = (rnd(i * 6.9) * W + Math.sin(t * 0.9 + i * 2.1) * W * 0.012 * depth) % W;
    const grey = 150 + Math.floor(80 * rnd(i * 7.7));
    ctx.fillStyle = `rgba(${grey}, ${grey}, ${grey + 6}, ${0.25 + 0.4 * depth})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, H * 0.0026 * depth), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFog(ctx, W, H, t) {
  ctx.save();
  for (const [baseY, hgt, spd, alpha, ph] of [[0.78, 0.34, 0.021, 0.16, 0], [0.6, 0.3, -0.013, 0.11, 2.4], [0.9, 0.26, 0.03, 0.13, 4.7]]) {
    const cx = W * (0.5 + 0.5 * Math.sin(t * spd * 6.28 + ph));
    const g = ctx.createRadialGradient(cx, H * baseY, 0, cx, H * baseY, W * 0.55);
    g.addColorStop(0, `rgba(225, 232, 242, ${alpha})`);
    g.addColorStop(1, 'rgba(225, 232, 242, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * (baseY - hgt / 2), W, H * hgt);
  }
  ctx.restore();
}

function drawConfetti(ctx, W, H, t) {
  const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];
  ctx.save();
  for (let i = 0; i < 120; i++) {
    const depth = 0.45 + rnd(i * 2.3) * 0.55;
    const fall = (0.14 + 0.13 * depth) * H;
    const y = ((rnd(i * 1.4) * H + t * fall) % (H * 1.12)) - H * 0.06;
    const x = (rnd(i * 5.3) * W + Math.sin(t * 1.4 + i) * W * 0.014) % W;
    const w = W * 0.008 * depth;
    const h = H * 0.011 * depth;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (1 + rnd(i * 7.9) * 2) + i);
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-w / 2, -h / 2, w, h * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + i * 1.9))));
    ctx.restore();
  }
  ctx.restore();
}

function drawFireflies(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 42; i++) {
    const x = W * (0.5 + 0.42 * Math.sin(t * (0.11 + rnd(i * 3.1) * 0.14) + i * 2.39));
    const y = H * (0.55 + 0.36 * Math.sin(t * (0.09 + rnd(i * 5.7) * 0.12) + i * 4.13));
    const pulse = Math.max(0, Math.sin(t * (0.7 + rnd(i * 7.3)) + i * 1.71)) ** 3;
    if (pulse < 0.04) continue;
    const r = H * 0.016 * (0.6 + rnd(i * 9.1));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(220, 255, 150, ${0.75 * pulse})`);
    g.addColorStop(0.3, `rgba(170, 240, 90, ${0.35 * pulse})`);
    g.addColorStop(1, 'rgba(140, 220, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const OVERLAY_EFFECTS = [
  { id: 'fx_snow', name: 'Snow Storm', icon: '❄', draw: drawSnow },
  { id: 'fx_limelight', name: 'Limelight', icon: '✦', draw: drawLimelight },
  { id: 'fx_fire', name: 'Fire Burn', icon: '🔥', draw: (c, W, H, t) => drawFire(c, W, H, t, 1) },
  { id: 'fx_burning', name: 'Burning Glow', icon: '🌅', draw: drawBurning },
  // -- Weather & particles, parameterized off the same canvas machinery --
  { id: 'fx_snowlight', name: 'Snowfall Light', icon: '🌨', draw: (c, W, H, t) => drawSnow(c, W, H, t, 70, 0.03) },
  { id: 'fx_blizzard', name: 'Blizzard', icon: '🌨', draw: (c, W, H, t) => drawSnow(c, W, H, t, 320, 0.22) },
  { id: 'fx_rain', name: 'Rain', icon: '🌧', draw: (c, W, H, t) => drawRain(c, W, H, t, { n: 130, len: 0.05, speed: 1.15, alpha: 0.34 }) },
  { id: 'fx_downpour', name: 'Downpour', icon: '🌧', draw: (c, W, H, t) => drawRain(c, W, H, t, { n: 330, len: 0.085, speed: 1.7, alpha: 0.46 }) },
  { id: 'fx_dust', name: 'Dust Motes', icon: '✨', draw: (c, W, H, t) => drawDust(c, W, H, t, 'rgba(235,235,245,', 90) },
  { id: 'fx_golddust', name: 'Golden Dust', icon: '✨', draw: (c, W, H, t) => drawDust(c, W, H, t, 'rgba(255,205,120,', 90) },
  { id: 'fx_sparkles', name: 'Sparkles', icon: '✦', draw: drawSparkles },
  { id: 'fx_embers', name: 'Rising Embers', icon: '🔥', draw: drawEmbers },
  { id: 'fx_ash', name: 'Ash Fall', icon: '🌋', draw: drawAsh },
  { id: 'fx_fog', name: 'Fog Banks', icon: '🌫', draw: drawFog },
  { id: 'fx_confetti', name: 'Confetti', icon: '🎉', draw: drawConfetti },
  { id: 'fx_fireflies', name: 'Fireflies', icon: '🪲', draw: drawFireflies },
];

export const isPixelFx = (id) => PIXEL_EFFECTS.some((e) => e.id === id);
export const isOverlayFx = (id) => OVERLAY_EFFECTS.some((e) => e.id === id);
export const fxTransition = (id) => FX_TRANSITIONS.find((t) => t.id === id);
