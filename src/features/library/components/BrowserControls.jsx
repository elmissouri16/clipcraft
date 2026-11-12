import React, { useId, useState } from 'react';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import SearchBox from '../../../components/ui/SearchBox.jsx';
import Dropdown from '../../../components/ui/Dropdown.jsx';
import { t } from '../../../i18n/index.js';

export const CREDIT_OPTIONS = [
  { value: 'cc0', label: t('browser.no_credit_required_cc0') },
  { value: 'attribution', label: t('browser.include_credit_required_media_cc_by') },
];
export const creditSummary = value => value === 'attribution' ? t('browser.cc0_plus_credit_required_media') : t('browser.no_credit_required_cc0_summary');

export function BrowserField({ label, value, options, onChange, ariaLabel = label }) {
  return <div className="browser-field"><span>{label}</span><Dropdown value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} /></div>;
}

export default function BrowserControls({ query, onQuery, onSearch, placeholder, ariaLabel, navigation, summary, children, onReset, disabled = false }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="browser-controls">
    <div className="browser-toolbar">
      <form onSubmit={e => { e.preventDefault(); onSearch?.(); }} className="browser-search">
        <SearchBox value={query} onChange={onQuery} placeholder={placeholder} ariaLabel={ariaLabel} />
        {onSearch && <button type="submit" className="icon-btn browser-submit" aria-label={t('browser.run_search')} title={t('browser.search')} disabled={disabled}><ArrowRight size={15} /></button>}
      </form>
      {children && <button className={`btn btn-sm browser-filter-toggle ${open ? 'on' : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><SlidersHorizontal size={14} /><span>{t('audio-fx.filters')}</span></button>}
    </div>
    {navigation}
    <div className="browser-summary">{summary}</div>
    {children && open && <div id={id} className="browser-filters">
      {children}
      {onReset && <button className="btn btn-sm" onClick={onReset}>{t('browser.reset_filters')}</button>}
    </div>}
  </div>;
}
