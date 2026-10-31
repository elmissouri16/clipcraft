import React, { useEffect, useRef } from 'react';

// A yes / no question in ClipCraft's style. Enter confirms, Escape or a click outside cancels.
export default function ConfirmDialog({ icon: Icon, title, text, confirmLabel = 'OK', cancelLabel = 'Cancel', onConfirm, onCancel, extra }) {
  const ok = useRef(null);
  useEffect(() => {
    ok.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className="modal close-modal">
        {Icon && <div className="modal-icon"><Icon size={24} /></div>}
        <h3 id="confirm-title">{title}</h3>
        {text && <p className="muted">{text}</p>}
        {extra}
        <div className="modal-actions">
          {onCancel && <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>}
          <button ref={ok} className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
