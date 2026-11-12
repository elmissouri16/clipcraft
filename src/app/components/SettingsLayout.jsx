import React from 'react';

// Page and group primitives: every settings page is a header (what it is for)
// followed by small labelled groups, with page-level actions in a footer.
export function SettingsPage({ title, description, actions, children }) {
  return (
    <div className="set2-page">
      <header className="set2-page-head"><h4>{title}</h4>{description && <p>{description}</p>}</header>
      <div className="set2-page-body">{children}</div>
      {actions && <div className="set2-page-actions settings-actions">{actions}</div>}
    </div>
  );
}
export function SettingsGroup({ label, hint, aside, children, className = '' }) {
  return (
    <section className={`settings-section set2-group ${className}`}>
      {(label || hint || aside) && (
        <div className="set2-group-head">
          <div>{label && <h5 className="set2-group-label">{label}</h5>}{hint && <p className="set2-group-hint">{hint}</p>}</div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

