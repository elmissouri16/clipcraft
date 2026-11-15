import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Users } from 'lucide-react';
import { SUBAGENT_LIMITS } from '../../../../shared/subagents.mjs';
import { t } from '../../../i18n/index.js';
import Dropdown from '../../../components/ui/Dropdown.jsx';

// Delegation preferences share the Settings value. Persist a narrow patch before
// allowing another message; never write a model/credential snapshot from here.
export default function SubagentControl({ config, disabled, onSaved, onSavingChange }) {
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const root = useRef(null), button = useRef(null), pending = useRef(false), currentProvider = useRef(config?.provider);
  currentProvider.current = config?.provider;
  useEffect(() => { if (disabled && !pending.current) setOpen(false); }, [disabled]);
  useEffect(() => { setOpen(false);setError(''); }, [config?.provider]);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!pending.current && !root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  if (!config?.sdk) return null;
  const concurrency = config.subagentConcurrency || SUBAGENT_LIMITS.concurrent;
  const save = async patch => {
    if (disabled || pending.current) return;
    const provider = config.provider;pending.current = true;setSaving(true);setError('');onSavingChange(true);
    try {
      const result = await window.api.settingsSetSubagents(provider, patch);
      if (currentProvider.current !== provider) return;
      if (!result.ok) throw Error(result.error || t('pilot.could_not_save_this_selection'));
      onSaved(result.settings);
    } catch (e) { if (currentProvider.current === provider) setError(e.message); }
    finally { pending.current = false;setSaving(false);onSavingChange(false); }
  };
  return <div className="pilot-subagents-wrap" ref={root} onKeyDown={e => {
    if (e.key === 'Escape' && !pending.current) { e.preventDefault();e.stopPropagation();setOpen(false);button.current?.focus(); }
  }}>
    <button type="button" ref={button} className={`pilot-subagents-button${config.subagents ? ' is-enabled' : ''}`} disabled={disabled || saving}
      aria-label={t('subagents.controls')} aria-haspopup="dialog" aria-expanded={open}
      title={config.subagents ? t('subagents.composer_on', { count: concurrency }) : t('subagents.composer_off')} onClick={() => setOpen(value => !value)}>
      {saving ? <Loader2 size={14} className="spin" /> : <Users size={14} />}<span>{config.subagents ? concurrency : t('pilot.off')}</span><ChevronDown size={10} />
    </button>
    {open && <section className="pilot-subagents-menu" role="dialog" aria-label={t('subagents.controls')}>
      <label className="pilot-subagents-toggle"><b>{t('subagents.setting')}</b><input type="checkbox" className="switch" aria-label={t('subagents.setting')}
        checked={!!config.subagents} disabled={saving} onChange={e => save({ enabled: e.target.checked })} /></label>
      <div className="pilot-subagents-limit"><span>{t('subagents.concurrency')}</span><Dropdown ariaLabel={t('subagents.concurrency')} value={concurrency} disabled={saving}
        onChange={concurrency => save({ concurrency })} options={Array.from({ length: SUBAGENT_LIMITS.maxConcurrent }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} /></div>
      <small>{t('subagents.concurrency_hint')}</small><small>{t('pilot.applies_to_your_next_message_saved')}</small>
      {error && <p className="pilot-model-error" role="alert">{error}</p>}
    </section>}
  </div>;
}
