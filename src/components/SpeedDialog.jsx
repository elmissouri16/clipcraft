import React, { useState } from 'react';
import { Gauge } from 'lucide-react';
import { formatTime } from '../store.js';

// Speed / Duration for one clip (clip menu): the clip's constant speed, edited either as
// a percentage or as the timeline duration it should end up with. This is NOT speed
// ramping — the whole clip plays at the one rate, exactly like the inspector's Speed tab.
// A linked audio partner follows automatically (the store keeps pairs in sync).
const PRESETS = [25, 50, 75, 100, 125, 150, 200, 400];
const clampSpeed = (s) => Math.min(16, Math.max(0.05, s));

export default function SpeedDialog({ clip, name, onApply, onClose }) {
  const sourceLen = (clip.out - clip.in); // seconds of source the clip plays
  const cur = clip.speed || 1;
  const [pct, setPct] = useState(Math.round(cur * 100));
  const [dur, setDur] = useState((sourceLen / cur).toFixed(2));
  const speed = clampSpeed((Number(pct) || 100) / 100);

  const setFromPct = (v) => {
    setPct(v);
    const s = clampSpeed((Number(v) || 100) / 100);
    setDur((sourceLen / s).toFixed(2));
  };
  const setFromDur = (v) => {
    setDur(v);
    const d = Number(v);
    if (d > 0.01) setPct(Math.round((sourceLen / d) * 100));
  };

  return (
    <div className="modal-backdrop close-backdrop" role="dialog" aria-modal="true" aria-label="Speed and duration"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-icon"><Gauge size={26} /></div>
        <h3>Speed / Duration</h3>
        <p className="muted">{name}</p>
        <div className="speed-presets" role="group" aria-label="Speed presets">
          {PRESETS.map((p) => (
            <button key={p} className={`chip ${Number(pct) === p ? 'on' : ''}`} onClick={() => setFromPct(p)}>{p}%</button>
          ))}
        </div>
        <label className="field">
          <span>Speed (%)</span>
          <input type="number" min="5" max="1600" step="5" value={pct} aria-label="Speed in percent"
            onChange={(e) => setFromPct(e.target.value)} />
        </label>
        <label className="field">
          <span>Duration on the timeline</span>
          <input type="number" min="0.1" step="0.1" value={dur} aria-label="Duration in seconds"
            onChange={(e) => setFromDur(e.target.value)} />
        </label>
        <p className="muted">
          Source used: {formatTime(sourceLen)} · plays in {formatTime(sourceLen / speed)}
          {clip.linkId ? ' · the linked audio follows' : ''}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { onApply(speed); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
