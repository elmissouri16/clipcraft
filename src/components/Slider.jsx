import React from 'react';

// Range input whose whole drag becomes a single undo step.
// extra: optional controls shown after the label (e.g. keyframe buttons).
export default function Slider({ label, value, onChange, dispatch, min = 0, max = 1, step = 0.01, fmt, extra }) {
  const show = fmt ? fmt(value) : Number(value).toFixed(step >= 1 ? 0 : 2);
  return (
    <label className="field">
      <span>{label} {extra} <b>{show}</b></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onPointerDown={() => dispatch?.({ type: 'beginGesture' })}
        onPointerUp={() => dispatch?.({ type: 'endGesture' })}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
