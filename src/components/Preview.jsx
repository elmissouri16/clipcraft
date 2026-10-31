import React, { useEffect, useRef, useState } from 'react';
import { FIT_VIEW, QUALITY_LABELS, QUALITY_MAX_SIDE, applyZoomChoice, clipLen, formatTime, freeLen, getPlaybackQuality, levelCopyState, previewPath, toFileUrl, videoLayout, zoomByFactor, zoomTransform } from '../store.js';
import { hasMotion, stateAt } from '../anim.js';
import { Check, ChevronLeft, ChevronRight, ChevronUp, Gauge, Maximize, Minimize, Pause, Play, SkipBack, SkipForward, ZoomIn } from 'lucide-react';
import { clipCss, textAnim } from '../effects.js';
import { drawTextLayer } from '../text/render.js';
import { resumeAudioGraph, wireElement } from '../audioTap.js';
import { fontsReady, onFontsChanged } from '../fonts.js';
import { isInternal, readPayload } from '../dnd.js';
import { applyChromaKey, blendOf, chromaOf, decoStyle, layerStyle } from '../visual.js';
import TransformBox from './TransformBox.jsx';
import MediaPeek from './MediaPeek.jsx';
import { fxTransition } from '../fx/catalog.js';
import { easeValue } from '../fx/easing.js';
import { fxGL } from '../fx/gl.js';
import { drawOverlayPasses, pixelPasses } from '../fx/apply.js';
import { anchorCorrection, interpolateTime } from '../playbackClock.js';


// Overlay effects (snow, sparkles, fire...) of every clip on screen at time t, drawn in project pixels.
// The export draws the same function into its text layer frames (src/exportText.js).
export function drawFxOverlays(ctx, project, t, W, H) {
  drawOverlayPasses(ctx, project, t, W, H);
}

// Draws the current picture of a video or image into the slot's canvas with the chroma key and the AI background
// matte (CPU, at most 640 px wide) and the animated effects (WebGL shaders, the same the export uses, up to 1280 px
// wide) applied. matte: the hidden video of the clip's matte (white = keep), or null.
const matteCv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function drawKeyed(cv, src, w, h, chroma, passes = [], matte = null) {
  if (!w || !h) return;
  const cpu = chroma.on || !!matte;
  // CPU work (chroma key, matte) runs at 640 px; otherwise the frame is processed at the playback
  // quality's resolution — a scaled proxy needs no more, Full/High keep the 1280 px ceiling.
  const cap = cpu ? 640 : Math.min(1280, QUALITY_MAX_SIDE[getPlaybackQuality()] || 1280);
  const k = Math.min(1, cap / w);
  const cw = Math.max(2, Math.round(w * k));
  const ch = Math.max(2, Math.round(h * k));
  if (cv.width !== cw || cv.height !== ch) {
    cv.width = cw;
    cv.height = ch;
  }
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(src, 0, 0, cw, ch);
    if (cpu) {
      const frame = ctx.getImageData(0, 0, cw, ch);
      if (chroma.on) applyChromaKey(frame.data, chroma);
      if (matte) {
        if (matteCv.width !== cw || matteCv.height !== ch) {
          matteCv.width = cw;
          matteCv.height = ch;
        }
        const mctx = matteCv.getContext('2d', { willReadFrequently: true });
        mctx.drawImage(matte, 0, 0, cw, ch);
        const a = mctx.getImageData(0, 0, cw, ch).data;
        const d = frame.data;
        for (let i = 3; i < d.length; i += 4) d[i] = (d[i] * a[i - 3]) / 255;
      }
      ctx.putImageData(frame, 0, 0);
    }
    if (passes.length) {
      const out = fxGL().effects(cpu ? cv : src, cw, ch, passes);
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(out, 0, 0);
    }
  } catch {
    // The frame is not decoded yet; the seeked / load handlers draw again.
  }
}

// Playback uses the wall clock as master; media elements are kept in sync with it.
// The main track uses two "slots" (clip index % 2) so that during a transition the outgoing
// and incoming clips are both on screen, mirroring FFmpeg's xfade at export.
const DRIFT = 0.25;

function syncMedia(el, url, localTime, playing, volume, rate = 1) {
  if (el.dataset.src !== url) {
    el.dataset.src = url;
    el.src = url;
  }
  el.volume = Math.max(0, Math.min(1, volume));
  if (el.playbackRate !== rate) el.playbackRate = rate;
  if (el.readyState >= 1 && Math.abs(el.currentTime - localTime) > (playing ? DRIFT * rate : 0.01)) el.currentTime = localTime;
  if (playing && el.paused) el.play().catch(() => {});
  if (!playing && !el.paused) el.pause();
}

// The AI background matte follows its clip's video: the same time when paused; while playing, its speed is nudged
// (not seeked) so the two stay within a frame or two without stutter. Both are in source seconds.
function syncMatte(mv, url, lead, playing, rate) {
  if (mv.dataset.src !== url) {
    mv.dataset.src = url;
    mv.src = url;
  }
  if (mv.readyState < 1 || lead.readyState < 1) return;
  const diff = lead.currentTime - mv.currentTime;
  if (!playing) {
    if (!mv.paused) mv.pause();
    mv.playbackRate = rate;
    if (Math.abs(diff) > 0.01) mv.currentTime = lead.currentTime;
    return;
  }
  if (Math.abs(diff) > 0.3) mv.currentTime = lead.currentTime;
  mv.playbackRate = rate * (1 + Math.max(-0.15, Math.min(0.15, diff * 1.5)));
  if (mv.paused) mv.play().catch(() => {});
}
const usesMatte = (c, m) => !!(c.bgRemove && m && m.type === 'video' && m.matte);

function transitionStyles(type, p) {
  const s = { in: {}, out: {}, flash: null };
  switch (type) {
    case 'fade':
    case 'dissolve': s.in.opacity = p; break;
    case 'fadeblack':
    case 'fadewhite':
      s.in.opacity = p < 0.5 ? 0 : 1;
      s.flash = { color: type === 'fadeblack' ? '#000' : '#fff', opacity: p < 0.5 ? 2 * p : 2 * (1 - p) };
      break;
    case 'wipeleft': s.in.clipPath = `inset(0 0 0 ${(1 - p) * 100}%)`; break;
    case 'wiperight': s.in.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`; break;
    case 'slideleft': s.in.transform = `translateX(${(1 - p) * 100}%)`; s.out.transform = `translateX(${-p * 100}%)`; break;
    case 'slideright': s.in.transform = `translateX(${-(1 - p) * 100}%)`; s.out.transform = `translateX(${p * 100}%)`; break;
    case 'circleopen': s.in.clipPath = `circle(${p * 75}% at 50% 50%)`; break;
    default: s.in.opacity = p;
  }
  return s;
}

export default function Preview({
  project, editProject, selection, onSelect, dispatch, time, seekVer, playing, duration, onTime, onEnd, onTogglePlay, onSeek, onDropItem,
  peek, onClosePeek, onAddPeek, quality = 'full', onQualityChange, clockRef,
}) {
  const [dropOver, setDropOver] = useState(false);
  const slots = [useRef(null), useRef(null)];
  const vids = [useRef(null), useRef(null)];
  const mattes = [useRef(null), useRef(null)]; // hidden videos of the AI background mattes
  const decos = [useRef(null), useRef(null)]; // mask outline / glow above each clip
  const imgs = [useRef(null), useRef(null)];
  const layers = [useRef(null), useRef(null)];
  const keyed = [useRef(null), useRef(null)];
  const lastApply = useRef({ t: 0, playing: false });
  const leadRef = useRef(null); // the main-track video element the playback clock anchors to
  const trCanvas = useRef(null);
  const trBufs = useRef({ a: null, b: null });
  const flashRef = useRef(null);
  const audioEls = useRef({});
  const overlayEls = useRef({}); // clip id -> { slot, layer, v, img, cv }
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);
  // Full screen player (button or F, Esc to leave), like CapCut's: only the video and the transport bar.
  const playerRef = useRef(null);
  const [full, setFull] = useState(false);
  // Level meter tap (item 11): route every sounding element through the shared audio graph,
  // once per element. Runs each commit; the graph guards repeats. Matte/keying videos are muted
  // by design and are not part of the mix, so they are skipped.
  useEffect(() => {
    wireElement(vids[0].current);
    wireElement(vids[1].current);
    for (const o of Object.values(overlayEls.current)) wireElement(o && o.v);
    for (const el of Object.values(audioEls.current)) wireElement(el);
  });
  useEffect(() => { if (playing) resumeAudioGraph(); }, [playing]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else playerRef.current?.requestFullscreen().catch(() => {});
  };
  // Transport menus (playback quality, zoom): at most one open; closes on outside click / Escape.
  const [menu, setMenu] = useState(null); // 'quality' | 'zoom' | null
  useEffect(() => {
    if (!menu) return;
    const down = (e) => { if (!e.target.closest('.transport-menu-wrap')) setMenu(null); };
    const key = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [menu]);
  // Player view zoom: session-only view state (never saved, never touches clips or export).
  const wrapRef = useRef(null);
  const [view, setView] = useState(FIT_VIEW);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      setView((v) => zoomByFactor(v, factor, stageRef.current?.clientWidth, stageRef.current?.clientHeight));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // Dragging empty stage area pans a zoomed view. Drags starting on the transform layer or any
  // control keep their own behaviour (the transform layer handles clip dragging itself).
  const onStageMouseDown = (e) => {
    if (e.button !== 0 || view.fit || e.target.closest('.tbox-layer, button, input, select, textarea, a')) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = view;
    const move = (ev) => setView((v) => {
      const w = stageRef.current?.clientWidth;
      const h = stageRef.current?.clientHeight;
      const mx = Math.max(0, ((v.z - 1) * (w || 0)) / 2) + 60;
      const my = Math.max(0, ((v.z - 1) * (h || 0)) / 2) + 60;
      return { ...v, x: Math.min(mx, Math.max(-mx, v0.x + ev.clientX - sx)), y: Math.min(my, Math.max(-my, v0.y + ev.clientY - sy)) };
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const stageDims = () => [stageRef.current?.clientWidth, stageRef.current?.clientHeight];
  // True while some video in the project still waits for its copy at the current quality level.
  const preparing = quality !== 'full' && project.media.some((m) => levelCopyState(m, quality) === 'fallback');
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.altKey || e.metaKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      e.preventDefault();
      toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));

  const apply = (t, isPlaying) => {
    lastApply.current = { t, playing: isPlaying };
    leadRef.current = null;
    const layout = videoLayout(project.videoClips);
    const active = layout.filter((l) => t >= l.start && t < l.end && mediaById[l.clip.mediaId]);
    const incoming = active.length === 2 ? active[1] : null;
    const fxTr = incoming && incoming.trans > 0 ? fxTransition(incoming.clip.transition.type) : null;
    const tr = incoming && incoming.trans > 0 && !fxTr ? transitionStyles(incoming.clip.transition.type, (t - incoming.start) / incoming.trans) : null;

    [0, 1].forEach((k) => {
      const slot = slots[k].current;
      const v = vids[k].current;
      const img = imgs[k].current;
      const item = active.find((l) => l.index % 2 === k);
      slot.style.opacity = '1';
      slot.style.transform = '';
      slot.style.clipPath = 'none';
      const layer = layers[k].current;
      const cv = keyed[k].current;
      const mv = mattes[k].current;
      if (!item) {
        slot.style.visibility = 'hidden';
        if (!v.paused) v.pause();
        if (!mv.paused) mv.pause();
        return;
      }
      const c = item.clip;
      const m = mediaById[c.mediaId];
      const fx = c.effects || [];
      slot.style.visibility = 'visible';
      slot.style.zIndex = item === incoming ? 2 : 1;
      slot.style.filter = clipCss(c);
      slot.style.mixBlendMode = blendOf(c).css;
      const motionNow = hasMotion(c) ? stateAt(c, t - item.start, clipLen(c)) : undefined;
      Object.assign(layer.style, layerStyle(c, project.width, project.height, motionNow));
      if (decos[k].current) Object.assign(decos[k].current.style, decoStyle(c, project.width, project.height, motionNow));
      const chroma = chromaOf(c);
      slot.classList.toggle('vignette', fx.includes('vignette'));
      const flip = `scale(${fx.includes('mirror') ? -1 : 1}, ${fx.includes('flipv') ? -1 : 1})`;
      if (tr) Object.assign(slot.style, item === incoming ? tr.in : tr.out);
      if (m.type === 'image') {
        v.style.display = 'none';
        if (!v.paused) v.pause();
        img.style.display = 'block';
        img.style.transform = flip;
        const url = toFileUrl(m.path);
        if (img.dataset.src !== url) { img.dataset.src = url; img.src = url; }
      } else {
        img.style.display = 'none';
        v.style.display = 'block';
        v.style.transform = flip;
        const speed = c.speed || 1;
        syncMedia(v, toFileUrl(previewPath(m)), c.in + (t - item.start) * speed, isPlaying, c.muted ? 0 : c.volume ?? 1, speed);
        // The playback clock anchors to the lead (non-incoming) clip's element.
        if (item !== incoming || !leadRef.current) leadRef.current = { el: v, item, clip: c };
      }
      const matte = usesMatte(c, m);
      if (matte) syncMatte(mv, toFileUrl(m.matte), v, isPlaying, c.speed || 1);
      else if (!mv.paused) mv.pause();
      // Chroma key / matte: the media element stays (it plays the sound and decodes), the keyed canvas is what shows.
      const src = m.type === 'image' ? img : v;
      const pfx = pixelPasses(project, c, item.start, t - item.start);
      const processed = chroma.on || pfx.length > 0 || matte;
      cv.style.display = processed ? 'block' : 'none';
      src.style.visibility = processed ? 'hidden' : ''; // '' inherits: 'visible' would show through a hidden slot
      if (processed) {
        cv.style.transform = flip;
        if (m.type === 'image') { if (img.complete) drawKeyed(cv, img, img.naturalWidth, img.naturalHeight, chroma, pfx); }
        else if (v.readyState >= 2) drawKeyed(cv, v, v.videoWidth, v.videoHeight, chroma, pfx, matte && mv.readyState >= 2 ? mv : null);
      }
    });

    // Animated transitions: both clips are drawn into small frames and mixed by the same expression the export uses.
    const tc = trCanvas.current;
    if (fxTr) {
      const outgoing = active[0];
      const pw = Math.min(960, project.width);
      const ph = Math.max(2, Math.round((pw * project.height) / project.width));
      if (tc.width !== pw || tc.height !== ph) { tc.width = pw; tc.height = ph; }
      const frameOf = (item, key) => {
        const k = item.index % 2;
        const m = mediaById[item.clip.mediaId];
        let off = trBufs.current[key];
        if (!off || off.width !== pw || off.height !== ph) { off = document.createElement('canvas'); off.width = pw; off.height = ph; trBufs.current[key] = off; }
        const octx = off.getContext('2d');
        octx.fillStyle = project.background || '#000';
        octx.fillRect(0, 0, pw, ph);
        const kc = keyed[k].current;
        const srcEl = kc.style.display === 'block' ? kc : m.type === 'image' ? imgs[k].current : vids[k].current;
        const sw = srcEl.videoWidth || srcEl.naturalWidth || srcEl.width;
        const sh = srcEl.videoHeight || srcEl.naturalHeight || srcEl.height;
        if (sw && sh) {
          const f = Math.min(pw / sw, ph / sh);
          try { octx.drawImage(srcEl, (pw - sw * f) / 2, (ph - sh * f) / 2, sw * f, sh * f); } catch { /* frame not ready */ }
        }
        return off;
      };
      const a = frameOf(outgoing, 'a');
      const b = frameOf(incoming, 'b');
      const out = fxGL().transition(a, b, pw, ph, easeValue(incoming.clip.transition?.ease, (t - incoming.start) / incoming.trans), fxTr.expr);
      tc.getContext('2d').drawImage(out, 0, 0);
      tc.style.display = 'block';
      slots.forEach((s) => { s.current.style.opacity = '0'; });
    } else if (tc) {
      tc.style.display = 'none';
    }
    const fl = flashRef.current;
    fl.style.opacity = tr && tr.flash ? tr.flash.opacity : 0;
    if (tr && tr.flash) fl.style.background = tr.flash.color;

    // Overlay clips (picture in picture): same layer model as the main track, drawn above it.
    (project.overlayClips || []).forEach((c) => {
      const el = overlayEls.current[c.id];
      const m = mediaById[c.mediaId];
      if (!el || !el.slot || !m) return;
      const lt = t - c.start;
      const on = lt >= 0 && lt < freeLen('overlay', c);
      el.slot.style.visibility = on ? 'visible' : 'hidden';
      if (!on) {
        if (el.v && !el.v.paused) el.v.pause();
        return;
      }
      const fx = c.effects || [];
      el.slot.style.filter = clipCss(c);
      el.slot.style.mixBlendMode = blendOf(c).css;
      const motionNow = hasMotion(c) ? stateAt(c, lt, clipLen(c)) : undefined;
      Object.assign(el.layer.style, layerStyle(c, project.width, project.height, motionNow));
      if (el.deco) Object.assign(el.deco.style, decoStyle(c, project.width, project.height, motionNow));
      const flip = `scale(${fx.includes('mirror') ? -1 : 1}, ${fx.includes('flipv') ? -1 : 1})`;
      const chroma = chromaOf(c);
      const src = m.type === 'image' ? el.img : el.v;
      src.style.transform = flip;
      if (m.type === 'image') {
        const url = toFileUrl(m.path);
        if (el.img.dataset.src !== url) { el.img.dataset.src = url; el.img.src = url; }
      } else {
        const speed = c.speed || 1;
        syncMedia(el.v, toFileUrl(previewPath(m)), c.in + lt * speed, isPlaying, c.muted ? 0 : c.volume ?? 1, speed);
      }
      const matte = usesMatte(c, m) && el.mv;
      if (matte) syncMatte(el.mv, toFileUrl(m.matte), el.v, isPlaying, c.speed || 1);
      else if (el.mv && !el.mv.paused) el.mv.pause();
      const pfx = pixelPasses(project, c, c.start, lt);
      const processed = chroma.on || pfx.length > 0 || !!matte;
      el.cv.style.display = processed ? 'block' : 'none';
      src.style.visibility = processed ? 'hidden' : ''; // '' inherits: 'visible' would show through a hidden slot
      if (processed) {
        el.cv.style.transform = flip;
        if (m.type === 'image') { if (el.img.complete) drawKeyed(el.cv, el.img, el.img.naturalWidth, el.img.naturalHeight, chroma, pfx); }
        else if (el.v.readyState >= 2) drawKeyed(el.cv, el.v, el.v.videoWidth, el.v.videoHeight, chroma, pfx, matte && el.mv.readyState >= 2 ? el.mv : null);
      }
    });

    project.audioClips.forEach((c) => {
      const el = audioEls.current[c.id];
      const m = mediaById[c.mediaId];
      if (!el || !m) return;
      const len = freeLen('audio', c);
      const lt = t - c.start;
      if (lt >= 0 && lt < len) {
        let g = c.volume ?? 1;
        if (c.fadeIn > 0) g *= Math.min(1, lt / c.fadeIn);
        if (c.fadeOut > 0) g *= Math.min(1, (len - lt) / c.fadeOut);
        syncMedia(el, toFileUrl(m.path), c.in + lt * (c.speed || 1), isPlaying, g, c.speed || 1);
      } else if (!el.paused) el.pause();
    });
  };

  // Paused: when a seek or an image load finishes, draw again (keyed canvases need the decoded frame).
  const redraw = () => {
    if (!lastApply.current.playing) apply(lastApply.current.t, false);
  };

  // Paused: show the frame at `time`.
  useEffect(() => {
    if (!playing) {
      apply(time, false);
      if (clockRef) clockRef.current = { time, stamp: performance.now(), playing: false, rate: 1 };
    }
  });

  // Playing: a media-anchored clock. The position interpolates from the last anchor at
  // display rate; whenever the lead video element disagrees by more than 50 ms the anchor
  // is corrected — snapped forward if the media is ahead, HELD (never rewound) if the
  // media stalled, so a decode hiccup pauses the playhead instead of the old behaviour
  // (wall clock runs on, then a jump-cut seek when the drift threshold trips). The clock
  // is also published to clockRef every frame: the timeline's playhead reads it directly
  // from the DOM side, so it glides even when React renders drop frames.
  useEffect(() => {
    if (!playing) return;
    const master = { time, stamp: performance.now() };
    let raf;
    const tick = () => {
      let t = interpolateTime(master.time, master.stamp, performance.now(), 1);
      const lead = leadRef.current;
      if (lead?.el && lead.el.readyState >= 2 && !lead.el.paused && t >= lead.item.start && t < lead.item.end) {
        const mt = lead.item.start + (lead.el.currentTime - lead.clip.in) / (lead.clip.speed || 1);
        const fix = Number.isFinite(mt) ? anchorCorrection(mt, t) : null;
        if (fix) { master.time = fix.time; master.stamp = performance.now(); t = fix.time; }
      }
      if (t >= duration) {
        onTime(duration);
        onEnd();
        apply(duration, false);
        if (clockRef) clockRef.current = { time: duration, stamp: performance.now(), playing: false, rate: 1 };
        return;
      }
      apply(t, true);
      onTime(t);
      if (clockRef) clockRef.current = { time: t, stamp: performance.now(), playing: true, rate: 1 };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart the loop when play state toggles, the user seeks (seekVer bumps) or the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, seekVer, project, duration]);

  // Scale overlays from project pixels (e.g. 1280x720) to the on-screen stage.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (stageRef.current) setScale(stageRef.current.clientWidth / project.width);
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [project.width]);

  // Text layer: drawn with the same canvas renderer the export uses.
  const textCanvas = useRef(null);
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    fontsReady().then(() => setFontTick((n) => n + 1));
    return onFontsChanged(() => setFontTick((n) => n + 1));
  }, []);
  useEffect(() => {
    const cv = textCanvas.current;
    const stage = stageRef.current;
    if (!cv || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(stage.clientWidth * dpr);
    const h = Math.round(stage.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(w / project.width, 0, 0, h / project.height, 0, 0);
    drawFxOverlays(ctx, project, time, project.width, project.height);
    drawTextLayer(ctx, project.textClips, time, project.width, project.height);
  }, [time, project, scale, fontTick]);
  const stickers = project.stickerClips.filter((c) => time >= c.start && time < c.start + c.duration);

  return (
    <section ref={playerRef} className={`player ${dropOver ? 'drop-target' : ''} ${full ? 'is-full' : ''} ${peek ? 'peeking' : ''}`} aria-label="Player"
      onDragOver={(e) => { if (!isInternal(e)) return; e.preventDefault(); e.stopPropagation(); setDropOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false); }}
      onDrop={(e) => { if (!isInternal(e)) return; e.preventDefault(); e.stopPropagation(); setDropOver(false); onDropItem(readPayload(e)); }}>
      <div className="panel-head">
        <span className="panel-title">Player</span>
        {peek ? <span className="pill peek-pill" title={peek.name}>Media · {peek.name}</span>
          : <span className="pill">{project.ratio} · {project.width}×{project.height} · {project.fps} fps</span>}
      </div>
      {peek && <MediaPeek m={peek} fps={project.fps} onClose={onClosePeek} onAdd={onAddPeek} />}
      <div className={`stage-wrap ${view.z > 1 ? 'zoomed' : ''}`} ref={wrapRef} onMouseDown={onStageMouseDown}>
        <div className="stage" ref={stageRef} style={{
          aspectRatio: `${project.width} / ${project.height}`, background: project.background,
          width: `min(100cqw, calc(100cqh * ${project.width / project.height}))`,
          transform: zoomTransform(view),
        }}>
          {[0, 1].map((k) => (
            <div key={k} className="slot" ref={slots[k]}>
              <div className="layer" ref={layers[k]}>
                <video ref={vids[k]} preload="auto" playsInline onSeeked={redraw} onLoadedData={redraw} />
                <video ref={mattes[k]} className="matte-src" preload="auto" playsInline muted onSeeked={redraw} onLoadedData={redraw} />
                <img ref={imgs[k]} alt="" onLoad={redraw} />
                <canvas ref={keyed[k]} className="keyed" />
              </div>
              <div className="layer deco" ref={decos[k]} />
            </div>
          ))}
          <canvas className="fx-transition" ref={trCanvas} />
          <div className="flash" ref={flashRef} />
          {(project.overlayClips || []).map((c) => {
            const m = mediaById[c.mediaId];
            const reg = (part) => (node) => {
              const el = overlayEls.current[c.id] || (overlayEls.current[c.id] = {});
              if (node) el[part] = node;
              else delete overlayEls.current[c.id];
            };
            return (
              <div key={c.id} className="slot ov" ref={reg('slot')} style={{ visibility: 'hidden' }}>
                <div className="layer" ref={reg('layer')}>
                  <video ref={reg('v')} preload="auto" playsInline onSeeked={redraw} onLoadedData={redraw}
                    style={{ display: m?.type === 'video' ? 'block' : 'none' }} />
                  <img ref={reg('img')} alt="" onLoad={redraw} style={{ display: m?.type === 'image' ? 'block' : 'none' }} />
                  <video ref={reg('mv')} className="matte-src" preload="auto" playsInline muted onSeeked={redraw} onLoadedData={redraw} />
                  <canvas ref={reg('cv')} className="keyed" />
                </div>
                <div className="layer deco" ref={reg('deco')} />
              </div>
            );
          })}
          {project.audioClips.map((c) => (
            <audio key={c.id} ref={(el) => { if (el) audioEls.current[c.id] = el; else delete audioEls.current[c.id]; }} preload="auto" />
          ))}
          {stickers.map((s) => {
            const a = textAnim(s, time - s.start);
            const m = s.mediaId && project.media.find((x) => x.id === s.mediaId);
            return (
              <div key={s.id} className="overlay-sticker" style={{
                left: `${s.x * 100}%`, top: `${s.y * 100}%`, height: s.size * scale, opacity: a.opacity,
                transform: `translate(-50%, -50%) rotate(${s.rotation || 0}deg) ${a.transform}`,
              }}>
                {m ? <img src={toFileUrl(m.path)} alt="" /> : <span style={{ fontSize: s.size * scale * 0.8 }}>{s.emoji}</span>}
              </div>
            );
          })}
          <canvas ref={textCanvas} className="text-layer" />
          <TransformBox project={editProject || project} time={time} selection={selection} onSelect={onSelect} dispatch={dispatch}
            sw={project.width * scale} sh={project.height * scale} />
          {!project.videoClips.length && (
            <div className="stage-empty">
              <img src="./logo.png" alt="" draggable={false} />
              <span>Drop a video or photo here, or on the timeline</span>
            </div>
          )}
        </div>
      </div>
      <div className="transport">
        <span className="tc"><b>{formatTime(time)}</b><span> / {formatTime(duration)}</span></span>
        <div className="transport-btns">
          <button className="icon-btn" aria-label="Go to start (Home)" title="Go to start (Home)" onClick={() => onSeek(0)}><SkipBack size={16} /></button>
          <button className="icon-btn" aria-label="Previous frame (←)" title="Previous frame (←)" onClick={() => onSeek(time - 1 / project.fps)}><ChevronLeft size={18} /></button>
          <button className="play-btn" onClick={onTogglePlay} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title="Space">
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="icon-btn" aria-label="Next frame (→)" title="Next frame (→)" onClick={() => onSeek(time + 1 / project.fps)}><ChevronRight size={18} /></button>
          <button className="icon-btn" aria-label="Go to end" title="Go to end" onClick={() => onSeek(duration)}><SkipForward size={16} /></button>
        </div>
        <span className="tc-spacer">
          {onQualityChange && (
            <span className="transport-menu-wrap">
              <button className={`proxy-btn quality-btn ${quality !== 'full' ? 'on' : ''}`} onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
                aria-haspopup="menu" aria-expanded={menu === 'quality'}
                title="Playback quality: lower levels play a scaled copy so editing stays smooth. Export always uses the original videos.">
                <Gauge size={12} /> {QUALITY_LABELS[quality]} <ChevronUp size={11} />
              </button>
              {menu === 'quality' && (
                <div className="transport-menu" role="menu" aria-label="Playback quality">
                  {[
                    ['full', 'Full quality', 'Original video resolution'],
                    ['high', 'High quality', 'Smooth playback, no impact on exported video'],
                    ['medium', 'Medium quality', 'Smoother playback, no impact on exported video'],
                    ['low', 'Low quality', 'Smoothest playback, no impact on exported video'],
                  ].map(([id, name, desc]) => (
                    <button key={id} className={`transport-menu-item ${quality === id ? 'active' : ''}`} role="menuitemradio" aria-checked={quality === id}
                      onClick={() => { setMenu(null); onQualityChange(id); }}>
                      <span className="tm-check">{quality === id ? <Check size={14} /> : null}</span>
                      <span className="tm-text"><b>{name}</b><small>{desc}</small></span>
                      {preparing && quality === id && <span className="tm-note">Preparing…</span>}
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
          <span className="transport-menu-wrap">
            <button className={`proxy-btn zoom-btn ${view.fit ? '' : 'on'}`} onClick={() => setMenu(menu === 'zoom' ? null : 'zoom')}
              aria-haspopup="menu" aria-expanded={menu === 'zoom'}
              title="Zoom the preview (view only — clips and export are not affected). Mouse wheel over the video zooms too.">
              <ZoomIn size={12} /> {view.fit ? 'Fit' : `${Math.round(view.z * 100)}%`} <ChevronUp size={11} />
            </button>
            {menu === 'zoom' && (
              <div className="transport-menu zoom-menu" role="menu" aria-label="Preview zoom">
                {[
                  ['fit', 'Fit'],
                  [50, '50%'],
                  [100, '100%'],
                  [150, '150%'],
                  [200, '200%'],
                ].map(([choice, label]) => {
                  const active = choice === 'fit' ? view.fit : !view.fit && Math.round(view.z * 100) === choice;
                  return (
                    <button key={label} className={`transport-menu-item ${active ? 'active' : ''}`} role="menuitemradio" aria-checked={active}
                      onClick={() => { setMenu(null); setView((v) => applyZoomChoice(v, choice, ...stageDims())); }}>
                      <span className="tm-check">{active ? <Check size={14} /> : null}</span>
                      <span className="tm-text"><b>{label}</b></span>
                    </button>
                  );
                })}
              </div>
            )}
          </span>
          <button className="icon-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen (Esc)' : 'Full screen (F)'} title={full ? 'Exit full screen (Esc)' : 'Full screen (F)'}>
            {full ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </span>
      </div>
    </section>
  );
}
