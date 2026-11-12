import React, { useState } from 'react';
import { Gauge } from 'lucide-react';
import { formatTime } from "../../../state/store.js";
import { t } from '../../../i18n/index.js';

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
    <div className="modal-backdrop close-backdrop" role="dialog" aria-modal="true" aria-label={t('speed-dialog.speed_and_duration')}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-icon"><Gauge size={26} /></div>
        <h3>{t('speed-dialog.speed_duration')}</h3>
        <p className="muted">{name}</p>
        <div className="speed-presets" role="group" aria-label={t('speed-dialog.speed_presets')}>
          {PRESETS.map((p) => (
            <button key={p} className={`chip ${Number(pct) === p ? 'on' : ''}`} onClick={() => setFromPct(p)}>{p}%</button>
          ))}
        </div>
        <label className="field">
          <span>{t('speed-dialog.speed')}</span>
          <input type="number" min="5" max="1600" step="5" value={pct} aria-label={t('speed-dialog.speed_in_percent')}
            onChange={(e) => setFromPct(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('speed-dialog.duration_on_the_timeline')}</span>
          <input type="number" min="0.1" step="0.1" value={dur} aria-label={t('speed-dialog.duration_in_seconds')}
            onChange={(e) => setFromDur(e.target.value)} />
        </label>
        <p className="muted">
          {t(clip.linkId ? 'speed-dialog.source_used_plays_in_linked' : 'speed-dialog.source_used_plays_in', { source: formatTime(sourceLen), result: formatTime(sourceLen / speed) })}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t('app.cancel')}</button>
          <button className="btn btn-primary" onClick={() => { onApply(speed); onClose(); }}>{t('speed-dialog.apply')}</button>
        </div>
      </div>
    </div>
  );
}
