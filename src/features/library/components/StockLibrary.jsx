import { useEffect, useRef, useState } from 'react';
import { ExternalLink, KeyRound, Layers, Loader2, Plus, WifiOff } from 'lucide-react';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { FavStar, favStock } from "../../../app/favorites.jsx";

import BrowserControls, { BrowserField, CREDIT_OPTIONS, creditSummary } from './BrowserControls.jsx';
import { useBrowserState } from '../browserState.js';
import OpenverseNotice from './OpenverseNotice.jsx';
import { t } from '../../../i18n/index.js';

// Chip label -> { q, category } for Pixabay. Green screen, intros and the like are searches, not categories.
export const CHIPS = {
  video: [
    ['Trending', {}], ['Green screen', { q: 'green screen' }], ['Background', { q: 'background loop' }], ['Nature', { category: 'nature' }],
    ['Travel', { category: 'travel' }], ['City', { q: 'city' }], ['People', { category: 'people' }], ['Business', { category: 'business' }],
    ['Abstract', { q: 'abstract' }], ['Sky', { q: 'sky clouds' }], ['Ocean', { q: 'ocean' }], ['Particles', { q: 'particles' }],
    ['Food', { category: 'food' }], ['Sports', { category: 'sports' }], ['Animals', { category: 'animals' }], ['Technology', { category: 'computer' }],
  ],
  photo: [
    ['Trending', {}], ['Backgrounds', { category: 'backgrounds' }], ['Nature', { category: 'nature' }], ['Travel', { category: 'travel' }],
    ['People', { category: 'people' }], ['Business', { category: 'business' }], ['Food', { category: 'food' }], ['Animals', { category: 'animals' }],
    ['Places', { category: 'places' }], ['Buildings', { category: 'buildings' }], ['Sports', { category: 'sports' }], ['Fashion', { category: 'fashion' }],
    ['Technology', { category: 'computer' }], ['Music', { category: 'music' }], ['Science', { category: 'science' }], ['Feelings', { category: 'feelings' }],
  ],
};

// Shown names of the chips above; the chip ids stay English because they are stored in browser memory and navigation ids.
const CHIP_KEYS = {
  'Green screen': 'stock.green_screen', Background: 'inspector.background', Nature: 'stock.nature', Travel: 'stock.travel', City: 'stock.city',
  People: 'stock.people', Business: 'stock.business', Abstract: 'stock.abstract', Sky: 'stock.sky', Ocean: 'stock.ocean', Particles: 'stock.particles',
  Food: 'stock.food', Sports: 'stock.sports', Animals: 'stock.animals', Technology: 'stock.technology', Backgrounds: 'stock.backgrounds',
  Places: 'stock.places', Buildings: 'stock.buildings', Fashion: 'stock.fashion', Music: 'library.music', Science: 'stock.science', Feelings: 'stock.feelings',
};
const chipLabel = chip => (CHIP_KEYS[chip] ? t(CHIP_KEYS[chip]) : chip);

const thumbCache = new Map(); // remote thumbnail -> local file URL
export function Thumb({ url, alt }) {
  const [src, setSrc] = useState(thumbCache.get(url) || '');
  useEffect(() => {
    setSrc(thumbCache.get(url) || '');
    if (!url || thumbCache.has(url)) return undefined;
    let alive = true;
    window.api.stockThumb(url).then((r) => {
      if (!r.path) return;
      const u = toFileUrl(r.path);
      thumbCache.set(url, u);
      if (alive) setSrc(u);
    });
    return () => { alive = false; };
  }, [url]);
  return src ? <img src={src} alt={alt} draggable={false} /> : <div className="stock-ph" aria-hidden="true" />;
}

// Provider state lives outside the keyed browser, so each source retains its own search.
export default function StockLibrary(props) {
  const [prefs, setPrefs] = useBrowserState(props.browserMemory, 'stock:provider', { photo: 'openverse' });
  const provider = props.kind === 'photo' ? prefs.photo : 'pixabay';
  return <StockSearch key={`${props.kind}:${provider}`} {...props} provider={provider} onProvider={photo => setPrefs({ photo })} />;
}

function StockSearch({ onStockAdd, onOpenSettings, hasKey, kind = 'video', chip = 'Trending', provider, onProvider, onNavigate, browserMemory }) {
  const [state, patch] = useBrowserState(browserMemory, `stock:${kind}:${provider}`, { q: '', term: '', licenses: 'cc0', orientation: '' });
  const { q, term, licenses, orientation } = state;
  const canSearch = provider === 'openverse' || hasKey;
  const request = useRef(0);
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const [busy, setBusy] = useState({});
  const [addError, setAddError] = useState('');
  const preset = (CHIPS[kind].find(([c]) => c === chip) || CHIPS[kind][0])[1];
  const load = async page => {
    const seq = ++request.current;
    const words = [term.trim(), preset.q, provider === 'openverse' ? preset.category : ''].filter(Boolean).join(' ');
    const opts = { ...preset, ...(words ? { q: words } : {}) };
    setRes(r => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    try {
      const out = await window.api.stockSearch({ kind, provider, licenses, ...opts, orientation, page });
      if (seq !== request.current) return;
      if (out.error) return setRes(r => ({ ...r, loading: false, error: out.error }));
      setRes(r => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
    } catch (e) { if (seq === request.current) setRes(r => ({ ...r, loading: false, error: e.message })); }
  };
  useEffect(() => {
    if (canSearch) load(1);
    return () => { request.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, chip, orientation, canSearch, provider, licenses, term]);
  const add = async (item, where) => {
    setBusy(b => ({ ...b, [item.id]: true })); setAddError('');
    try { const r = await onStockAdd(item, where); if (r?.error) setAddError(r.error); }
    catch (e) { setAddError(e.message); }
    finally { setBusy(b => ({ ...b, [item.id]: false })); }
  };
  const source = provider === 'openverse' ? 'Openverse' : 'Pixabay';
  return <>
    <BrowserControls query={q} onQuery={q => patch({ q, ...(!q ? { term: '' } : {}) })} onSearch={() => term === q ? canSearch && load(1) : patch({ term: q })}
      placeholder={kind === 'video' ? t('stock.search_stock_videos') : t('stock.search_stock_photos')} ariaLabel={t('stock.search_stock_media')} disabled={!canSearch}
      navigation={<div className="seg-tabs browser-kinds" aria-label={t('stock.stock_kind')}>{[['video', t('stock.videos')], ['photo', t('stock.photos')]].map(([id, label]) => <button key={id} className={kind === id ? 'on' : ''} aria-pressed={kind === id} onClick={() => onNavigate(`${id}:${browserMemory?.get(`stock:category:${id}`) || 'Trending'}`)}>{label}</button>)}</div>}
      summary={<>{source}{provider === 'openverse' && ` · ${creditSummary(licenses)}`}{chip !== 'Trending' && ` · ${chipLabel(chip)}`}{orientation && ` · ${orientation === 'vertical' ? t('stock.portrait') : t('stock.landscape')}`}</>}
      onReset={() => { patch({ licenses: 'cc0', orientation: '' }); onNavigate(`${kind}:Trending`); }}>
      {kind === 'photo' && <BrowserField label={t('settings.provider')} ariaLabel={t('stock.photo_provider')} value={provider} onChange={onProvider} options={[{ value: 'openverse', label: t('stock.openverse_no_key_needed') }, { value: 'pixabay', label: 'Pixabay' }]} />}
      <BrowserField label={t('audio.category')} value={chip} onChange={value => onNavigate(`${kind}:${value}`)} options={CHIPS[kind].map(([value]) => ({ value, label: value === 'Trending' ? t('stock.all_categories') : chipLabel(value) }))} />
      {provider === 'openverse' && <BrowserField label={t('audio.copyright_attribution')} ariaLabel={t('stock.photo_licences')} value={licenses} onChange={licenses => patch({ licenses })} options={CREDIT_OPTIONS} />}
      {kind === 'photo' && <BrowserField label={t('stock.orientation')} value={orientation} onChange={orientation => patch({ orientation })} options={[{ value: '', label: t('stock.any_shape') }, { value: 'horizontal', label: t('stock.landscape') }, { value: 'vertical', label: t('stock.portrait') }]} />}
      {provider === 'openverse' && <p className="browser-filter-help">{t('audio.cc_by_includes_cc0_results_and_media_that')}</p>}
    </BrowserControls>
    {!canSearch ? <div className="card stock-key"><div className="card-row"><span className="card-icon"><KeyRound size={18} /></span><div><b>{t('stock.connect_pixabay')}</b><p>{kind === 'video' ? t('stock.add_a_pixabay_key_to_browse_videos') : t('stock.add_a_pixabay_key_to_browse_photos')}</p></div></div><div className="stock-key-actions"><button className="btn btn-sm" onClick={() => window.api.openHelp('https://pixabay.com/api/docs/')}><ExternalLink size={13} /> {t('audio.get_a_free_key')}</button><button className="btn btn-primary btn-sm" onClick={() => onOpenSettings?.('services:pixabay')}>{t('settings.add_api_key')}</button></div></div> : <>
      {res.error && <div className="lib-error"><WifiOff size={15} /><span>{res.error}</span><button className="btn btn-sm" onClick={() => load(1)}>{t('audio.retry')}</button></div>}
      {addError && <p className="error-text">{addError}</p>}
      <div className="stock-grid">{res.results.map(it => <StockCard key={it.id} item={it} busy={busy[it.id]} onAdd={where => add(it, where)} />)}</div>
      {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('settings.loading')}</div>}
      {!res.loading && !res.error && !res.results.length && <div className="browser-empty"><p>{t('stock.no_matches_on_source_with_filters', { source })}</p>{provider === 'openverse' && licenses === 'cc0' && <button className="btn btn-sm" onClick={() => patch({ licenses: 'attribution' })}>{t('audio.include_credit_required_media')}</button>}</div>}
      {!res.loading && res.page < res.pages && res.results.length > 0 && <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('audio.load_more')}</button>}
    </>}
    {provider === 'openverse' ? <OpenverseNotice /> : <p className="lib-note">{t('stock.from_pixabay_under_the_pixabay_content_lic')}</p>}
  </>;
}

export function StockCard({ item: it, busy, onAdd, favorite = favStock(it) }) {
  return <article className="stock-card">
    <div className="stock-tile" title={`${it.tags} · ${it.user}`} onDoubleClick={() => !busy && onAdd('main')}>
      <Thumb url={it.thumb} alt={it.tags} />
      {it.kind === 'video' && <span className="asset-dur">{formatTime(it.duration).slice(0, 5)}</span>}
      <FavStar entry={favorite} className="tile-star" />
      {busy ? <span className="stock-busy"><Loader2 size={18} className="spin" /> {t('favorites.adding')}</span> : <span className="stock-actions">
        <button onDoubleClick={e => e.stopPropagation()} onClick={() => onAdd('overlay')} aria-label={t('favorites.add_as_overlay')} title={t('favorites.add_as_overlay')}><Layers size={13} /></button>
        <button onDoubleClick={e => e.stopPropagation()} onClick={() => onAdd('main')} aria-label={t('favorites.add_to_the_main_track')} title={t('stock.add_to_main_track')}><Plus size={14} /></button>
      </span>}
    </div>
    <div className="stock-card-info"><b title={it.tags}>{it.tags || t('stock.untitled')}</b><span title={it.user}>{it.user}</span>
      {it.origin === 'openverse' ? <button className="stock-source" title={t('stock.license_view_original_source', { license: it.licenseName })} onClick={() => window.api.openverseSource(it)}>{it.license === 'by' ? t('stock.credit_required_source') : t('stock.no_credit_required_source')} <ExternalLink size={11} /></button> : <span>Pixabay</span>}
    </div>
  </article>;
}
