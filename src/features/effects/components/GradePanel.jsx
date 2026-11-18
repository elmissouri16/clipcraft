import {useCreativePacks,preferredPackLuts} from '../../plugins/creativeRegistry.js';
import React, { useState } from 'react';
import { CurvesPanel, HslPanel } from './HslCurves.jsx';
import NumBox from "../../../components/ui/NumBox.jsx";
import Scopes from './Scopes.jsx';
import { Loader2, RotateCcw, Wand2 } from 'lucide-react';
import { autoGrade } from "../autocolor.js";
import { DEFAULT_ADJUST } from '../effects.js';
import { DEFAULT_GRADE, GRADE_GROUPS } from "../grade.js";
import { BUNDLED_LUTS, LUT_CREDIT_URL, loadLut, lutKey } from "../lut.js";
import { rich, t } from '../../../i18n/index.js';
import { catalogName } from '../../../i18n/catalog.js';

// One grade row: name, a slider (colored track for Temp / Tint / Saturation), a number box.
function Row({ item, value, onChange, dispatch }) {
  const pct = ((value - item.min) / (item.max - item.min)) * 100;
  return (
    <div className="grade-row">
      <div className="grade-top">
        <span>{item.name}</span>
        <NumBox className="grade-numbox" ariaLabel={t('inspector.name_value', { name: item.name })} step={1} min={item.min} max={item.max} value={value}
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
  const creative=useCreativePacks();
  const preferred=preferredPackLuts(),retained=creative.luts.find(l=>l.digest===lut?.ref?.pluginDigest&&l.id===lut?.ref?.assetId);
  const packLuts=[...preferred,...(retained&&!preferred.some(l=>l.digest===retained.digest&&l.id===retained.id)?[{...retained,ref:lut.ref}]:[])];
  const [error, setError] = React.useState('');
  const [imported, setImported] = React.useState([]);
  const current = lut && lut.ref ? lutKey(lut.ref) : '';
  const own = [...imported, ...(lut?.ref?.path && !imported.some((x) => x.path === lut.ref.path) ? [{ path: lut.ref.path, name: lut.name }] : [])];
  const pick = async (ref, name) => {
    setError('');
    if (!ref) return onChange(null);
    const res = await loadLut(ref);
    if (res.error) return setError(res.error);
    const packed=creative.luts.find(l=>l.digest===ref.pluginDigest&&l.id===ref.assetId);
    onChange({ ref, name, intensity: lut?.intensity ?? 100,...(packed?{dependency:{pluginId:packed.pluginId,digest:packed.digest,version:packed.version,id:packed.id,name:packed.name}}:{}) });
  };
  const choose = (key) => {
    if (key === '') return pick(null);
    const packed=packLuts.find(l=>lutKey(l.ref)===key);if(packed)return pick(packed.ref,packed.name);
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
          <option value="">{t('grade.none')}</option>
          <optgroup label="slay">
            {BUNDLED_LUTS.map((b) => <option key={b.file} value={lutKey(b.ref)}>{catalogName('lut', b)}</option>)}
          </optgroup>
          {!!packLuts.length&&<optgroup label={t('plugins.title')}>{packLuts.map(l=><option key={lutKey(l.ref)} value={lutKey(l.ref)}>{l.name} — {l.pluginName}</option>)}</optgroup>}
          {own.length > 0 && (
            <optgroup label={t('grade.imported')}>
              {own.map((o) => <option key={o.path} value={`p:${o.path}`}>{o.name}</option>)}
            </optgroup>
          )}
        </select>
        <button className="btn btn-sm" onClick={importOne} title={t('grade.use_your_own_3d_lut_cube')}>{t('grade.import_cube')}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {current && (
        <div className="grade-row">
          <div className="grade-top">
            <span>{t('grade.intensity')}</span>
            <NumBox className="grade-numbox" ariaLabel={t('grade.lut_intensity_value')} step={1} min={0} max={100} value={k}
              onChange={(v) => onChange({ ...lut, intensity: Math.round(v) })}
              onDragStart={() => dispatch?.({ type: 'beginGesture' })} onDragEnd={() => dispatch?.({ type: 'endGesture' })} />
          </div>
          <input type="range" className="grade-range" min="0" max="100" step="1" value={k} aria-label={t('grade.lut_intensity')}
            style={{ '--track': `linear-gradient(90deg, var(--primary) ${k}%, var(--surface-4) ${k}%)` }}
            onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
            onChange={(e) => onChange({ ...lut, intensity: Number(e.target.value) })} />
        </div>
      )}
      {lut?.ref?.bundled && (
        <p className="dim small">{rich('grade.luts_by_slay_cc_by_4_0', {}, { a: (s) => <button className="link-inline" type="button" onClick={() => window.api.openHelp(LUT_CREDIT_URL)}>{s}</button> })}</p>
      )}
    </section>
  );
}

// Adjust > Basic: Color, Lightness and Effects, plus the older Hue / Blur settings.
// grade / adjust: the clip's values; onGrade / onAdjust get the whole new object.
// autoFrom: { media, clip } of the clip, for the Auto button (left out where there is no single clip).
export default function GradePanel({ grade = {}, adjust = {}, onGrade, onAdjust, dispatch, onApplyAll, autoFrom }) {
  const [tab, setTab] = useState('basic');
  const [auto, setAuto] = useState(null); // 'busy' | { error }
  const g = { ...DEFAULT_GRADE, ...grade };
  const tabs = (
    <div className="seg-tabs small grade-tabs" role="tablist" aria-label={t('grade.adjust')}>
      {[['basic', t('clip.basic')], ['hsl', 'HSL'], ['curves', t('grade.curves')]].map(([id, name]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}</button>
      ))}
    </div>
  );
  const apply = onApplyAll && (
    <div className="grade-actions">
      <button className="btn btn-sm" onClick={onApplyAll} title={t('grade.give_every_clip_of_the_main_and_overlay_tr')}>{t('grade.apply_to_all')}</button>
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
  const classic = [['brightness', t('grade.brightness'), -1, 1, 0.01], ['contrast', t('grade.contrast_classic'), 0, 2, 0.01], ['saturation', t('grade.saturation_classic'), 0, 3, 0.01]]
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
      {/* One toolbar row: the automatic correction on the left, reset/apply on the right. */}
      <div className="grade-toolbar">
      {canAuto && (
        <div className="grade-auto">
          <button className="btn btn-sm btn-primary" onClick={runAuto} disabled={auto === 'busy'}
            title={t('grade.looks_at_the_clip_and_corrects_white_balan')}>
            {auto === 'busy' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} {t('grade.auto_color')}
          </button>
          {auto?.error && <span className="error-text small">{auto.error}</span>}
        </div>
      )}
      <div className="grade-actions">
        <button className="btn btn-ghost btn-sm" disabled={!changed} onClick={() => { onGrade({ hsl: g.hsl, curves: g.curves }); onAdjust({}); }}><RotateCcw size={13} /> {t('grade.reset_all')}</button>
        {onApplyAll && <button className="btn btn-sm" onClick={onApplyAll} title={t('grade.give_every_clip_of_the_main_and_overlay_tr_2')}>{t('grade.apply_to_all')}</button>}
      </div>
      </div>
      <LutSection lut={g.lut} dispatch={dispatch} onChange={(lut) => onGrade({ ...g, lut })} />
      <div className="grade-group">
        <div className="grade-group-title">{t('grade.scopes')}</div>
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
        <div className="grade-title">{t('grade.other')}</div>
        {[['hue', t('grade.hue'), -180, 180, 1], ['blur', t('grade.blur'), 0, 20, 0.5], ...classic].map(([k, name, min, max, step]) => (
          <div key={k} className="grade-row">
            <div className="grade-top"><span>{name}</span><b className="grade-val">{Number(a[k]).toFixed(step >= 1 ? 0 : 2)}{k === 'hue' ? '°' : ''}</b></div>
            <input type="range" className="grade-range" min={min} max={max} step={step} value={a[k]} aria-label={name}
              style={{ '--track': `linear-gradient(90deg, var(--primary) ${((a[k] - min) / (max - min)) * 100}%, var(--surface-4) ${((a[k] - min) / (max - min)) * 100}%)` }}
              onPointerDown={() => dispatch?.({ type: 'beginGesture' })} onPointerUp={() => dispatch?.({ type: 'endGesture' })}
              onDoubleClick={() => onAdjust({ ...a, [k]: DEFAULT_ADJUST[k] })} onChange={(e) => onAdjust({ ...a, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </section>
      <p className="dim small">{t('grade.double_click_a_slider_to_set_it_back_to_0')}</p>
    </div>
  );
}
