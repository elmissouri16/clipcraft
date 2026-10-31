import React, { useEffect, useMemo, useRef } from 'react';
import { drawTextClip } from '../text/render.js';
import { fontsReady } from '../fonts.js';

// Small canvas thumbnail of a text style, rendered with the real text renderer.
// Static by default (end of the in-animation, second word highlighted); animates while hovered.
const VW = 1280;
const VH = 720;

export default function TextPreview({ style, text, hover, width = 150, height = 84, loopDur = 2.2 }) {
  const ref = useRef(null);
  const raf = useRef(0);
  // Callers often build the style inline; key the drawing on its content, not its identity.
  const styleKey = useMemo(() => JSON.stringify(style), [style]);

  useEffect(() => {
    const cv = ref.current;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d');
    const sample = text || style.text || (style.caption ? 'Make it pop' : 'Title');
    const clip = {
      ...style,
      text: sample,
      start: 0,
      duration: loopDur,
      x: 0.5,
      y: 0.5,
      maxWidth: 0.92,
      size: Math.min(150, (style.size || 64) * 2.1),
    };
    const draw = (lt) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(cv.width / VW, 0, 0, cv.height / VH, 0, 0);
      drawTextClip(ctx, clip, lt, VW, VH);
    };
    let alive = true;
    fontsReady().then(() => {
      if (!alive) return;
      if (!hover) {
        const words = sample.split(/\s+/).length;
        // Show the finished in-animation with the second word "spoken".
        draw(Math.min(loopDur - 0.3, Math.max((style.animIn?.dur || 0.3) + 0.05, (loopDur / Math.max(1, words)) * 1.2)));
        return;
      }
      const t0 = performance.now();
      const tick = () => {
        draw(((performance.now() - t0) / 1000) % loopDur);
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey, text, hover, width, height, loopDur]);

  return <canvas ref={ref} style={{ width, height, display: 'block' }} aria-hidden="true" />;
}
