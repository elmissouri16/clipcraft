// The easing curve editor (transitions + keyframe segments): preset chips, an SVG graph of the curve,
// and — in Custom — two draggable bezier handles. Value is a preset id ('smooth', 'easeIn', …), a custom
// { p1x, p1y, p2x, p2y } object, or undefined (linear). Rendering math lives in fx/easing.js; this is
// only the control. The graph's y range (-0.35…1.35) leaves room to SEE overshoot curves pass 1.
import React, { useRef } from 'react';
import { EASE_PRESETS, bezierSolver, isCustomEase, ptsOf } from '../fx/easing.js';

const X0 = 8; const X1 = 92; const YV = (v) => 66 - (v + 0.35) * (60 / 1.7); // value -> svg y
const XV = (t) => X0 + t * (X1 - X0); // time -> svg x

export default function CurveEditor({ value, onChange, compact = false, resetValue = undefined }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // 'p1' | 'p2' while dragging
  const custom = isCustomEase(value);
  const pts = ptsOf(value);
  const activeId = custom ? 'custom' : (typeof value === 'string' ? value : (!value ? 'linear' : 'custom'));
  const solve = bezierSolver(...pts);
  const path = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return `${i ? 'L' : 'M'}${XV(t).toFixed(1)},${YV(solve(t)).toFixed(1)}`;
  }).join(' ');

  const pick = (id) => {
    if (id === 'custom') onChange({ p1x: pts[0], p1y: pts[1], p2x: pts[2], p2y: pts[3] });
    else onChange(id === 'linear' ? undefined : id);
  };
  const toData = (ev) => {
    const r = svgRef.current.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * 100;
    const vy = ((ev.clientY - r.top) / r.height) * 76;
    return {
      x: Math.min(1, Math.max(0, (vx - X0) / (X1 - X0))),
      y: Math.min(1.9, Math.max(-0.6, (66 - vy) / (60 / 1.7) - 0.35)),
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
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className={`curve-editor ${compact ? 'compact' : ''}`}>
      <div className="curve-chips" role="group" aria-label="Easing preset">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} type="button" className={`curve-chip ${activeId === p.id ? 'on' : ''}`} onClick={() => pick(p.id)}>{p.name}</button>
        ))}
        <button type="button" className={`curve-chip ${activeId === 'custom' ? 'on' : ''}`} onClick={() => pick('custom')}>Custom</button>
      </div>
      <svg ref={svgRef} className="curve-graph" viewBox="0 0 100 76" role="img" aria-label="Easing curve"
        onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={X0} x2={X1} y1={YV(v)} y2={YV(v)} className={v === 0 || v === 1 ? 'curve-grid strong' : 'curve-grid'} />
            <text x={X0 - 1.5} y={YV(v) + 1.2} className="curve-axis" textAnchor="end">{v}</text>
          </g>
        ))}
        <line x1={XV(0)} y1={YV(0)} x2={XV(1)} y2={YV(1)} className="curve-guide" />
        {custom && <line x1={XV(0)} y1={YV(0)} x2={XV(pts[0])} y2={YV(pts[1])} className="curve-stem" />}
        {custom && <line x1={XV(1)} y1={YV(1)} x2={XV(pts[2])} y2={YV(pts[3])} className="curve-stem" />}
        <path d={path} className="curve-line" fill="none" />
        <circle cx={XV(0)} cy={YV(0)} r="1.8" className="curve-anchor" />
        <circle cx={XV(1)} cy={YV(1)} r="1.8" className="curve-anchor" />
        {custom && <circle cx={XV(pts[0])} cy={YV(pts[1])} r="3.4" className="curve-handle" onPointerDown={startDrag('p1')} />}
        {custom && <circle cx={XV(pts[2])} cy={YV(pts[3])} r="3.4" className="curve-handle" onPointerDown={startDrag('p2')} />}
      </svg>
      {!compact && (
        <div className="curve-meta">
          <span className="curve-bezier">cubic-bezier({pts.map((n) => (+n.toFixed(2))).join(', ')})</span>
          <button type="button" className="curve-reset" onClick={() => onChange(resetValue)}>Reset</button>
        </div>
      )}
    </div>
  );
}
