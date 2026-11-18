import React, { useEffect, useState } from 'react';
import { Github, X } from 'lucide-react';
import { t } from '../../i18n/index.js';

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
        <button className="icon-btn about-close" aria-label={t('app.close')} onClick={onClose}><X size={16} /></button>
        <div className="about-hero">
          <div className="about-halo"><img src="./logo.svg" alt="" draggable={false} /></div>
          <h3 id="about-title">Clip<span className="grad">Craft</span></h3>
          <span className="about-vpill">{version ? t('home.version', { version }) : 'ClipCraft'}</span>
          <p className="about-tag">{t('about.cut_it_your_way_a_free_video_editor_that_w')}</p>
        </div>
        <div className="about-chips">
          <span>{t('about.works_offline')}</span>
          <span>{t('about.no_watermark')}</span>
          <span>{t('about.free_to_use')}</span>
        </div>
        <div className="about-actions">
          <button className="btn" onClick={() => window.api.openHelp(`${REPO_URL}/releases`)}><Github size={14} /> {t('about.releases_on_github')}</button>
          <button className="btn" onClick={() => window.api.openHelp(REPO_URL)}>{t('about.source_code')}</button>
        </div>
      </div>
    </div>
  );
}
