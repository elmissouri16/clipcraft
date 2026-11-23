import React, { useState } from 'react';
import { Layers, Loader2, Plus, Star } from 'lucide-react';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { FavStar, useFavorites } from "../../../app/favorites.jsx";
import { StockCard } from './StockLibrary.jsx';
import { t } from '../../../i18n/index.js';

// Favorite provider results and imported files are available across projects.
export default function MediaFavorites({ onStockAdd, onAddFile }) {
  const favs = useFavorites().list.filter((e) => e.type === 'video' || e.type === 'photo');
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');
  const add = async (e, where) => {
    setBusy((b) => ({ ...b, [e.key]: true }));
    setError('');
    const r = e.source === 'stock' ? await onStockAdd(e.item, where) : await onAddFile(e.item.path, where);
    setBusy((b) => ({ ...b, [e.key]: false }));
    if (r?.error) setError(r.error);
  };
  return (
    <>
      <div className="tab-title">{t('favorites.favorite_videos_and_photos')}</div>
      {error && <p className="error-text">{error}</p>}
      {!favs.length && (
        <div className="empty-state">
          <span className="empty-disc"><Star size={26} /></span>
          <b>{t('favorites.no_favorites_yet')}</b>
          <p>{t('favorites.click_the_star_on_a_stock_video_or_photo_o')}</p>
        </div>
      )}
      <div className="stock-grid">
        {favs.map((e) => {
          const it = e.item;
          if (e.source === 'stock') return <StockCard key={e.key} item={it} favorite={e} busy={busy[e.key]} onAdd={where => add(e, where)} />;
          const name = it.name;
          return (
            <div key={e.key} className={`stock-tile ${e.missing ? 'missing' : ''}`} title={e.missing ? t('favorites.file_moved_or_deleted_path', { path: it.path }) : name}
              onDoubleClick={() => !e.missing && add(e, 'main')}>
              {e.type === 'photo' ? <img src={toFileUrl(it.path)} alt={name} draggable={false} />
                  : it.thumb && it.thumbCount > 1 ? (
                    <div className="asset-sprite" style={{ backgroundImage: `url("${toFileUrl(it.thumb)}")`, backgroundSize: `${it.thumbCount * 100}% 100%`, backgroundPosition: '0 0' }} />
                  ) : <video src={toFileUrl(it.path) + '#t=0.5'} preload="metadata" muted />}
              {e.type === 'video' && it.duration ? <span className="asset-dur">{formatTime(it.duration).slice(0, 5)}</span> : null}
              <FavStar entry={e} className="tile-star" />
              {e.source === 'file' && <span className="fav-name">{it.name}</span>}
              {busy[e.key] ? (
                <span className="stock-busy"><Loader2 size={18} className="spin" /> {t('favorites.adding')}</span>
              ) : !e.missing && (
                <span className="stock-actions">
                  <button onClick={() => add(e, 'overlay')} aria-label={t('favorites.add_as_overlay')} title={t('library.add_as_overlay_picture_in_picture')}><Layers size={13} /></button>
                  <button onClick={() => add(e, 'main')} aria-label={t('favorites.add_to_the_main_track')} title={t('favorites.add_to_the_main_track')}><Plus size={14} /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
