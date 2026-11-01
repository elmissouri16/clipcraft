import React from 'react';
import { CheckCircle2, Download, Loader2, PackageOpen, X } from 'lucide-react';
import { PACK_CATEGORIES, cancelPackInstall, fmtMB, startPackInstall, usePack } from '../packClient.js';
import { refreshAssets } from '../useAssets.js';

// The standing Creator Pack offer inside panel empty states ("whenever he wants it, he
// finds it"): one row per category the pack feed offers and this panel cares about, with
// the feed's size, a download button, live progress while this client installs, and a
// plain result line. Props: categories — the pack category ids this place offers.
export default function PackOffer({ categories }) {
  const { manifest, install } = usePack();
  const wanted = PACK_CATEGORIES.filter((c) => categories.includes(c.id));
  if (manifest === undefined) {
    return <p className="empty-note"><Loader2 size={14} className="spin" /> Checking the free Creator Pack…</p>;
  }
  if (manifest === null) {
    return (
      <div className="pack-offer">
        <p className="empty-note"><PackageOpen size={14} /> The free Creator Pack is not available right now — it will be offered here when it is.</p>
      </div>
    );
  }
  const cats = manifest.categories || {};
  return (
    <div className="pack-offer">
      <p className="pack-offer-head"><PackageOpen size={14} /> <b>Free Creator Pack</b> <span className="muted">— download only what you want:</span></p>
      {wanted.map((c) => {
        const spec = cats[c.id];
        const live = install.cats[c.id];
        const res = install.results?.[c.id];
        const busy = install.running && live && !res;
        return (
          <div key={c.id} className="pack-offer-row">
            <span className="pack-offer-label">{c.label}{spec ? <span className="muted"> · {fmtMB(spec.size)}</span> : <span className="muted"> · not in this pack</span>}</span>
            {busy ? (
              <span className="pack-offer-state">
                {live.phase === 'downloading' ? `${fmtMB(live.received)} of ${fmtMB(live.total)}` : live.phase === 'verifying' ? 'Checking…' : 'Installing…'}
                <button className="btn btn-ghost btn-sm" onClick={cancelPackInstall}><X size={12} /> Cancel</button>
              </span>
            ) : res ? (
              res.ok
                ? <span className="pack-offer-state ok"><CheckCircle2 size={13} /> Installed</span>
                : <button className="btn btn-sm" disabled={!spec} onClick={() => startPackInstall([c.id]).then((r) => { if (r?.results?.[c.id]?.ok) refreshAssets(); })}>Try again</button>
            ) : (
              <button className="btn btn-sm" disabled={!spec || install.running}
                onClick={() => startPackInstall([c.id]).then((r) => { if (r?.results?.[c.id]?.ok) refreshAssets(); })}>
                <Download size={13} /> Download
              </button>
            )}
          </div>
        );
      })}
      {wanted.some((c) => install.results?.[c.id] && !install.results[c.id].ok && !install.results[c.id].canceled) && (
        <p className="error-text">{wanted.map((c) => install.results?.[c.id]).find((r) => r && !r.ok && !r.canceled)?.error}</p>
      )}
    </div>
  );
}
