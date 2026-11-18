import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import Dropdown from '../../../components/ui/Dropdown.jsx';
import LibraryImagePicker from '../../library/components/LibraryImagePicker.jsx';
import { GRAPHIC_DATA_PAGE_SIZE as PAGE, graphicDataField, graphicDataType, newGraphicDataValue } from '../../graphics/graphicData.js';
import { graphicInputError } from '../../graphics/graphicInputs.js';
import { t } from '../../../i18n/index.js';

const DataContext = createContext(null);
const TYPES = ['text', 'number', 'boolean', 'object', 'array', 'null'];
const typeOptions = () => TYPES.map(value => ({ value, label: t(`graphic.data_type_${value}`) }));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const displayLabel = (key, field) => key === 'dob' && !field.declaration.label ? t('graphic.birth_date') : field.label;

function NumberInput({ value, field, path, label, onChange }) {
  const { report } = useContext(DataContext), [text, setText] = useState(String(value ?? ''));
  const valid = raw => raw.trim() !== '' && Number.isFinite(Number(raw)) ? graphicInputError(field, Number(raw)) : t('graphic.enter_number');
  const error = valid(text);
  useEffect(() => { setText(String(value ?? '')); }, [value]);
  useEffect(() => () => report(path, ''), [path, report]);
  return <div className="graphic-data-number"><input type="number" step={field.step} min={field.min} max={field.max}
    aria-label={label} aria-invalid={!!error} value={text} onChange={event => {
      const next = event.target.value, problem = valid(next);
      setText(next); report(path, problem); if (!problem) onChange(Number(next));
    }} onBlur={() => { if (error) setText(String(value ?? '')); report(path, ''); }}/>
    {field.slider && <input type="range" min={field.min} max={field.max} step={field.step} value={error ? field.min : Number(text)} aria-label={t('graphic.name_slider',{name:label})}
      onChange={event => { const next=event.target.value; setText(next); report(path,''); onChange(Number(next)); }}/>}
    {field.unit && <span>{field.unit}</span>}
    {error && <small className="graphic-data-error">{error}</small>}
  </div>;
}

function Pagination({ page, count, setPage }) {
  const pages = Math.ceil(count / PAGE);
  if (pages <= 1) return null;
  return <div className="graphic-data-pagination">
    <button type="button" className="btn btn-sm btn-ghost" disabled={!page} onClick={() => setPage(page - 1)}>{t('graphic.previous_page')}</button>
    <span>{t('graphic.data_page', { page: page + 1, pages })}</span>
    <button type="button" className="btn btn-sm btn-ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('graphic.next_page')}</button>
  </div>;
}

function Branch({ label, count, initialOpen = false, children }) {
  const [open, setOpen] = useState(initialOpen);
  return <div className="graphic-data-branch">
    <button type="button" className="graphic-data-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
      <strong>{label}</strong><span className="graphic-data-count">{count}</span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div className="graphic-data-children">{children()}</div>}
  </div>;
}

function AddProperty({ value, onChange }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [type, setType] = useState('text');
  const duplicate = name.trim() && has(value, name.trim());
  if (!open) return <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}><Plus size={12}/>{t('graphic.add_field')}</button>;
  return <div className="graphic-data-new-property">
    <input type="text" autoFocus aria-label={t('graphic.field_name')} placeholder={t('graphic.field_name')} value={name} aria-invalid={!!duplicate} onChange={event => setName(event.target.value)}/>
    <Dropdown value={type} options={typeOptions()} ariaLabel={t('graphic.value_type')} onChange={setType}/>
    <div className="settings-actions"><button type="button" className="btn btn-sm" disabled={!name.trim() || !!duplicate} onClick={() => {
      onChange({ ...value, [name.trim()]: newGraphicDataValue({ type }) }); setName(''); setOpen(false);
    }}>{t('graphic.add_field')}</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>{t('app.cancel')}</button></div>
    {duplicate && <small role="alert" className="graphic-data-error">{t('graphic.field_exists')}</small>}
  </div>;
}

function ObjectFields({ value, field, onChange, path, trail }) {
  const [requested, setPage] = useState(0);
  const keys = useMemo(() => [...new Set([...Object.keys(value), ...Object.keys(field.fields)])], [value, field.fields]);
  const page = Math.min(requested, Math.max(0, Math.ceil(keys.length / PAGE) - 1));
  return <div className="graphic-data-object">
    {keys.slice(page * PAGE, (page + 1) * PAGE).map(key => {
      const child = graphicDataField(key, field.fields[key], value[key]), childPath = JSON.stringify([path, key]);
      return <div className="graphic-data-property" key={key}>
        {has(value, key) ? <Node value={value[key]} declaration={field.fields[key]} label={displayLabel(key, child)} path={childPath} trail={trail}
          onChange={next => onChange({ ...value, [key]: next })}/>
          : <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ ...value, [key]: newGraphicDataValue(field.fields[key]) })}><Plus size={12}/>{displayLabel(key, child)}</button>}
        {field.additionalProperties && !has(field.fields, key) && <button type="button" className="icon-btn sm graphic-data-delete-field" aria-label={t('graphic.remove_field', { name: child.label })}
          onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)))}><X size={12}/></button>}
      </div>;
    })}
    <Pagination page={page} count={keys.length} setPage={setPage}/>
    {field.additionalProperties && <AddProperty value={value} onChange={onChange}/>}
  </div>;
}

function ListEntry({ value, declaration, title, index, fresh, path, trail, onChange, onRemove, onMove, canRemove, count }) {
  const [open, setOpen] = useState(index === 0 || fresh), root = useRef(null);
  const complex = value !== null && typeof value === 'object';
  useEffect(() => { if (fresh) root.current?.querySelector('input,textarea')?.focus(); }, [fresh]);
  return <div ref={root} className="graphic-data-entry" data-data-entry>
    <div className="graphic-data-entry-head">
      {complex ? <button type="button" className="graphic-data-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="graphic-record-number">{index + 1}</span><strong>{title}</strong><ChevronDown size={14} aria-hidden="true"/>
      </button> : <span className="graphic-data-entry-number">{index + 1}</span>}
      <div className="graphic-data-entry-actions">
        <button type="button" className="icon-btn sm" disabled={!index} aria-label={t('graphic.move_entry_up', { number: index + 1 })} onClick={() => onMove(-1)}><ArrowUp size={12}/></button>
        <button type="button" className="icon-btn sm" disabled={index + 1 === count} aria-label={t('graphic.move_entry_down', { number: index + 1 })} onClick={() => onMove(1)}><ArrowDown size={12}/></button>
        <button type="button" className="icon-btn sm" disabled={!canRemove} aria-label={t('graphic.remove_row', { row: index + 1 })} onClick={onRemove}><Trash2 size={12}/></button>
      </div>
    </div>
    {(!complex || open) && <div className="graphic-data-entry-body"><Node value={value} declaration={declaration} label={title} path={path} trail={trail} onChange={onChange} root={complex}/></div>}
  </div>;
}

function ListFields({ value, field, onChange, path, trail }) {
  const [requested, setPage] = useState(0), [fresh, setFresh] = useState(null), [newType, setNewType] = useState('text');
  const identity = useRef({ keys: [], next: 0 });
  while (identity.current.keys.length < value.length) identity.current.keys.push(identity.current.next++);
  identity.current.keys.length = value.length;
  const page = Math.min(requested, Math.max(0, Math.ceil(value.length / PAGE) - 1));
  const sample = value.find(item => item != null) ?? field.declaration.default?.find?.(item => item != null);
  const unknown = !field.items && sample === undefined;
  const add = () => {
    const id = identity.current.next++; identity.current.keys.push(id); setFresh(id); setPage(Math.floor(value.length / PAGE));
    onChange([...value, newGraphicDataValue(unknown ? { type: newType } : field.items, sample)]);
  };
  return <div className="graphic-data-list">
    {value.slice(page * PAGE, (page + 1) * PAGE).map((item, at) => {
      const index = page * PAGE + at, id = identity.current.keys[index];
      const caption = item && typeof item === 'object' && !Array.isArray(item)
        ? [field.itemLabel, 'name', 'label', 'title'].filter(Boolean).map(key => item[key]).find(text => typeof text === 'string' && text.trim()) : '';
      const title = caption || t('graphic.data_item', { number: index + 1 });
      return <ListEntry key={id} value={item} declaration={field.items} title={title} index={index} count={value.length} fresh={id === fresh}
        path={JSON.stringify([path, id])} trail={`${index + 1}${trail ? ' · ' + trail : ''}`} canRemove={value.length > field.minItems} onChange={next => onChange(value.map((previous, at) => at === index ? next : previous))}
        onRemove={() => { identity.current.keys.splice(index, 1); onChange(value.filter((_, at) => at !== index)); }} onMove={direction => {
          const next = [...value], keys = identity.current.keys, target = index + direction;
          [next[index], next[target]] = [next[target], next[index]]; [keys[index], keys[target]] = [keys[target], keys[index]];
          setPage(Math.floor(target / PAGE)); onChange(next);
        }}/>;
    })}
    {!value.length && <p className="graphic-record-empty">{t('graphic.no_entries')}</p>}
    <Pagination page={page} count={value.length} setPage={setPage}/>
    <div className="graphic-data-list-add">
      {unknown && <Dropdown value={newType} options={typeOptions()} ariaLabel={t('graphic.new_entry_type')} onChange={setNewType}/>}
      <button type="button" className="btn btn-sm" disabled={value.length >= field.maxItems} onClick={add}><Plus size={12}/>{t('graphic.add_entry')}</button>
    </div>
  </div>;
}

function Node({ value, declaration, label, path, onChange, root = false, trail = '' }) {
  const { media } = useContext(DataContext), field = graphicDataField(label, declaration, value);
  const actual = graphicDataType(value), collection = actual === 'object' || actual === 'array';
  const accessible = trail ? `${label} · ${trail}` : label;
  let control;
  if (value == null) {
    const known = declaration?.type && !['json', 'null'].includes(declaration.type);
    control = known ? <button type="button" className="btn btn-sm" onClick={() => {
      const { default: _default, ...descriptor } = declaration; onChange(newGraphicDataValue(descriptor));
    }} aria-label={`${t('graphic.set_value')}: ${accessible}`}>{t('graphic.set_value')}</button> : <Dropdown value="null" options={typeOptions()} ariaLabel={accessible}
      onChange={type => onChange(newGraphicDataValue({ type }))}/>;
  } else if (collection && field.type !== 'point') {
    const nestedTrail = root ? trail : accessible;
    const body = () => actual === 'array' ? <ListFields value={value} field={field} onChange={onChange} path={path} trail={nestedTrail}/>
      : <ObjectFields value={value} field={field} onChange={onChange} path={path} trail={nestedTrail}/>;
    return <div className="graphic-data-container">{root ? body() : <Branch label={label} count={actual === 'array' ? value.length : Object.keys(value).length}>{body}</Branch>}
      {field.nullable && <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('graphic.clear_value')}: ${accessible}`} onClick={() => onChange(null)}>{t('graphic.clear_value')}</button>}
      {!root && field.description && <small className="graphic-data-description">{field.description}</small>}</div>;
  } else if (field.type === 'image') control = <LibraryImagePicker media={media} value={value} label={accessible} onChange={onChange}/>;
  else if (field.type === 'choice' || field.type === 'select') control = <Dropdown value={value} options={field.options} ariaLabel={accessible} onChange={onChange}/>;
  else if (field.type === 'point') control = <div className="graphic-point">{['x', 'y'].map(axis => <NumberInput key={axis} value={value[axis]} field={{...field,type:'number'}} path={JSON.stringify([path,axis])}
    label={`${accessible} ${axis.toUpperCase()}`} onChange={number => onChange({ ...value, [axis]: number })}/>)}</div>;
  else if (field.type === 'number' || actual === 'number') control = <NumberInput value={value} field={{...field,type:'number'}} path={path} label={accessible} onChange={onChange}/>;
  else if (field.type === 'boolean' || actual === 'boolean') control = <input type="checkbox" checked={value === true} aria-label={accessible} onChange={event => onChange(event.target.checked)}/>;
  else if (field.type === 'color') control = <div className="graphic-color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} aria-label={accessible} onChange={event => onChange(event.target.value)}/><input type="text" value={value} aria-label={t('inspector.name_value',{name:accessible})} onChange={event => onChange(event.target.value)}/></div>;
  else if (field.control === 'textarea') control = <textarea rows={3} value={value} aria-label={accessible} onChange={event => onChange(event.target.value)}/>;
  else control = <input type={field.type === 'date' ? 'date' : 'text'} value={value} aria-label={accessible} onChange={event => onChange(event.target.value)}/>;
  return <div className={`${root ? 'graphic-data-root-leaf' : 'graphic-record-field'} graphic-data-leaf`}>{!root && <span>{label}</span>}<div className="graphic-data-control">{control}</div>
    {field.nullable && value !== null && <button type="button" className="btn btn-sm btn-ghost graphic-data-clear" aria-label={`${t('graphic.clear_value')}: ${accessible}`} onClick={() => onChange(null)}>{t('graphic.clear_value')}</button>}
    {!root && field.description && <small className="graphic-data-description">{field.description}</small>}
  </div>;
}

export default function GraphicDataField({ value, declaration, label, media = [], onChange, onValidity, advanced = true }) {
  const [raw, setRaw] = useState(false), [text, setText] = useState(''), errors = useRef(new Map());
  const validity = useRef(onValidity); validity.current = onValidity;
  const report = useCallback((path, error) => {
    if ((errors.current.get(path) || '') === error) return;
    if (error) errors.current.set(path, error); else errors.current.delete(path);
    validity.current([...errors.current.values()][0] || '');
  }, []);
  const context = useMemo(() => ({ media, report }), [media, report]);
  return <DataContext.Provider value={context}><div className="graphic-data-editor" data-graphic-data={label}>
    {!raw && <Node value={value} declaration={declaration} label={label} path="root" root onChange={onChange}/>}
    {advanced && <details className="graphic-data-advanced" open={raw} onToggle={event => {
      const next = event.currentTarget.open; if (next === raw) return;
      if (next) {
        try { setText(JSON.stringify(value ?? null, null, 2)); }
        catch { setText(''); report('json',t('graphic.enter_valid_json')); }
      }
      else report('json', '');
      setRaw(next);
    }}><summary>{t('graphic.edit_json_advanced')}</summary>
      {raw && <textarea className="graphic-json" rows={6} value={text} aria-label={label} aria-invalid={errors.current.has('json')} spellCheck={false}
        onChange={event => {
          setText(event.target.value);
          try { const parsed = JSON.parse(event.target.value); report('json',''); onChange(parsed); }
          catch { report('json',t('graphic.enter_valid_json')); }
        }} />}
    </details>}
  </div></DataContext.Provider>;
}
