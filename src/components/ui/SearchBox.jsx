// The one panel search box: dark surface, inset icon, violet focus ring, and a clear (×)
// button whenever there is text. Every library/panel search uses this component so the
// styling can never drift back to the browser-default white box again.
import React from 'react';
import { Search, X } from 'lucide-react';
import { t } from '../../i18n/index.js';

export default function SearchBox({ value, onChange, placeholder, ariaLabel, autoFocus = false }) {
  return (
    <div className="searchbox">
      <Search size={14} className="searchbox-icon" aria-hidden="true" />
      <input type="search" value={value} placeholder={placeholder} aria-label={ariaLabel || placeholder}
        autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
      {!!value && (
        <button type="button" className="searchbox-clear" aria-label={t('search.clear_search')} title={t('search.clear_search')}
          onClick={() => onChange('')}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}
