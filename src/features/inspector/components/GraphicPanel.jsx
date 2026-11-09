// The inspector's Graphic tab: a motion graphic's own fields, from the inputs its component declares
// (electron/graphics/runtime.js reports them; the editor never runs the code). Text, numbers,
// colours, choices, points and data tables get proper controls; anything else is JSON. Valid edits
// are saved immediately; the player renders them live and the shared queue bakes them after editing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { clipLen, uid } from '../../../state/store.js';
import { graphicEdits } from '../../graphics/graphicEdits.js';
import { graphicInputDefaults, graphicInputField, graphicInputError } from '../../graphics/graphicInputs.js';

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

function JsonField({ value, onChange, onValidity, label }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 1));
  const [bad, setBad] = useState(false);
  return <textarea aria-label={label} aria-invalid={bad} className={`graphic-json ${bad ? 'bad' : ''}`} rows={4} value={text} spellCheck={false}
    onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); onValidity(true); } catch { setBad(true); onValidity(false); } }} />;
}

export default function GraphicPanel({ clip, media, project, track, dispatch }) {
  const g = media.graphic, schema = g.schema && typeof g.schema === 'object' ? g.schema : null;
  const current = useMemo(() => ({ ...graphicInputDefaults(schema), ...(g.inputs || {}) }), [schema, g.inputs]);
  const [draft, setDraft] = useState(clip.graphicDraft?.inputs || current);
  const [duration, setDuration] = useState(() => Math.round(clipLen(clip) * 100) / 100);
  const [status, setStatus] = useState(() => graphicEdits.status(clip.id));
  const [invalidJson, setInvalidJson] = useState({});
  const [resetKey, setResetKey] = useState(0);
  const editing = useRef({ active: false, dragging: false, own: clip.graphicDraft });
  const lastMedia = useRef(media.id);
  const finish = () => { clearTimeout(editing.current.timer); if (editing.current.active) { editing.current.active = false; dispatch({ type: 'endGesture' }); } };
  const begin = () => { if (!editing.current.active) { editing.current.active = true; dispatch({ type: 'beginGesture' }); } };
  const changed = () => { begin(); clearTimeout(editing.current.timer); if (!editing.current.dragging) editing.current.timer = setTimeout(finish, 350); };
  useEffect(() => graphicEdits.subscribe(() => setStatus(graphicEdits.status(clip.id))), [clip.id]);
  useEffect(() => {
    if (clip.graphicDraft === editing.current.own && lastMedia.current === media.id) return;
    const ownBake = editing.current.own && !clip.graphicDraft && JSON.stringify(editing.current.own.inputs) === JSON.stringify(current)
      && Math.abs(editing.current.own.duration_sec - clipLen(clip)) < .005;
    lastMedia.current = media.id;
    editing.current.own = clip.graphicDraft;
    if (ownBake) return; // preserve focus and unfinished local input when the cache catches up
    setDraft(clip.graphicDraft?.inputs || current); setDuration(Math.round(clipLen(clip) * 100) / 100); setInvalidJson({}); setResetKey(n => n + 1);
  }, [clip.graphicDraft, media.id]);
  useEffect(() => {
    const up = () => { if (editing.current.dragging) { editing.current.dragging = false; finish(); } };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); finish(); };
  }, []);
  const keys = [...new Set([...Object.keys(schema || {}), ...Object.keys(current)])];
  const fields = Object.fromEntries(keys.map((key) => [key, graphicInputField(key, schema?.[key], draft[key])]));
  const errors = Object.fromEntries(keys.map((key) => [key, invalidJson[key] ? 'Enter valid JSON.' : graphicInputError(fields[key], draft[key])]));
  const invalid = Object.values(errors).some(Boolean);
  const validDuration = duration >= .2 && duration * (clip.speed || 1) >= .2 && duration * (clip.speed || 1) <= 60;
  const groups = new Map();
  for (const key of keys) { const group = fields[key].group; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(key); }

  const inputKey = JSON.stringify(draft);
  useEffect(() => {
    if (!editing.current.active || invalid || !validDuration) return;
    const previous = clip.graphicDraft;
    if (inputKey === JSON.stringify(previous?.inputs || current) && Math.abs(duration - clipLen(clip)) < .005) return;
    const graphicDraft = { inputs: draft, duration_sec: duration };
    editing.current.own = graphicDraft;
    dispatch({ type: 'batch', actions: [{ type: 'update', track, id: clip.id, patch: { graphicDraft, in: 0, out: duration * (clip.speed || 1) } },
      ...(track === 'overlay' ? [{ type: 'extendVideoTo', end: clip.start + duration, gapId: uid() }] : [])] });
  }, [inputKey, duration, invalid]);
  const field = (key) => {
    const value = draft[key], spec = fields[key], { type: kind, label, min, max, step } = spec;
    const set = (v) => { changed(); setDraft((d) => ({ ...d, [key]: v })); };
    const numeric = (e) => e.target.value === '' ? '' : Number(e.target.value);
    const number = (n, change, name = label) => <input type="number" min={min} max={max} step={step} aria-label={name} aria-invalid={!!errors[key]} value={n ?? ''} onChange={(e) => change(numeric(e))} />;
    if (kind === 'series') return <SeriesField rows={Array.isArray(value) ? value : []} onChange={set} />;
    if (kind === 'color') return <div className="graphic-color"><input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => set(e.target.value)} /><input type="text" aria-label={`${label} value`} value={value ?? ''} onChange={(e) => set(e.target.value)} /></div>;
    if (kind === 'number') return <div className="graphic-number">
      {spec.slider && <input type="range" aria-label={`${label} slider`} min={min} max={max} step={step} value={typeof value === 'number' ? value : min} onChange={(e) => set(numeric(e))} />}
      <div className="graphic-number-value">{number(value, set)}{spec.unit && <span>{spec.unit}</span>}</div>
    </div>;
    if (kind === 'point') return <div className="graphic-point">{['x', 'y'].map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span>{number(value?.[axis], (n) => set({ ...value, [axis]: n }), `${label} ${axis.toUpperCase()}`)}</label>)}</div>;
    if (kind === 'choice' || kind === 'select') return <select aria-label={label} value={spec.options.findIndex((option) => Object.is(option.value, value))} onChange={(e) => set(spec.options[Number(e.target.value)].value)}>
      {!spec.options.some((option) => Object.is(option.value, value)) && <option value={-1} disabled>Choose…</option>}
      {spec.options.map((option, index) => <option key={index} value={index}>{option.label}</option>)}
    </select>;
    if (kind === 'boolean') return <input type="checkbox" aria-label={label} checked={!!value} onChange={(e) => set(e.target.checked)} />;
    if (kind === 'text' || kind === 'string') return String(value ?? '').length > 48 ? <textarea rows={2} aria-label={label} value={value ?? ''} onChange={(e) => set(e.target.value)} />
      : <input type="text" aria-label={label} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    return <JsonField key={resetKey} value={value} label={label} onChange={set} onValidity={(valid) => setInvalidJson((old) => ({ ...old, [key]: !valid }))} />;
  };

  return (
    <div className="graphic-panel" onPointerDownCapture={e => { if (e.target.type === 'range') { editing.current.dragging = true; begin(); } }}>
      <p className="dim small">Changes preview live and save automatically. Position, scale, fades and keyframes work like any overlay.</p>
      {!keys.length && <p className="dim small">This graphic declares no editable fields. Ask CraftAI to change it.</p>}
      {[...groups].map(([group, groupKeys]) => <fieldset className="graphic-group" key={group}>
        {group && <legend>{group}</legend>}
        {groupKeys.map((key) => <div className={`graphic-field ${fields[key].type === 'series' ? 'wide' : ''}`} key={key}>
          <span>{fields[key].label}</span><div className="graphic-control">{field(key)}</div>
          {fields[key].description && <small className="graphic-field-help">{fields[key].description}</small>}
          {errors[key] && <small className="graphic-field-help graphic-error" role="alert">{errors[key]}</small>}
        </div>)}
      </fieldset>)}
      <label className="graphic-field"><span>Duration (s)</span>
        <input type="number" min={Math.max(.2, .2 / (clip.speed || 1))} max={60 / (clip.speed || 1)} step="0.1" aria-label="Graphic duration" value={duration} onChange={(e) => { changed(); setDuration(Number(e.target.value)); }} /></label>
      {!validDuration && <p className="graphic-error" role="alert">Choose a duration within the supported range.</p>}
      {(status.error || status.previewError) && <p className="graphic-error" role="alert">{status.error || status.previewError}</p>}
      <div className="graphic-actions">
        {status.error && <button type="button" className="btn btn-sm" onClick={() => graphicEdits.retry(clip.id)}><RefreshCw size={13} /> Retry update</button>}
        <button type="button" className="btn btn-sm" onClick={() => { changed(); setDraft({ ...current, ...graphicInputDefaults(schema) }); setInvalidJson({}); setResetKey((n) => n + 1); }}><RotateCcw size={13} /> Reset</button>
      </div>
      <small className="dim graphic-status" role="status">{invalid ? 'Fix the highlighted fields to apply changes.' : status.pending ? 'Live preview · preparing full quality…' : 'Up to date'}</small>
    </div>
  );
}
