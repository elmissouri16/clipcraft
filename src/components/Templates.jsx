import React, { useEffect, useState } from 'react';
import { BadgeCheck, Clapperboard, Film, LayoutTemplate, Loader2, Search, WifiOff, X } from 'lucide-react';
import SideNav, { TabFrame } from './SideNav.jsx';
import { formatTime, toFileUrl } from '../store.js';

// Templates tab. Two libraries: the BUNDLED templates that ship with ClipCraft (they live
// on disk and work fully offline), and the template STORE published on the web. Both open
// the same way: "Use template" turns one into a project whose replaceable clips you swap
// for your own videos (see SlotStrip).
const RATIOS = [['', 'All formats'], ['9:16', '9:16 Vertical'], ['16:9', '16:9 Landscape'], ['1:1', '1:1 Square'], ['4:5', '4:5 Portrait']];
const CLIPS = [['', 'Any clips'], ['1-3', '1-3 clips'], ['4-6', '4-6 clips'], ['7+', '7+ clips']];
const LENGTHS = [['', 'Any length'], ['short', 'Under 15 s'], ['medium', '15-60 s'], ['long', 'Over 1 min']];

// Categories are kept between visits of the tab (they come with every list).
const store = { categories: [] };

const len = (s) => (s >= 60 ? formatTime(s).slice(0, 5) : `${Math.round(s)}s`);

function Card({ t, onOpen }) {
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    let live = true;
    if (t.thumb) window.api.templatesThumb(t).then((p) => live && setThumb(p));
    return () => { live = false; };
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className={`tst-card r${t.ratio.replace(':', 'x')}`} onClick={() => onOpen(t)} title={t.title}>
      <span className="tst-thumb">
        {thumb ? <img src={toFileUrl(thumb)} alt="" draggable={false} /> : <LayoutTemplate size={22} />}
        <span className="tst-meta"><Clapperboard size={11} /> {t.clips} · {len(t.duration)}</span>
      </span>
      <span className="tst-title">{t.title}</span>
    </button>
  );
}

function BundledCard({ t, onOpen }) {
  const [hover, setHover] = useState(false);
  return (
    <button className={`tst-card tpl-card r${t.ratio.replace(':', 'x')}`} onClick={() => onOpen(t)} title={t.title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <span className="tst-thumb">
        {hover && t.preview
          ? <video src={toFileUrl(t.preview)} poster={t.thumb ? toFileUrl(t.thumb) : undefined} autoPlay muted loop playsInline aria-hidden="true" />
          : t.thumb ? <img src={toFileUrl(t.thumb)} alt="" draggable={false} /> : <LayoutTemplate size={22} />}
        <span className="tpl-offline"><BadgeCheck size={10} /> Offline</span>
        <span className="tst-meta"><Clapperboard size={11} /> {len(t.duration)} · {t.texts ?? 0} texts · {t.media ?? t.clips} media</span>
      </span>
      <span className="tst-title">{t.title}</span>
      <span className="tpl-card-cat">{t.category} · {t.ratio}</span>
      {t.tags?.length > 0 && (
        <span className="tpl-tags">{t.tags.map((g) => <span key={g} className="tpl-tag">{g}</span>)}</span>
      )}
    </button>
  );
}

function BundledDetail({ t, onClose, onUse }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tst-detail">
        <div className={`tst-player r${t.ratio.replace(':', 'x')}`}>
          {t.preview ? <video src={toFileUrl(t.preview)} poster={t.thumb ? toFileUrl(t.thumb) : undefined} autoPlay muted loop playsInline />
            : t.thumb ? <img src={toFileUrl(t.thumb)} alt="" draggable={false} /> : <LayoutTemplate size={26} />}
        </div>
        <div className="tst-info">
          <button className="icon-btn tst-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
          <h3 id="tpl-title">{t.title}</h3>
          <p className="tst-tags">{t.category} · bundled with ClipCraft</p>
          <p className="tst-details">{len(t.duration)} · {(t.ratio || '').replace(':', '×')} · {t.texts ?? 0} texts · {t.media ?? t.clips} media</p>
          {t.tags?.length > 0 && (
            <span className="tpl-tags">{t.tags.map((g) => <span key={g} className="tpl-tag">{g}</span>)}</span>
          )}
          <div className="tst-chips">
            <span>{t.clips} clip{t.clips > 1 ? 's' : ''}</span>
            <span>{len(t.duration)}</span>
            <span>{t.ratio}</span>
            <span>Works offline</span>
          </div>
          {t.description && <p className="muted">{t.description}</p>}
          <p className="muted small">You replace the {t.clips} highlighted clip{t.clips > 1 ? 's' : ''} with your own videos or photos; the cuts, text and music stay. The coloured clips are placeholders to show the framing.</p>
          <div className="tst-actions">
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); const ok = await onUse(t); setBusy(false); if (ok) onClose(); }}>
              {busy ? <Loader2 size={14} className="spin" /> : <Film size={14} />} Use template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ t, onClose, onUse }) {
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    window.api.templatesPreview(t).then((r) => { if (live) (r.error ? setError(r.error) : setVideo(r.path)); });
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tst-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tst-detail">
        <div className={`tst-player r${t.ratio.replace(':', 'x')}`}>
          {video ? <video src={toFileUrl(video)} controls autoPlay loop /> : error ? <p className="error-text">{error}</p> : <Loader2 size={26} className="spin" />}
        </div>
        <div className="tst-info">
          <button className="icon-btn tst-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
          <h3 id="tst-title">{t.title}</h3>
          {t.tags?.length > 0 && <p className="tst-tags">{t.tags.map((g) => `#${g}`).join(' ')}</p>}
          <div className="tst-chips">
            <span>{t.clips} clip{t.clips > 1 ? 's' : ''}</span>
            <span>{len(t.duration)}</span>
            <span>{t.ratio}</span>
            <span>{t.uses.toLocaleString('en-US')} used</span>
          </div>
          {t.description && <p className="muted">{t.description}</p>}
          <p className="muted small">You replace the {t.clips} highlighted clip{t.clips > 1 ? 's' : ''} with your own videos or photos; the cuts, effects, text and music stay.</p>
          <div className="tst-actions">
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); const ok = await onUse(t); setBusy(false); if (ok) onClose(); }}>
              {busy ? <Loader2 size={14} className="spin" /> : <Film size={14} />} Use template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatesTab({ sub, setSub, onUseTemplate }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ ratio: '', clips: '', length: '' });
  const [res, setRes] = useState({ templates: [], page: 0, pages: 0, loading: true, error: '' });
  const [categories, setCategories] = useState(store.categories);
  const [open, setOpen] = useState(null);
  const [bundled, setBundled] = useState([]);
  const [bundledTag, setBundledTag] = useState('All');
  const [bundledOpen, setBundledOpen] = useState(null);
  useEffect(() => {
    let live = true;
    window.api.templatesBundledList().then((r) => { if (live && !r.error) setBundled(r.templates); });
    return () => { live = false; };
  }, []);
  // The bundled chips filter by the tag taxonomy (AutoAE-style), in taxonomy order.
  const TAG_ORDER = ['Text Animation', 'Logo Animation', 'UI Animation', 'Engagement', 'Mockup', 'Process', 'Promo', 'Social'];
  const bundledTags = TAG_ORDER.filter((g) => bundled.some((t) => (t.tags || []).includes(g)));
  const bundledShown = bundled.filter((t) =>
    (bundledTag === 'All' || (t.tags || []).includes(bundledTag))
    && (!filters.ratio || t.ratio === filters.ratio)
    && (!q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase())));
  const category = sub.startsWith('cat:') ? sub.slice(4) : '';
  const load = async (page) => {
    setRes((r) => ({ ...r, loading: true, error: '', ...(page === 1 ? { templates: [] } : {}) }));
    const out = await window.api.templatesList({ q: q.trim(), category, ...filters, sort: sub === 'popular' ? 'popular' : '', page });
    if (out.error) return setRes((r) => ({ ...r, loading: false, error: out.error }));
    store.categories = out.categories;
    setCategories(out.categories);
    setRes((r) => ({ templates: page === 1 ? out.templates : [...r.templates, ...out.templates], page: out.page, pages: out.pages, loading: false, error: '' }));
  };
  useEffect(() => { load(1); }, [sub, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = (
    <SideNav value={sub} onChange={setSub} label="Template categories" items={[
      { id: 'all', label: 'For you' },
      { id: 'popular', label: 'Popular' },
      ...categories.map((c) => ({ id: `cat:${c.name}`, label: c.name })),
    ]} />
  );
  const filter = (key, options) => (
    <select value={filters[key]} aria-label={options[0][1]} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <TabFrame nav={nav}>
      <div className="pad-block">
        <form className="lib-search" onSubmit={(e) => { e.preventDefault(); load(1); }}>
          <Search size={14} aria-hidden="true" />
          <input type="search" value={q} placeholder="Search templates" aria-label="Search templates" onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => setQ('')}><X size={13} /></button>}
        </form>
        <div className="tst-filters">{filter('ratio', RATIOS)}{filter('clips', CLIPS)}{filter('length', LENGTHS)}</div>
        <div className="tpl-sec-head">
          <span className="tab-title">Bundled templates</span>
          <span className="tpl-offline"><BadgeCheck size={10} /> Works offline</span>
        </div>
        <div className="chips tpl-chips" role="group" aria-label="Bundled template tags">
          {['All', ...bundledTags].map((c) => (
            <button key={c} className={`chip ${bundledTag === c ? 'on' : ''}`} aria-pressed={bundledTag === c} onClick={() => setBundledTag(c)}>{c}</button>
          ))}
        </div>
        <div className="tst-grid">
          {bundledShown.map((t) => <BundledCard key={t.id} t={t} onOpen={setBundledOpen} />)}
        </div>
        {!bundledShown.length && <p className="empty-note">No bundled template matches.</p>}
        <div className="tpl-sec-head store">
          <span className="tab-title">{sub === 'popular' ? 'Popular' : category || 'For you'}</span>
          <span className="tpl-store-note">Template store · needs internet</span>
        </div>
        {res.error && (
          <div className="lib-error"><WifiOff size={15} /> <span>{res.error}</span> <button className="btn btn-sm" onClick={() => load(1)}>Retry</button></div>
        )}
        <div className="tst-grid">
          {res.templates.map((t) => <Card key={t.id} t={t} onOpen={setOpen} />)}
        </div>
        {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> Loading templates…</div>}
        {!res.loading && !res.error && !res.templates.length && <p className="empty-note">No template here yet{q.trim() ? ` for “${q.trim()}”` : ''}.</p>}
        {!res.loading && res.page < res.pages && <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>Load more</button>}
      </div>
      {open && <Detail t={open} onClose={() => setOpen(null)} onUse={onUseTemplate} />}
      {bundledOpen && <BundledDetail t={bundledOpen} onClose={() => setBundledOpen(null)} onUse={onUseTemplate} />}
    </TabFrame>
  );
}
