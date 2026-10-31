import React, { useState } from 'react';
import { CurvesPanel, HslPanel } from './HslCurves.jsx';
import NumBox from './NumBox.jsx';
import Scopes from './Scopes.jsx';
import { Loader2, RotateCcw, Wand2 } from 'lucide-react';
import { autoGrade } from '../fx/autocolor.js';
import { DEFAULT_ADJUST } from '../effects.js';
import { DEFAULT_GRADE, GRADE_GROUPS } from '../fx/grade.js';
import { BUNDLED_LUTS, LUT_CREDIT_URL, loadLut, lutKey } from '../fx/lut.js';

// One CapCut-style row: name, a slider (colored track for Temp / Tint / Saturation), a number box.
function Row({ item, value, onChange, dispatch }) {
  const pct = ((value - item.min) / (item.max - item.min)) * 100;
  return (
    <div className="grade-row">
      <div className="grade-top">
        <span>{item.name}</span>
        <NumBox className="grade-numbox" ariaLabel={`${item.name} value`} step={1} min={item.min} max={item.max} value={value}
          onChange={(v) => onChange(Math.round(v))}
          onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
      </div>
      <input type="range" className={`grade-range ${item.track ? 'colored' : ''}`} min={item.min} max={item.max} step="1" value={value}
        aria-label={item.name} style={{ '--track': item.track || `linear-gradient(90deg, var(--primary) ${pct}%, var(--surface-4) ${pct}%)` }}
        onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
        onDoubleClick={() => onChange(0)} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

// LUT: a bundled look or the user's own .cube file, with an intensity.
function LutSection({ lut, onChange, dispatch }) {
  const [error, setError] = React.useState('');
  const [imported, setImported] = React.useState([]);
  const current = lut && lut.ref ? lutKey(lut.ref) : '';
  const own = [...imported, ...(lut?.ref?.path && !imported.some((x) => x.path === lut.ref.path) ? [{ path: lut.ref.path, name: lut.name }] : [])];
  const pick = async (ref, name) => {
    setError('');
    if (!ref) return onChange(null);
    const res = await loadLut(ref);
    if (res.error) return setError(res.error);
    onChange({ ref, name, intensity: lut?.intensity ?? 100 });
  };
  const choose = (key) => {
    if (key === '') return pick(null);
    const b = BUNDLED_LUTS.find((x) => lutKey(x.ref) === key);
    if (b) return pick(b.ref, b.name);
    const o = own.find((x) => `p:${x.path}` === key);
    if (o) return pick({ path: o.path }, o.name);
    return null;
  };
  const importOne = async () => {
    const f = await window.api.importLut();
    if (!f) return;
    setImported((l) => [...l.filter((x) => x.path !== f.path), f]);
    pick({ path: f.path }, f.name);
  };
  const k = lut?.intensity ?? 100;
  return (
    <section className="grade-group">
      <div className="grade-title">LUT</div>
      <div className="lut-row">
        <select value={current} aria-label="LUT" onChange={(e) => choose(e.target.value)}>
          <option value="">None</option>
          <optgroup label="slay">
            {BUNDLED_LUTS.map((b) => <option key={b.file} value={lutKey(b.ref)}>{b.name}</option>)}
          </optgroup>
          {own.length > 0 && (
            <optgroup label="Imported">
              {own.map((o) => <option key={o.path} value={`p:${o.path}`}>{o.name}</option>)}
            </optgroup>
          )}
        </select>
        <button className="btn btn-sm" onClick={importOne} title="Use your own 3D LUT (.cube)">Import .cube</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {current && (
        <div className="grade-row">
          <div className="grade-top">
            <span>Intensity</span>
            <NumBox className="grade-numbox" ariaLabel="LUT intensity value" step={1} min={0} max={100} value={k}
              onChange={(v) => onChange({ ...lut, intensity: Math.round(v) })}
              onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
          </div>
          <input type="range" className="grade-range" min="0" max="100" step="1" value={k} aria-label="LUT intensity"
            style={{ '--track': `linear-gradient(90deg, var(--primary) ${k}%, var(--surface-4) ${k}%)` }}
            onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
            onChange={(e) => onChange({ ...lut, intensity: Number(e.target.value) })} />
        </div>
      )}
      {lut?.ref?.bundled && (
        <p className="dim small">LUTs by <button className="link-inline" type="button" onClick={() => window.api.openHelp(LUT_CREDIT_URL)}>slay</button> (CC BY 4.0).</p>
      )}
    </section>
  );
}

// Adjust > Basic: Color, Lightness and Effects like CapCut, plus the older Hue / Blur settings.
// grade / adjust: the clip's values; onGrade / onAdjust get the whole new object.
// autoFrom: { media, clip } of the clip, for the Auto button (left out where there is no single clip).
export default function GradePanel({ grade = {}, adjust = {}, onGrade, onAdjust, dispatch, onApplyAll, autoFrom }) {
  const [tab, setTab] = useState('basic');
  const [auto, setAuto] = useState(null); // 'busy' | { error }
  const g = { ...DEFAULT_GRADE, ...grade };
  const tabs = (
    <div className="seg-tabs small grade-tabs" role="tablist" aria-label="Adjust">
      {[['basic', 'Basic'], ['hsl', 'HSL'], ['curves', 'Curves']].map(([id, name]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}</button>
      ))}
    </div>
  );
  const apply = onApplyAll && (
    <div className="grade-actions">
      <button className="btn btn-sm" onClick={onApplyAll} title="Give every clip of the main and overlay tracks these settings (Basic, HSL and Curves)">Apply to all</button>
    </div>
  );
  if (tab === 'hsl') {
    return <div className="grade">{tabs}<HslPanel hsl={g.hsl} dispatch={dispatch} onChange={(hsl) => onGrade({ ...g, hsl })} />{apply}</div>;
  }
  if (tab === 'curves') {
    return <div className="grade">{tabs}<CurvesPanel curves={g.curves} dispatch={dispatch} onChange={(curves) => onGrade({ ...g, curves })} />{apply}</div>;
  }
  const a = { ...DEFAULT_ADJUST, ...adjust };
  const changed = Object.values(grade).some((v) => Number(v)) || Object.keys(adjust).length > 0;
  // The first version's sliders: kept for projects that use them.
  const classic = [['brightness', 'Brightness', -1, 1, 0.01], ['contrast', 'Contrast (classic)', 0, 2, 0.01], ['saturation', 'Saturation (classic)', 0, 3, 0.01]]
    .filter(([k]) => a[k] !== DEFAULT_ADJUST[k]);
  // Auto: reads a few frames of the clip and sets Temp, Tint, Exposure, Contrast, Highlight, Shadow and
  // Saturation (one undo step; the other sliders, HSL, curves and the LUT stay as they are).
  const m = autoFrom?.media;
  const canAuto = m && (m.type === 'video' || m.type === 'image');
  const runAuto = async () => {
    setAuto('busy');
    const c = autoFrom.clip;
    const res = await window.api.colorSample({ path: m.path, type: m.type, duration: m.duration, hdr: m.hdr }, c.in || 0, c.out ?? m.duration);
    if (res.error) return setAuto({ error: res.error });
    setAuto(null);
    onGrade({ ...g, ...autoGrade(res.frames) });
  };
  return (
    <div className="grade">
      {tabs}
      {canAuto && (
        <div className="grade-auto">
          <button className="btn btn-sm btn-primary" onClick={runAuto} disabled={auto === 'busy'}
            title="Looks at the clip and corrects white balance, light, contrast and color. You can fine-tune the sliders after.">
            {auto === 'busy' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Auto color
          </button>
          {auto?.error && <span className="error-text small">{auto.error}</span>}
        </div>
      )}
      <div className="grade-actions">
        <button className="btn btn-ghost btn-sm" disabled={!changed} onClick={() => { onGrade({ hsl: g.hsl, curves: g.curves }); onAdjust({}); }}><RotateCcw size={13} /> Reset all</button>
        {onApplyAll && <button className="btn btn-sm" onClick={onApplyAll} title="Give every clip of the main and overlay tracks these settings">Apply to all</button>}
      </div>
      <LutSection lut={g.lut} dispatch={dispatch} onChange={(lut) => onGrade({ ...g, lut })} />
      <div className="grade-group">
        <div className="grade-group-title">Scopes</div>
        <Scopes />
      </div>
      {GRADE_GROUPS.map((group) => (
        <section key={group.name} className="grade-group">
          <div className="grade-title">{group.name}</div>
          {group.items.map((item) => (
            <Row key={item.id} item={item} value={g[item.id]} dispatch={dispatch} onChange={(v) => onGrade({ ...g, [item.id]: v })} />
          ))}
        </section>
      ))}
      <section className="grade-group">
        <div className="grade-title">Other</div>
        {[['hue', 'Hue', -180, 180, 1], ['blur', 'Blur', 0, 20, 0.5], ...classic].map(([k, name, min, max, step]) => (
          <div key={k} className="grade-row">
            <div className="grade-top"><span>{name}</span><b className="grade-val">{Number(a[k]).toFixed(step >= 1 ? 0 : 2)}{k === 'hue' ? '°' : ''}</b></div>
            <input type="range" className="grade-range" min={min} max={max} step={step} value={a[k]} aria-label={name}
              style={{ '--track': `linear-gradient(90deg, var(--primary) ${((a[k] - min) / (max - min)) * 100}%, var(--surface-4) ${((a[k] - min) / (max - min)) * 100}%)` }}
              onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
              onDoubleClick={() => onAdjust({ ...a, [k]: DEFAULT_ADJUST[k] })} onChange={(e) => onAdjust({ ...a, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </section>
      <p className="dim small">Double-click a slider to set it back to 0.</p>
    </div>
  );
}
