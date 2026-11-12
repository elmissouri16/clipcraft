import React from 'react';
import { PackageOpen } from 'lucide-react';
import { t } from '../../../i18n/index.js';

// Assets tab — placeholder (Hamza, 2026-11-02). The downloadable content pack
// is not part of the public release, so instead of the pack library and its
// download offers, the tab shows a simple "Coming soon" until a library ships.
// The folder-backed library implementation (useAssets / assetsLib) is kept in
// the codebase and still powers the pack's audio views; restoring this tab is
// a render change only.
export default function AssetsTab() {
  return (
    <div className="assets-tab">
      <div className="lib-head">
        <div>
          <h2>{t('assets-panel.assets')}</h2>
        </div>
      </div>
      <div className="assets-empty">
        <PackageOpen size={40} strokeWidth={1.5} aria-hidden="true" />
        <p><b>{t('assets-panel.coming_soon')}</b></p>
        <p className="muted">{t('assets-panel.a_built_in_library_of_transitions_overlays')}</p>
      </div>
    </div>
  );
}
