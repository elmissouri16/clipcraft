// Stereo level meter docked at the right edge of the timeline (item 11). It reads the preview's
// real audio graph (src/audioTap.js — a splitter + two analysers on the master the player sounds
// through) and draws on a canvas with requestAnimationFrame: no React state per frame, and the
// loop parks once playback has stopped and both channels have settled at the floor (a lit clip
// lamp stays painted, since the canvas keeps its last frame).
//
// Ballistics and lamp semantics live in src/meterMath.js: instant attack, 240 dB/s release
// (0 dBFS reaches the floor in ~250 ms), a peak-hold tick that lingers ~1.2 s, and a clip lamp
// that means a true over — it lights only at >= -0.3 dBFS and holds ~1.5 s after the last
// over; click the meter or restart playback to clear it sooner. The bar's red zone is only a
// warning region (from -3 dB); green runs to -12, amber to -3. Scale: 0 / -6 / -12 / -24 /
// -36 / -48 / -60 dBFS, floor -60.
import React, { useEffect, useRef } from 'react';
import { meterAnalysers } from '../audioTap.js';
import { METER_FLOOR as FLOOR, clearClip, createMeterState, dbOf, stepMeter } from '../meterMath.js';

const TICKS = [0, -6, -12, -24, -36, -48, -60];

export default function AudioMeter({ active }) {
  const canvasRef = useRef(null);
  const st = useRef({
    ...createMeterState(),
    raf: 0, running: false, last: 0, buf: new Float32Array(2048), wasActive: false,
  });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = st.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const top = 16; // clip lamps live above the bars
    const bottom = 15; // "L R" labels under the bars
    const plotH = Math.max(10, H - top - bottom);
    const frac = (db) => Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR));
    const yOf = (db) => top + (1 - frac(db)) * plotH;
    // Scale numbers.
    g.fillStyle = '#8b8fa3';
    g.font = '8.5px system-ui, sans-serif';
    g.textAlign = 'right';
    for (const t of TICKS) g.fillText(t === 0 ? '0' : `−${Math.abs(t)}`, 21, yOf(t) + 3);
    // Bars: L at x=25, R at x=38, 8 px wide.
    const bars = [25, 38];
    for (let ch = 0; ch < 2; ch++) {
      const x = bars[ch];
      // Clip lamp.
      g.fillStyle = s.clip[ch] ? '#e5484d' : 'rgba(255,255,255,0.10)';
      g.beginPath();
      g.roundRect(x, 4, 8, 6, 2);
      g.fill();
      // Track.
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x, top, 8, plotH);
      // Level, in three colour regions (green to -12, amber to -3, red above).
      const lvl = s.disp[ch];
      const regions = [[FLOOR, -12, '#35c26e'], [-12, -3, '#e8b13c'], [-3, 0, '#e5484d']];
      for (const [lo, hi, color] of regions) {
        if (lvl <= lo) continue;
        const yHi = yOf(Math.min(lvl, hi));
        const yLo = yOf(lo);
        g.fillStyle = color;
        g.fillRect(x, yHi, 8, yLo - yHi);
      }
      // Peak-hold tick.
      if (s.hold[ch] > FLOOR) {
        g.fillStyle = '#e8e9f2';
        g.fillRect(x - 1.5, yOf(s.hold[ch]) - 1, 11, 2);
      }
      // Channel letter.
      g.fillStyle = '#8b8fa3';
      g.font = '9px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(ch === 0 ? 'L' : 'R', x + 4, H - 4);
    }
  };

  const step = (now) => {
    const s = st.current;
    const dt = Math.min(0.1, s.last ? (now - s.last) / 1000 : 0.016);
    s.last = now;
    const an = meterAnalysers();
    const peakDb = [FLOOR, FLOOR];
    for (let ch = 0; ch < 2; ch++) {
      const node = an ? (ch === 0 ? an.left : an.right) : null;
      let peak = 0;
      if (node) {
        node.getFloatTimeDomainData(s.buf);
        for (let i = 0; i < s.buf.length; i++) { const v = Math.abs(s.buf[i]); if (v > peak) peak = v; }
      }
      peakDb[ch] = dbOf(peak);
    }
    stepMeter(s, peakDb, now, dt * 1000);
    draw();
    const settled = !st.current.wasActive
      && s.disp[0] <= FLOOR + 0.01 && s.disp[1] <= FLOOR + 0.01
      && s.hold[0] <= FLOOR + 0.01 && s.hold[1] <= FLOOR + 0.01;
    if (!settled) s.raf = requestAnimationFrame(step);
    else s.running = false;
  };
  const kick = () => {
    const s = st.current;
    if (!s.running) { s.running = true; s.last = 0; s.raf = requestAnimationFrame(step); }
  };

  useEffect(() => {
    const s = st.current;
    if (active && !s.wasActive) clearClip(s); // playback (re)start clears the lamps
    s.wasActive = !!active;
    if (active) kick();
    else kick(); // one settling pass so the bars fall to floor and park
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => { draw(); kick(); window.__meter = st.current; return () => { cancelAnimationFrame(st.current.raf); st.current.running = false; }; }, []);

  return (
    <div className="meter-strip" title="Preview audio level — click to clear the clip indicators"
      onClick={() => { clearClip(st.current); draw(); }}>
      <canvas ref={canvasRef} className="meter-canvas" aria-label="Stereo audio level meter" />
    </div>
  );
}
