import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import Dropdown from './Dropdown.jsx';

const EFFORT_LABELS = Object.assign(Object.create(null), { none: 'None', off: 'Off', on: 'On', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra', persistent: 'Persistent' });

// The model badge is also the quick picker. Changes apply to the next message;
// only the active provider's model preference is written by the main process.
export default function CraftModelPicker({ config, disabled, onSaved, onSavingChange }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [capability, setCapability] = useState(null);
  const [effortLoading, setEffortLoading] = useState(false);
  const [effortError, setEffortError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);
  const [custom, setCustom] = useState('');
  const [refresh, setRefresh] = useState(0);
  const root = useRef(null);
  const badge = useRef(null);
  const pending = useRef(false);
  const provider = config?.provider;
  const executablePath = config?.executablePath;

  useEffect(() => {
    if (!open || !provider) return;
    let alive = true;
    setLoading(true);
    setModels([]);
    setCached(false);
    setError('');
    setCustom('');
    window.api.aiModels({ provider, executablePath }).then((catalog) => {
      if (!alive) return;
      if (!catalog.ok) { setError(catalog.error || 'Could not load models. Enter a model ID below.'); return; }
      setModels(catalog.models || []);
      setCached(!!catalog.fromCache);
    }).catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, provider, executablePath, refresh]);

  useEffect(() => {
    if (!open || !provider) return;
    let alive = true;
    setCapability(null); setEffortError(''); setEffortLoading(true);
    window.api.aiModelCapabilities({ provider, model: config.modelId, executablePath, refresh: refresh > 0 }).then((result) => {
      if (!alive) return;
      if (result.ok) setCapability(result);
      else setEffortError(result.error || 'Could not check thinking levels.');
    }).catch((err) => { if (alive) setEffortError(err.message); })
      .finally(() => { if (alive) setEffortLoading(false); });
    return () => { alive = false; };
  }, [open, provider, config?.modelId, executablePath, refresh]);

  useEffect(() => {
    if (!open) return;
    const outside = (event) => { if (!pending.current && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const saveChoice = async (write, close) => {
    if (disabled || pending.current || !config) return;
    pending.current = true;
    setSaving(true);
    onSavingChange(true);
    setError('');
    try {
      const result = await write();
      if (!result.ok) { setError(result.error || 'Could not save this selection.'); return; }
      onSaved(result.settings);
      if (close) { setOpen(false); badge.current?.focus(); }
    } catch (err) { setError(err.message); }
    finally {
      pending.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };
  const choose = (id) => saveChoice(() => window.api.settingsSetModel(provider, id), true);
  const chooseEffort = (effort) => saveChoice(() => window.api.settingsSetReasoningEffort(provider, config.modelId, effort), false);

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !pending.current) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); badge.current?.focus();
    }
    if (event.target.getAttribute('role') !== 'option' || !event.target.closest('.pilot-model-options')) return;
    const options = [...root.current.querySelectorAll('.pilot-model-options [role=option]')];
    const index = options.indexOf(event.target);
    const next = event.key === 'ArrowDown' ? (index + 1) % options.length
      : event.key === 'ArrowUp' ? (index - 1 + options.length) % options.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
    if (next !== null) { event.preventDefault(); options[next]?.focus(); }
  };
  const choices = [...new Set([...(config?.modelId ? [config.modelId] : []), ...models])];
  const efforts = capability?.reasoningEfforts || [];
  return (
    <div ref={root} className="pilot-model-wrap" onKeyDown={onKeyDown}>
      <button ref={badge} className="pilot-model" type="button" disabled={disabled || saving || !config}
        title={config ? `${config.provider} · ${config.model}${config.reasoningEffort ? ` · ${EFFORT_LABELS[config.reasoningEffort] || config.reasoningEffort} thinking` : ''} — choose model and thinking level` : 'Loading AI settings'}
        aria-label="Choose AI model" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span>{config?.model || 'Choose model'}</span><ChevronDown size={12} />
      </button>
      {open && (
        <section className="pilot-model-menu" role="dialog" aria-label="AI model selection">
          <div className="pilot-model-menu-head">
            <b>Choose model</b>
            <button className="icon-btn" type="button" aria-label="Refresh AI models" disabled={loading || saving}
              onClick={() => setRefresh((value) => value + 1)}>
              {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="pilot-model-options" role="listbox" aria-label="Available AI models">
            {[{ id: '', label: config.sdk ? 'Default from installed CLI' : 'Provider default' },
              ...choices.map((id) => ({ id, label: id }))].map(({ id, label }) => (
              <button key={id} type="button" role="option" disabled={saving}
                aria-selected={config.modelId === id} onClick={() => choose(id)}>
                <span>{label}</span>{config.modelId === id && <Check size={14} />}
              </button>
            ))}
          </div>
          {loading && <small className="muted">Loading models…</small>}
          {!loading && cached && <small className="muted">Choices from the CLI’s cached catalog.</small>}
          {(
            <div className="pilot-effort-control">
              <label>Thinking effort</label>
              <Dropdown ariaLabel="Thinking effort" value={config.reasoningEffort || ''}
                disabled={saving || (effortLoading && !config.reasoningEffort) || (!efforts.length && !config.reasoningEffort)}
                options={[
                  { value: '', label: config.sdk ? 'CLI default' : 'Default' },
                  ...efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] || effort })),
                  ...(config.reasoningEffort && !efforts.includes(config.reasoningEffort)
                    ? [{ value: config.reasoningEffort, label: `${EFFORT_LABELS[config.reasoningEffort] || config.reasoningEffort} (unavailable)`, disabled: true }] : []),
                ]} onChange={chooseEffort} />
              {effortLoading && <small className="muted">Checking allowed thinking levels…</small>}
              {effortError && <small className="pilot-model-error" role="alert">{effortError}</small>}
              {!effortLoading && !effortError && !efforts.length && <small className="muted">{capability?.note || 'This model has no reported thinking options.'}</small>}
              {!effortLoading && efforts.length > 0 && <small className="muted">Allowed for this model · saved separately for each provider and model.</small>}
            </div>
          )}
          {error && <p className="pilot-model-error" role="alert">{error}</p>}
          <form className="pilot-model-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) choose(custom.trim()); }}>
            <input type="text" aria-label="Custom AI model ID" value={custom} disabled={saving} spellCheck={false}
              placeholder="Custom model ID" onChange={(event) => setCustom(event.target.value)} />
            <button type="submit" className="btn btn-sm" disabled={saving || !custom.trim()}>
              {saving ? <Loader2 size={13} className="spin" /> : 'Use'}
            </button>
          </form>
          <small className="muted">Applies to your next message. Saved automatically.</small>
        </section>
      )}
    </div>
  );
}
