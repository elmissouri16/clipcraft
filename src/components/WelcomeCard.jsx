import React, { useEffect } from 'react';

// First-run welcome (B3, 2026-11-01 — replaces the multi-step onboarding tour):
// ONE card on a dimmed editor backdrop — the ClipCraft logo, a greeting, one line,
// and a single "Start creating" button. It shows exactly once, on the first entry
// into a project (App owns the trigger and the persisted seen flag, unchanged from
// the tour's semantics); dismissing it runs the same close path the tour used, so
// whatever chained off the tour (the Creator Pack prompt) still chains off this.
export default function WelcomeCard({ onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="welcome-root" role="dialog" aria-modal="true" aria-label="Welcome to ClipCraft">
      <div className="welcome-dim" />
      <div className="welcome-card">
        <span className="welcome-halo"><img src="./logo.png" alt="" draggable={false} /></span>
        <h3>Welcome to ClipCraft</h3>
        <p>Import your clips, cut them your way, and export — all on your PC.</p>
        <button className="btn btn-primary welcome-go" autoFocus onClick={onClose}>Start creating</button>
      </div>
    </div>
  );
}
