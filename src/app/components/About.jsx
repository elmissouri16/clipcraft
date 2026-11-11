import React, { useEffect, useState } from 'react';
import { Github, X } from 'lucide-react';

// About ClipCraft: the version (the full package version, shown the same way on Home), what the app
// promises, and the source repository. There is no update check: new versions are
// published on the repository's Releases page, which the dialog links to.
export const REPO_URL = 'https://github.com/elmissouri16/clipcraft';

export function AboutDialog({ onClose }) {
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.api.appVersion?.().then(setVersion).catch(() => {});
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about about2">
        <button className="icon-btn about-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
        <div className="about-hero">
          <div className="about-halo"><img src="./logo.png" alt="" draggable={false} /></div>
          <h3 id="about-title">Clip<span className="grad">Craft</span></h3>
          <span className="about-vpill">{version ? `Version ${version}` : 'ClipCraft'}</span>
          <p className="about-tag">Cut it your way. A free video editor that works fully offline — no watermark, no account, and your videos never leave your PC.</p>
        </div>
        <div className="about-chips">
          <span>Works offline</span>
          <span>No watermark</span>
          <span>Free to use</span>
        </div>
        <div className="about-actions">
          <button className="btn" onClick={() => window.api.openHelp(`${REPO_URL}/releases`)}><Github size={14} /> Releases on GitHub</button>
          <button className="btn" onClick={() => window.api.openHelp(REPO_URL)}>Source code</button>
        </div>
      </div>
    </div>
  );
}
