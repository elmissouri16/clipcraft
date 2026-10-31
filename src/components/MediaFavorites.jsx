import React, { useState } from 'react';
import { Layers, Loader2, Plus, Star } from 'lucide-react';
import { formatTime, toFileUrl } from '../store.js';
import { FavStar, useFavorites } from '../favorites.jsx';
import { Thumb } from './StockLibrary.jsx';

// Favorite videos and photos: Pixabay results and imported files, ready to add to any project.
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
      <div className="tab-title">Favorite videos and photos</div>
      {error && <p className="error-text">{error}</p>}
      {!favs.length && (
        <div className="empty-state">
          <span className="empty-disc"><Star size={26} /></span>
          <b>No favorites yet</b>
          <p>Click the star on a stock video or photo, or on your own media, to keep it here for all your projects.</p>
        </div>
      )}
      <div className="stock-grid">
        {favs.map((e) => {
          const it = e.item;
          const name = e.source === 'stock' ? it.tags : it.name;
          return (
            <div key={e.key} className={`stock-tile ${e.missing ? 'missing' : ''}`} title={e.missing ? `File moved or deleted: ${it.path}` : name}
              onDoubleClick={() => !e.missing && add(e, 'main')}>
              {e.source === 'stock' ? <Thumb url={it.thumb} alt={name} />
                : e.type === 'photo' ? <img src={toFileUrl(it.path)} alt={name} draggable={false} />
                  : it.thumb && it.thumbCount > 1 ? (
                    <div className="asset-sprite" style={{ backgroundImage: `url("${toFileUrl(it.thumb)}")`, backgroundSize: `${it.thumbCount * 100}% 100%`, backgroundPosition: '0 0' }} />
                  ) : <video src={toFileUrl(it.path) + '#t=0.5'} preload="metadata" muted />}
              {e.type === 'video' && it.duration ? <span className="asset-dur">{formatTime(it.duration).slice(0, 5)}</span> : null}
              <FavStar entry={e} className="tile-star" />
              {e.source === 'file' && <span className="fav-name">{it.name}</span>}
              {busy[e.key] ? (
                <span className="stock-busy"><Loader2 size={18} className="spin" /> Adding…</span>
              ) : !e.missing && (
                <span className="stock-actions">
                  <button onClick={() => add(e, 'overlay')} aria-label="Add as overlay" title="Add as overlay (picture in picture)"><Layers size={13} /></button>
                  <button onClick={() => add(e, 'main')} aria-label="Add to the main track" title="Add to the main track"><Plus size={14} /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
