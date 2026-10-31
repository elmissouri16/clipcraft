import React, { useEffect, useRef } from 'react';
import { Save } from 'lucide-react';

// Asked when the window closes with a project that never had a file. onChoice('save' | 'discard' | 'cancel').
// Enter saves, Escape cancels.
export default function CloseDialog({ name, onChoice }) {
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
        <h3 id="close-title">Save “{String(name || 'Untitled').slice(0, 80)}” before closing?</h3>
        <p id="close-text" className="muted">This project was never saved. If you close without saving, your changes are lost.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => onChoice('cancel')}>Cancel</button>
          <button className="btn" onClick={() => onChoice('discard')}>Don't save</button>
          <button ref={saveBtn} className="btn btn-primary" onClick={() => onChoice('save')}><Save size={14} /> Save</button>
        </div>
      </div>
    </div>
  );
}
