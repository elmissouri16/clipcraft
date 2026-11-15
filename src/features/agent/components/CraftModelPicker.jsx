import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import Dropdown from "../../../components/ui/Dropdown.jsx";
import { t } from '../../../i18n/index.js';

const EFFORT_LABELS = Object.assign(Object.create(null), { none: t('grade.none'), off: t('pilot.off'), on: t('pilot.on'), minimal: t('pilot.minimal'), low: t('pilot.low'), medium: t('pilot.medium'), high: t('pilot.high'), xhigh: t('pilot.extra_high'), max: t('pilot.max'), ultra: t('pilot.ultra'), persistent: t('pilot.persistent') });

// The model badge is also the quick picker. Changes apply to the next message;
// only the active provider's model preference is written by the main process.
export default function CraftModelPicker({ config, disabled, onSaved, onSavingChange }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [modelLabels, setModelLabels] = useState({});
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
    window.api.aiModels({ provider, executablePath, refresh:refresh>0 }).then((catalog) => {
      if (!alive) return;
      if (!catalog.ok) { setError(catalog.error || t('pilot.could_not_load_models_enter_a_model_id')); return; }
      setModels(catalog.models || []);
      setModelLabels(catalog.modelLabels || {});
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
      else setEffortError(result.error || t('pilot.could_not_check_thinking_levels'));
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

  useEffect(() => { if (disabled && !pending.current) setOpen(false); }, [disabled]);

  const saveChoice = async (write, close) => {
    if (disabled || pending.current || !config) return;
    pending.current = true;
    setSaving(true);
    onSavingChange(true);
    setError('');
    try {
      const result = await write();
      if (!result.ok) { setError(result.error || t('pilot.could_not_save_this_selection')); return; }
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
        title={config ? config.reasoningEffort ? t('pilot.model_badge_with_thinking', { provider: config.providerName||config.provider, model: config.model, effort: EFFORT_LABELS[config.reasoningEffort] || config.reasoningEffort }) : t('pilot.model_badge', { provider: config.providerName||config.provider, model: config.model }) : t('pilot.loading_ai_settings')}
        aria-label={t('pilot.choose_ai_model')} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span>{config?.model || t('pilot.choose_model')}</span><ChevronDown size={12} />
      </button>
      {open && (
        <section className="pilot-model-menu" role="dialog" aria-label={t('pilot.ai_model_selection')}>
          <div className="pilot-model-menu-head">
            <b>{t('pilot.choose_model')}</b>
            <button className="icon-btn" type="button" aria-label={t('pilot.refresh_ai_models')} disabled={loading || saving}
              onClick={() => setRefresh((value) => value + 1)}>
              {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="pilot-model-options" role="listbox" aria-label={t('pilot.available_ai_models')}>
            {[{ id: '', label: config.sdk ? t('pilot.default_from_installed_cli') : t('pilot.provider_default') },
              ...choices.map((id) => ({ id, label: modelLabels[id] || id }))].map(({ id, label }) => (
              <button key={id} type="button" role="option" value={id} disabled={saving}
                aria-selected={config.modelId === id} onClick={() => choose(id)}>
                <span className="pilot-model-option-text"><span>{label}</span>{id && label !== id && <small>{id}</small>}</span>{config.modelId === id && <Check size={14} />}
              </button>
            ))}
          </div>
          {loading && <small className="muted">{t('pilot.loading_models')}</small>}
          {!loading && cached && <small className="muted">{t('pilot.choices_from_the_clis_cached_catalog')}</small>}
          {(
            <div className="pilot-effort-control">
              <label>{t('pilot.thinking_effort')}</label>
              <Dropdown ariaLabel={t('pilot.thinking_effort')} value={config.reasoningEffort || ''}
                disabled={saving || (effortLoading && !config.reasoningEffort) || (!efforts.length && !config.reasoningEffort)}
                options={[
                  { value: '', label: config.sdk ? t('pilot.cli_default') : t('pilot.default') },
                  ...efforts.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] || effort })),
                  ...(config.reasoningEffort && !efforts.includes(config.reasoningEffort)
                    ? [{ value: config.reasoningEffort, label: t('pilot.effort_unavailable', { effort: EFFORT_LABELS[config.reasoningEffort] || config.reasoningEffort }), disabled: true }] : []),
                ]} onChange={chooseEffort} />
              {effortLoading && <small className="muted">{t('pilot.checking_allowed_thinking_levels')}</small>}
              {effortError && <small className="pilot-model-error" role="alert">{effortError}</small>}
              {!effortLoading && !effortError && !efforts.length && <small className="muted">{capability?.note || t('pilot.this_model_has_no_reported_thinking_options')}</small>}
              {!effortLoading && efforts.length > 0 && <small className="muted">{t('pilot.allowed_for_this_model_saved_separately')}</small>}
            </div>
          )}
          {error && <p className="pilot-model-error" role="alert">{error}</p>}
          <form className="pilot-model-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) choose(custom.trim()); }}>
            <input type="text" aria-label={t('pilot.custom_ai_model_id')} value={custom} disabled={saving} spellCheck={false}
              placeholder={t('settings.custom_model_id')} onChange={(event) => setCustom(event.target.value)} />
            <button type="submit" className="btn btn-sm" disabled={saving || !custom.trim()}>
              {saving ? <Loader2 size={13} className="spin" /> : t('pilot.use')}
            </button>
          </form>
          <small className="muted">{t('pilot.applies_to_your_next_message_saved')}</small>
        </section>
      )}
    </div>
  );
}
