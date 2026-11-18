// The inspector's Graphic tab: a motion graphic's own fields, from the inputs its component declares
// (electron/graphics/runtime.js reports them; the editor never runs the code). Text, numbers,
// colours, choices, points, library pictures and data tables get proper controls; anything else is JSON. Valid edits
// are saved immediately; the player renders them live and the shared queue bakes them after editing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { clipLen, uid } from '../../../state/store.js';
import { graphicEdits } from '../../graphics/graphicEdits.js';
import { graphicInputDefaults, graphicInputField, graphicInputError } from '../../graphics/graphicInputs.js';
import { graphicDataError } from '../../graphics/graphicData.js';
import LibraryImagePicker from '../../library/components/LibraryImagePicker.jsx';
import GraphicDataField from './GraphicDataField.jsx';
import { t } from '../../../i18n/index.js';

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
  const [invalidInputs, setInvalidInputs] = useState({});
  const dataValidation = useRef(new Map());
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
    setDraft(clip.graphicDraft?.inputs || current); setDuration(Math.round(clipLen(clip) * 100) / 100); setInvalidInputs({}); setResetKey(n => n + 1);
  }, [clip.graphicDraft, media.id]);
  useEffect(() => {
    const up = () => { if (editing.current.dragging) { editing.current.dragging = false; finish(); } };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); finish(); };
  }, []);
  const keys = [...new Set([...Object.keys(schema || {}), ...Object.keys(current)])];
  const fields = Object.fromEntries(keys.map((key) => [key, graphicInputField(key, schema?.[key], draft[key])]));
  const structured = key => ['json', 'series', 'object', 'array'].includes(fields[key].type);
  const adaptive = key => structured(key) || fields[key].type === 'date' || schema?.[key]?.nullable === true
    || schema?.[key]?.default === null || schema?.[key]?.control === 'textarea';
  const keySet = new Set(keys);
  for (const key of dataValidation.current.keys()) if (!keySet.has(key)) dataValidation.current.delete(key);
  const errors = Object.fromEntries(keys.map(key => {
    let error;
    if (adaptive(key)) {
      const cached = dataValidation.current.get(key), declaration = schema?.[key];
      if (cached && Object.is(cached.value, draft[key]) && cached.declaration === declaration) error = cached.error;
      else { error = graphicDataError(draft[key], declaration); dataValidation.current.set(key, { value: draft[key], declaration, error }); }
    } else error = graphicInputError(fields[key], draft[key]);
    return [key, invalidInputs[key] || error];
  }));
  const invalid = Object.values(errors).some(Boolean);
  const validDuration = duration >= .2 && duration * (clip.speed || 1) >= .2 && duration * (clip.speed || 1) <= 60;
  const groups = new Map();
  for (const key of keys) { const group = fields[key].group; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(key); }

  const inputKey = useMemo(() => { try { return JSON.stringify(draft); } catch { return ''; } }, [draft]);
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
    if (adaptive(key)) return <GraphicDataField key={resetKey} value={value} declaration={schema?.[key]} label={label} media={project.media} advanced={structured(key)} onChange={set}
      onValidity={message => setInvalidInputs(old => old[key] === message ? old : ({ ...old, [key]: message }))}/>;
    if (kind === 'color') return <div className="graphic-color"><input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => set(e.target.value)} /><input type="text" aria-label={t('inspector.name_value', { name: label })} value={value ?? ''} onChange={(e) => set(e.target.value)} /></div>;
    if (kind === 'number') return <div className="graphic-number">
      {spec.slider && <input type="range" aria-label={t('graphic.name_slider', { name: label })} min={min} max={max} step={step} value={typeof value === 'number' ? value : min} onChange={(e) => set(numeric(e))} />}
      <div className="graphic-number-value">{number(value, set)}{spec.unit && <span>{spec.unit}</span>}</div>
    </div>;
    if (kind === 'point') return <div className="graphic-point">{['x', 'y'].map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span>{number(value?.[axis], (n) => set({ ...value, [axis]: n }), `${label} ${axis.toUpperCase()}`)}</label>)}</div>;
    if (kind === 'choice' || kind === 'select') return <select aria-label={label} value={spec.options.findIndex((option) => Object.is(option.value, value))} onChange={(e) => set(spec.options[Number(e.target.value)].value)}>
      {!spec.options.some((option) => Object.is(option.value, value)) && <option value={-1} disabled>{t('graphic.choose')}</option>}
      {spec.options.map((option, index) => <option key={index} value={index}>{option.label}</option>)}
    </select>;
    if (kind === 'image') return <LibraryImagePicker media={project.media} value={value ? String(value) : ''} onChange={set} label={label}/>;
    if (kind === 'boolean') return <input type="checkbox" aria-label={label} checked={!!value} onChange={(e) => set(e.target.checked)} />;
    if (kind === 'text' || kind === 'string') return String(value ?? '').length > 48 ? <textarea rows={2} aria-label={label} value={value ?? ''} onChange={(e) => set(e.target.value)} />
      : <input type="text" aria-label={label} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
    return <JsonField key={resetKey} value={value} label={label} onChange={set} onValidity={valid => setInvalidInputs(old => ({ ...old, [key]: valid ? '' : t('graphic.enter_valid_json') }))} />;
  };

  return (
    <div className="graphic-panel" onPointerDownCapture={e => { if (e.target.type === 'range') { editing.current.dragging = true; begin(); } }}>
      <p className="dim small">{t('graphic.changes_preview_live_and_save_automaticall')}</p>
      {!keys.length && <p className="dim small">{t('graphic.this_graphic_declares_no_editable_fields_a')}</p>}
      {[...groups].map(([group, groupKeys]) => <fieldset className="graphic-group" key={group}>
        {group && <legend>{group}</legend>}
        {groupKeys.map((key) => <div className={`graphic-field ${structured(key) ? 'wide' : ''}`} key={key}>
          <span>{fields[key].label}</span><div className="graphic-control">{field(key)}</div>
          {fields[key].description && <small className="graphic-field-help">{fields[key].description}</small>}
          {errors[key] && <small className="graphic-field-help graphic-error" role="alert">{errors[key]}</small>}
        </div>)}
      </fieldset>)}
      <label className="graphic-field"><span>{t('graphic.duration_s')}</span>
        <input type="number" min={Math.max(.2, .2 / (clip.speed || 1))} max={60 / (clip.speed || 1)} step="0.1" aria-label={t('graphic.graphic_duration')} value={duration} onChange={(e) => { changed(); setDuration(Number(e.target.value)); }} /></label>
      {!validDuration && <p className="graphic-error" role="alert">{t('graphic.choose_a_duration_within_the_supported_ran')}</p>}
      {(status.error || status.previewError) && <p className="graphic-error" role="alert">{status.error || status.previewError}</p>}
      <div className="graphic-actions">
        {status.error && <button type="button" className="btn btn-sm" onClick={() => graphicEdits.retry(clip.id)}><RefreshCw size={13} /> {t('graphic.retry_update')}</button>}
        <button type="button" className="btn btn-sm" onClick={() => { changed(); setDraft({ ...current, ...graphicInputDefaults(schema) }); setInvalidInputs({}); setResetKey((n) => n + 1); }}><RotateCcw size={13} /> {t('hsl-curves.reset')}</button>
      </div>
      <small className="dim graphic-status" role="status">{invalid ? t('graphic.fix_the_highlighted_fields_to_apply') : status.pending ? t('graphic.live_preview_preparing_full_quality') : t('graphic.up_to_date')}</small>
    </div>
  );
}
