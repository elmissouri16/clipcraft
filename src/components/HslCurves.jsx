import React, { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { CURVE_CHANNELS, HSL_COLORS, IDENTITY_CURVE, curveFn } from '../fx/grade.js';
import NumBox from './NumBox.jsx';

// Adjust > HSL: pick one of eight colors, then turn its hue, saturation and lightness.
export function HslPanel({ hsl = {}, onChange, dispatch }) {
  const [color, setColor] = useState('red');
  const c = HSL_COLORS.find((x) => x.id === color);
  const v = { h: 0, s: 0, l: 0, ...(hsl[color] || {}) };
  const set = (k, val) => onChange({ ...hsl, [color]: { ...v, [k]: val } });
  const hueAt = (d) => `hsl(${(c.hue + d + 360) % 360} 85% 55%)`;
  const rows = [
    ['h', 'Hue', `linear-gradient(90deg, ${hueAt(-30)}, ${hueAt(0)}, ${hueAt(30)})`],
    ['s', 'Saturation', `linear-gradient(90deg, hsl(${c.hue} 0% 55%), hsl(${c.hue} 95% 55%))`],
    ['l', 'Lightness', `linear-gradient(90deg, hsl(${c.hue} 80% 12%), hsl(${c.hue} 80% 55%), hsl(${c.hue} 80% 92%))`],
  ];
  const used = (id) => hsl[id] && (hsl[id].h || hsl[id].s || hsl[id].l);
  return (
    <div className="hsl">
      <div className="hsl-colors" role="radiogroup" aria-label="Color to change">
        {HSL_COLORS.map((x) => (
          <button key={x.id} role="radio" aria-checked={color === x.id} aria-label={x.name} title={x.name}
            className={`hsl-dot ${color === x.id ? 'on' : ''} ${used(x.id) ? 'used' : ''}`} style={{ '--dot': x.css }} onClick={() => setColor(x.id)} />
        ))}
      </div>
      <div className="grade-actions">
        <span className="hsl-name">{c.name}</span>
        <button className="btn btn-ghost btn-sm" disabled={!used(color)} onClick={() => onChange({ ...hsl, [color]: { h: 0, s: 0, l: 0 } })}><RotateCcw size={13} /> Reset {c.name.toLowerCase()}</button>
        <button className="btn btn-ghost btn-sm" disabled={!HSL_COLORS.some((x) => used(x.id))} onClick={() => onChange({})}>Reset all</button>
      </div>
      {rows.map(([k, name, track]) => (
        <div key={k} className="grade-row">
          <div className="grade-top">
            <span>{name}</span>
            <NumBox className="grade-numbox" ariaLabel={`${c.name} ${name} value`} step={1} min={-100} max={100} value={v[k]}
              onChange={(nv) => set(k, Math.round(nv))}
              onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
          </div>
          <input type="range" className="grade-range colored" min="-100" max="100" step="1" value={v[k]} aria-label={`${c.name} ${name}`} style={{ '--track': track }}
            onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
            onDoubleClick={() => set(k, 0)} onChange={(e) => set(k, Number(e.target.value))} />
        </div>
      ))}
      <p className="dim small">Changes only the parts of the picture with that color. Double-click a slider to set it back to 0.</p>
    </div>
  );
}

const CH = {
  master: { name: 'All', color: '#e5e7eb' },
  r: { name: 'Red', color: '#ef4444' },
  g: { name: 'Green', color: '#22c55e' },
  b: { name: 'Blue', color: '#3b82f6' },
};
const SIZE = 240;

// Adjust > Curves: drag points on the curve of all channels or of red, green, blue. Click to add a point,
// double-click a point to remove it.
export function CurvesPanel({ curves = {}, onChange, dispatch }) {
  const [ch, setCh] = useState('master');
  const svg = useRef(null);
  const pts = curves[ch] || IDENTITY_CURVE;
  const path = (points) => {
    const f = curveFn(points);
    let d = '';
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      d += `${i ? 'L' : 'M'}${(x * SIZE).toFixed(1)},${((1 - Math.min(1, Math.max(0, f(x)))) * SIZE).toFixed(1)}`;
    }
    return d;
  };
  const toPoint = (e) => {
    const r = svg.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const setPts = (next) => onChange({ ...curves, [ch]: next.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) });
  // Drags point i (the first and last stay at the left and right edges).
  const drag = (e, i, list) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch?.({ type: 'beginGesture' });
    const move = (ev) => {
      const [x, y] = toPoint(ev);
      const next = list.map((p) => [...p]);
      const lo = i === 0 ? 0 : next[i - 1][0] + 0.01;
      const hi = i === next.length - 1 ? 1 : next[i + 1][0] - 0.01;
      next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, x)), y];
      setPts(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dispatch?.({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const addPoint = (e) => {
    const [x] = toPoint(e);
    const y = curveFn(pts)(x);
    const next = [...pts, [x, y]].sort((a, b) => a[0] - b[0]);
    setPts(next);
    const i = next.findIndex((p) => p[0] === x);
    drag(e, i, next);
  };
  const changed = (id) => {
    const p = curves[id];
    return Array.isArray(p) && p.some(([x, y]) => Math.abs(x - y) > 1e-4);
  };
  return (
    <div className="curves">
      <div className="seg-tabs small curves-ch" role="tablist" aria-label="Curve">
        {CURVE_CHANNELS.map((id) => (
          <button key={id} role="tab" aria-selected={ch === id} className={ch === id ? 'on' : ''} onClick={() => setCh(id)}>
            <i style={{ background: CH[id].color }} /> {CH[id].name}{changed(id) ? ' •' : ''}
          </button>
        ))}
      </div>
      <svg ref={svg} className="curves-box" viewBox={`0 0 ${SIZE} ${SIZE}`} onPointerDown={addPoint} aria-label={`${CH[ch].name} curve`}>
        {[1, 2, 3].map((k) => (
          <g key={k} className="curves-grid">
            <line x1={(k * SIZE) / 4} y1="0" x2={(k * SIZE) / 4} y2={SIZE} />
            <line x1="0" y1={(k * SIZE) / 4} x2={SIZE} y2={(k * SIZE) / 4} />
          </g>
        ))}
        <line className="curves-diag" x1="0" y1={SIZE} x2={SIZE} y2="0" />
        {CURVE_CHANNELS.filter((id) => id !== ch && changed(id)).map((id) => (
          <path key={id} d={path(curves[id])} fill="none" stroke={CH[id].color} strokeOpacity="0.35" strokeWidth="1.5" />
        ))}
        <path d={path(pts)} fill="none" stroke={CH[ch].color} strokeWidth="2" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x * SIZE} cy={(1 - y) * SIZE} r="6" className="curves-pt" style={{ stroke: CH[ch].color }}
            onPointerDown={(e) => drag(e, i, pts)}
            onDoubleClick={(e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, k) => k !== i)); }} />
        ))}
      </svg>
      <div className="grade-actions">
        <button className="btn btn-ghost btn-sm" disabled={!changed(ch)} onClick={() => setPts(IDENTITY_CURVE)}><RotateCcw size={13} /> Reset {CH[ch].name.toLowerCase()}</button>
        <button className="btn btn-ghost btn-sm" disabled={!CURVE_CHANNELS.some(changed)} onClick={() => onChange({})}>Reset all</button>
      </div>
      <p className="dim small">Click the curve to add a point and drag it; double-click a point to remove it. Up brightens, down darkens; an S shape adds contrast.</p>
    </div>
  );
}
