// The easing curve editor (transitions + keyframe segments): preset chips with curve glyphs, an SVG
// graph of the curve, a view-only motion preview, and — in Custom — two draggable bezier handles with
// a live coordinate readout. Value is a preset id ('smooth', 'easeIn', …), a custom
// { p1x, p1y, p2x, p2y } object, or undefined (linear). Rendering math lives in fx/easing.js; this is
// only the control. The graph's y range (-0.4…1.45) leaves room to SEE overshoot curves pass 1.
import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { EASE_PRESETS, bezierSolver, easeValue, isCustomEase, ptsOf } from '../fx/easing.js';

const PX0 = 14; const PX1 = 114; // plot x range (viewBox units); t 0..1 maps across it
const PY0 = 4; const PY1 = 72; // plot y range (svg coords, top..bottom)
const VMIN = -0.4; const VMAX = 1.45;
const XV = (t) => PX0 + t * (PX1 - PX0); // time -> svg x
const YV = (v) => PY1 - (v - VMIN) * ((PY1 - PY0) / (VMAX - VMIN)); // value -> svg y

const curvePath = (solve, n = 49) => Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1);
  return `${i ? 'L' : 'M'}${XV(t).toFixed(1)},${YV(solve(t)).toFixed(1)}`;
}).join(' ');

// Tiny sparkline of a preset's own curve, drawn from its real bezier values.
function Glyph({ pts, dashed = false }) {
  const solve = bezierSolver(...pts);
  const gy = (v) => 16 - (v + 0.3) * (14 / 1.7); // range -0.3..1.4 -> svg y 16..2
  const d = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    return `${i ? 'L' : 'M'}${(2 + t * 32).toFixed(1)},${gy(solve(t)).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="curve-glyph" viewBox="0 0 36 18" aria-hidden="true">
      <line x1="2" x2="34" y1={gy(0)} y2={gy(0)} className="curve-glyph-base" />
      <path d={d} className={`curve-glyph-line ${dashed ? 'dashed' : ''}`} fill="none" />
    </svg>
  );
}

export default function CurveEditor({ value, onChange, compact = false, resetValue = undefined }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // 'p1' | 'p2' while dragging
  const [activeGrip, setActiveGrip] = useState(null); // dragging or hovered grip, for the readout
  const [playing, setPlaying] = useState(false);
  const dotRef = useRef(null);
  const ghostRef = useRef(null);
  const rafRef = useRef(0);
  const custom = isCustomEase(value);
  const pts = ptsOf(value);
  const activeId = custom ? 'custom' : (typeof value === 'string' ? value : (!value ? 'linear' : 'custom'));
  const solve = bezierSolver(...pts);
  const line = curvePath(solve);
  const fill = `${line} L${XV(1).toFixed(1)},${YV(0).toFixed(1)} L${XV(0).toFixed(1)},${YV(0).toFixed(1)} Z`;

  // Motion preview: view-only. A violet dot travels with the current easing; a hollow ghost dot
  // travels linearly for contrast. ~900 ms per pass, looping while playing.
  useEffect(() => {
    if (!playing) return undefined;
    const start = performance.now();
    const tick = (now) => {
      const t = ((now - start) % 900) / 900;
      if (dotRef.current) dotRef.current.style.left = `${(easeValue(value, t) * 100).toFixed(2)}%`;
      if (ghostRef.current) ghostRef.current.style.left = `${(t * 100).toFixed(2)}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, value]);

  const pick = (id) => {
    if (id === 'custom') onChange({ p1x: pts[0], p1y: pts[1], p2x: pts[2], p2y: pts[3] });
    else onChange(id === 'linear' ? undefined : id);
  };
  const toData = (ev) => {
    const r = svgRef.current.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * 120;
    const vy = ((ev.clientY - r.top) / r.height) * 84;
    return {
      x: Math.min(1, Math.max(0, (vx - PX0) / (PX1 - PX0))),
      y: Math.min(1.9, Math.max(-0.6, VMIN + (PY1 - vy) / ((PY1 - PY0) / (VMAX - VMIN)))),
    };
  };
  const onMove = (ev) => {
    if (!dragRef.current) return;
    const d = toData(ev);
    const next = { p1x: pts[0], p1y: pts[1], p2x: pts[2], p2y: pts[3] };
    if (dragRef.current === 'p1') { next.p1x = +d.x.toFixed(3); next.p1y = +d.y.toFixed(3); }
    else { next.p2x = +d.x.toFixed(3); next.p2y = +d.y.toFixed(3); }
    onChange(next);
  };
  const startDrag = (which) => (ev) => {
    if (!custom) return;
    dragRef.current = which;
    setActiveGrip(which);
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const endDrag = () => { dragRef.current = null; setActiveGrip(null); };

  const gripXY = (which) => (which === 'p1' ? [pts[0], pts[1]] : [pts[2], pts[3]]);
  const readout = activeGrip && custom ? (() => {
    const [gx, gy] = gripXY(activeGrip);
    const sx = XV(gx); const sy = YV(gy);
    const w = 30; const h = 8;
    const rx = Math.min(Math.max(sx + 5, PX0), 120 - w - 1);
    const ry = Math.min(Math.max(sy - h - 3.5, 1), 84 - h - 1);
    return (
      <g className="curve-readout" pointerEvents="none">
        <rect x={rx} y={ry} width={w} height={h} rx="2" />
        <text x={rx + w / 2} y={ry + h / 2 + 1.55} textAnchor="middle">{gx.toFixed(2)}, {gy.toFixed(2)}</text>
      </g>
    );
  })() : null;

  const grip = (which) => {
    const [gx, gy] = gripXY(which);
    const active = activeGrip === which;
    return (
      <g key={which} className={`curve-grip-grp ${active ? 'active' : ''}`}>
        <circle cx={XV(gx)} cy={YV(gy)} r="5.6" className="curve-halo" />
        <circle cx={XV(gx)} cy={YV(gy)} r="3.1" className="curve-grip"
          onPointerDown={startDrag(which)}
          onPointerEnter={() => { if (!dragRef.current) setActiveGrip(which); }}
          onPointerLeave={() => { if (!dragRef.current) setActiveGrip(null); }} />
      </g>
    );
  };

  return (
    <div className={`curve-editor ${compact ? 'compact' : ''}`}>
      <div className="curve-chips" role="group" aria-label="Easing preset">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} type="button" className={`curve-chip ${activeId === p.id ? 'on' : ''}`} onClick={() => pick(p.id)}>
            <Glyph pts={p.pts} />
            <span>{p.name}</span>
          </button>
        ))}
        <button type="button" className={`curve-chip ${activeId === 'custom' ? 'on' : ''}`} onClick={() => pick('custom')}>
          <Glyph pts={[0.3, 0.05, 0.7, 0.95]} dashed />
          <span>Custom</span>
        </button>
      </div>
      <svg ref={svgRef} className="curve-graph" viewBox="0 0 120 84" role="img" aria-label="Easing curve"
        onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
        <defs>
          <filter id="curve-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} className="curve-frame" />
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={`v${t}`} x1={XV(t)} x2={XV(t)} y1={PY0} y2={PY1} className="curve-grid" />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <line key={`h${v}`} x1={PX0} x2={PX1} y1={YV(v)} y2={YV(v)}
            className={`curve-grid ${v === 0 || v === 1 ? 'strong' : ''} ${v === 0.5 ? 'dash' : ''}`} />
        ))}
        {[0, 0.5, 1].map((v) => (
          <text key={`a${v}`} x={PX0 - 2.5} y={YV(v) + 1.5} className="curve-axis" textAnchor="end">{v}</text>
        ))}
        <line x1={XV(0)} y1={YV(0)} x2={XV(1)} y2={YV(1)} className="curve-guide" />
        <path d={fill} className="curve-fill" />
        <path d={line} className="curve-glow-line" filter="url(#curve-glow)" fill="none" />
        <path d={line} className="curve-line" fill="none" />
        {custom && <line x1={XV(0)} y1={YV(0)} x2={XV(pts[0])} y2={YV(pts[1])} className="curve-stem" />}
        {custom && <line x1={XV(1)} y1={YV(1)} x2={XV(pts[2])} y2={YV(pts[3])} className="curve-stem" />}
        <rect x={XV(0) - 1.8} y={YV(0) - 1.8} width="3.6" height="3.6" className="curve-anchor" />
        <rect x={XV(1) - 1.8} y={YV(1) - 1.8} width="3.6" height="3.6" className="curve-anchor" />
        {custom && grip('p1')}
        {custom && grip('p2')}
        {readout}
      </svg>
      <div className="curve-preview">
        <button type="button" className={`curve-play ${playing ? 'on' : ''}`} onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Stop motion preview' : 'Play motion preview'} title={playing ? 'Stop preview' : 'Preview this motion'}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <div className="curve-track" aria-hidden="true">
          <span ref={ghostRef} className="curve-dot ghost" style={{ left: '0%' }} />
          <span ref={dotRef} className="curve-dot" style={{ left: '0%' }} />
        </div>
      </div>
      {!compact && (
        <div className="curve-meta">
          <span className="curve-bezier">cubic-bezier({pts.map((n) => (+n.toFixed(2))).join(', ')})</span>
          <button type="button" className="curve-reset" onClick={() => onChange(resetValue)}>
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      )}
    </div>
  );
}
