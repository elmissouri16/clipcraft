import { useEffect, useState } from 'react';
import { ExternalLink, Layers, Loader2, Plus } from 'lucide-react';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { FavStar, favStock } from "../../../app/favorites.jsx";

import OnlineMediaBrowser from './OnlineMediaBrowser.jsx';
import {t} from '../../../i18n/index.js';

// Shown names of the chips above; the chip ids stay English because they are stored in browser memory and navigation ids.
const CHIP_KEYS = {
  'Green screen': 'stock.green_screen', Background: 'inspector.background', Nature: 'stock.nature', Travel: 'stock.travel', City: 'stock.city',
  People: 'stock.people', Business: 'stock.business', Abstract: 'stock.abstract', Sky: 'stock.sky', Ocean: 'stock.ocean', Particles: 'stock.particles',
  Food: 'stock.food', Sports: 'stock.sports', Animals: 'stock.animals', Technology: 'stock.technology', Backgrounds: 'stock.backgrounds',
  Places: 'stock.places', Buildings: 'stock.buildings', Fashion: 'stock.fashion', Music: 'library.music', Science: 'stock.science', Feelings: 'stock.feelings',
};
const chipLabel = chip => (CHIP_KEYS[chip] ? t(CHIP_KEYS[chip]) : chip);

const thumbCache = new Map(); // remote thumbnail -> local file URL
export function Thumb({ item, alt }) {
  const url = item.thumb && JSON.stringify([item.sourceId, item.thumb]);
  const [src, setSrc] = useState(thumbCache.get(url) || '');
  useEffect(() => {
    setSrc(thumbCache.get(url) || '');
    if (!url || thumbCache.has(url)) return undefined;
    let alive = true;
    window.api.mediaSourcePreview(item).then((r) => {
      if (!r.path) return;
      const u = toFileUrl(r.path);
      thumbCache.set(url, u);
      if (alive) setSrc(u);
    });
    return () => { alive = false; };
  }, [url]);
  return src ? <img src={src} alt={alt} draggable={false} /> : <div className="stock-ph" aria-hidden="true" />;
}

export default function StockLibrary({kind, onNavigate, onStockAdd, onOpenSettings, browserMemory, settingsVersion}) {
  const [busy,setBusy] = useState({});
  const [error,setError] = useState('');
  const add = async (item, where) => {
    setBusy(current => ({...current, [item.id]:true}));
    setError('');
    try { const result = await onStockAdd(item, where); if (result?.error) setError(result.error); }
    catch (e) { setError(e.message); }
    finally { setBusy(current => ({...current, [item.id]:false})); }
  };
  const navigation = <div className="seg-tabs browser-kinds" aria-label={t('stock.stock_kind')}>
    {['video','photo'].map(id => <button key={id} className={id === kind ? 'on' : ''} aria-pressed={id === kind}
      onClick={() => onNavigate(id + ':Trending')}>{t(id === 'video' ? 'stock.videos' : 'stock.photos')}</button>)}
  </div>;
  return <OnlineMediaBrowser kind={kind} browserMemory={browserMemory} settingsVersion={settingsVersion} categoryLabel={chipLabel}
    navigation={navigation} onOpenSettings={onOpenSettings}>{results => <>
      {error && <p className="error-text">{error}</p>}
      <div className="stock-grid">{results.map(item => <StockCard key={item.id} item={item} busy={busy[item.id]} onAdd={where => add(item, where)}/>)}</div>
    </>}</OnlineMediaBrowser>;
}

export function StockCard({ item: it, busy, onAdd, favorite = favStock(it) }) {
  const title = it.title || (typeof it.tags === 'string' && it.tags) || t('stock.untitled');
  const creator = it.creator || it.user;
  const sourceLabel = it.license === 'by' ? t('stock.credit_required_source') : it.license === 'cc0' ? t('stock.no_credit_required_source') : t('audio.original_source_and_licence');
  return <article className="stock-card">
    <div className="stock-tile" title={[title,creator].filter(Boolean).join(' · ')} onDoubleClick={() => !busy && onAdd('main')}>
      <Thumb item={it} alt={title} />
      {it.kind === 'video' && <span className="asset-dur">{formatTime(it.duration).slice(0, 5)}</span>}
      <FavStar entry={favorite} className="tile-star" />
      {busy ? <span className="stock-busy"><Loader2 size={18} className="spin" /> {t('favorites.adding')}</span> : <span className="stock-actions">
        <button onDoubleClick={e => e.stopPropagation()} onClick={() => onAdd('overlay')} aria-label={t('favorites.add_as_overlay')} title={t('favorites.add_as_overlay')}><Layers size={13} /></button>
        <button onDoubleClick={e => e.stopPropagation()} onClick={() => onAdd('main')} aria-label={t('favorites.add_to_the_main_track')} title={t('stock.add_to_main_track')}><Plus size={14} /></button>
      </span>}
    </div>
    <div className="stock-card-info"><b title={title}>{title}</b><span title={creator}>{creator}</span>
      {it.sourceLinks ? <button className="stock-source" title={t('stock.license_view_original_source', { license: it.licenseName || it.license || '' })} onClick={() => window.api.mediaSourceLink(it)}>{sourceLabel} <ExternalLink size={11} /></button> : <span>{it.sourceName}</span>}
    </div>
  </article>;
}
