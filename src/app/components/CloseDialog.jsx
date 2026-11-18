import React, { useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import { t } from '../../i18n/index.js';

// Asked when the window closes with a project that never had a file, or whose file could not be
// written (failed). onChoice('save' | 'discard' | 'cancel'). Enter saves, Escape cancels.
export default function CloseDialog({ name, failed, onChoice }) {
  const saveBtn = useRef(null);
  useEffect(() => {
    saveBtn.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onChoice('cancel'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoice]);
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-text"
      onMouseDown={(e) => e.target === e.currentTarget && onChoice('cancel')}>
      <div className="modal close-modal">
        <div className="modal-icon"><Save size={24} /></div>
        <h3 id="close-title">{t('close.save_name_before_closing', { name: String(name || t('home.untitled')).slice(0, 80) })}</h3>
        <p id="close-text" className="muted">{t(failed ? 'close.the_project_file_could_not_be_written' : 'close.this_project_was_never_saved_if_you_close')}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => onChoice('cancel')}>{t('app.cancel')}</button>
          <button className="btn" onClick={() => onChoice('discard')}>{t('close.dont_save')}</button>
          <button ref={saveBtn} className="btn btn-primary" onClick={() => onChoice('save')}><Save size={14} /> {t('close.save')}</button>
        </div>
      </div>
    </div>
  );
}
