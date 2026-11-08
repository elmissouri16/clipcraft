// The inspector's Graphic tab: a motion graphic's own fields, from the inputs its component declares
// (electron/graphics/runtime.js reports them; the editor never runs the code). Text, numbers,
// colours, on/off and data tables (series) get proper controls; anything else is JSON. Update
// draws the graphic again with the new values and swaps it in as one Undo step.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { clipLen } from '../../../state/store.js';
import { renderGraphicMedia, swapGraphicActions } from '../../graphics/graphicMedia.js';

const label = (key, spec) => spec?.label || key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const kindOf = (spec, value) => spec?.type || (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean'
  : typeof value === 'string' ? (/^#[0-9a-f]{6}$/i.test(value) ? 'color' : 'text') : Array.isArray(value) && value.every((r) => r && typeof r === 'object') ? 'series' : 'json');

function SeriesField({ rows, onChange }) {
  const cols = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 4), [rows]);
  const numeric = (c) => rows.some((r) => typeof r[c] === 'number');
  const set = (i, c, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [c]: numeric(c) ? (v === '' ? 0 : Number(v)) : v } : r)));
  return (
    <div className="graphic-series">
      <div className="graphic-series-row head">{cols.map((c) => <span key={c}>{c}</span>)}<span /></div>
      {rows.map((r, i) => (
        <div className="graphic-series-row" key={i}>
          {cols.map((c) => <input key={c} aria-label={`${c} ${i + 1}`} type={numeric(c) ? 'number' : 'text'} step="any" value={r[c] ?? ''} onChange={(e) => set(i, c, e.target.value)} />)}
          <button type="button" className="icon-btn sm" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c, numeric(c) ? 0 : '']))])}><Plus size={12} /> Add row</button>
    </div>
  );
}

function JsonField({ value, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 1));
  const [bad, setBad] = useState(false);
  return <textarea className={`graphic-json ${bad ? 'bad' : ''}`} rows={4} value={text} spellCheck={false}
    onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); } }} />;
}

export default function GraphicPanel({ clip, media, project, track, dispatch }) {
  const g = media.graphic, schema = g.schema && typeof g.schema === 'object' ? g.schema : null;
  const current = useMemo(() => ({ ...Object.fromEntries(Object.entries(schema || {}).map(([k, v]) => [k, v && typeof v === 'object' && 'default' in v ? v.default : v])), ...(g.inputs || {}) }), [schema, g.inputs]);
  const [draft, setDraft] = useState(current);
  const [duration, setDuration] = useState(() => Math.round(clipLen(clip) * 100) / 100);
  const [busy, setBusy] = useState(null); // { done, total } while drawing
  const [error, setError] = useState('');
  useEffect(() => window.api.onGraphicProgress?.((p) => { if (p.requestId === 'editor') setBusy({ done: p.done, total: p.total }); }), []);
  const changed = JSON.stringify(draft) !== JSON.stringify(current) || Math.abs(duration - clipLen(clip)) > 0.005;
  const keys = [...new Set([...Object.keys(schema || {}), ...Object.keys(current)])];

  const update = async () => {
    setError(''); setBusy({ done: 0, total: 1 });
    const out = await renderGraphicMedia({ api: window.api, project, code: g.code, inputs: draft, fonts: g.fonts || [], duration_sec: Number(duration), start_sec: clip.start || 0, name: media.name });
    setBusy(null);
    if (out.error) return setError(out.error);
    dispatch(swapGraphicActions(project, track, clip, out.media));
  };
  const field = (key) => {
    const value = draft[key], kind = kindOf(schema?.[key], value), set = (v) => setDraft((d) => ({ ...d, [key]: v }));
    if (kind === 'series') return <SeriesField rows={Array.isArray(value) ? value : []} onChange={set} />;
    if (kind === 'color') return <div className="graphic-color"><input type="color" aria-label={label(key, schema?.[key])} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => set(e.target.value)} /><input type="text" value={value ?? ''} onChange={(e) => set(e.target.value)} /></div>;
    if (kind === 'number') return <input type="number" step="any" aria-label={label(key, schema?.[key])} value={value ?? 0} onChange={(e) => set(e.target.value === '' ? 0 : Number(e.target.value))} />;
    if (kind === 'boolean') return <input type="checkbox" aria-label={label(key, schema?.[key])} checked={!!value} onChange={(e) => set(e.target.checked)} />;
    if (kind === 'text') return String(value ?? '').length > 48 ? <textarea rows={2} aria-label={label(key, schema?.[key])} value={value ?? ''} onChange={(e) => set(e.target.value)} />
      : <input type="text" aria-label={label(key, schema?.[key])} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    return <JsonField value={value} onChange={set} />;
  };

  return (
    <div className="graphic-panel">
      <p className="dim small">A motion graphic: change its text, data or look here and update it. Position, scale, fades and keyframes work like any overlay.</p>
      {!keys.length && <p className="dim small">This graphic declares no editable fields. Ask CraftAI to change it.</p>}
      {keys.map((key) => (
        <label className={`graphic-field ${kindOf(schema?.[key], draft[key]) === 'series' ? 'wide' : ''}`} key={key}>
          <span>{label(key, schema?.[key])}</span>{field(key)}
        </label>
      ))}
      <label className="graphic-field"><span>Duration (s)</span>
        <input type="number" min="0.2" max="60" step="0.1" aria-label="Graphic duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
      {error && <p className="graphic-error" role="alert">{error}</p>}
      <div className="graphic-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!changed || !!busy || !(duration >= 0.2 && duration <= 60)} onClick={update}>
          <RefreshCw size={13} className={busy ? 'spin' : ''} /> {busy ? `Drawing ${busy.total > 1 ? Math.round(busy.done / busy.total * 100) : 0}%` : 'Update graphic'}
        </button>
        <button type="button" className="btn btn-sm" disabled={!changed || !!busy} onClick={() => { setDraft(current); setDuration(Math.round(clipLen(clip) * 100) / 100); setError(''); }}><RotateCcw size={13} /> Reset</button>
      </div>
    </div>
  );
}
