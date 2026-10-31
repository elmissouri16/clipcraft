import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Film, FolderOpen, Layers, Loader2, Music2, Plus, RefreshCw } from 'lucide-react';
import SearchBox from './SearchBox.jsx';
import { ASSET_GROUPS, assetAddWhere } from '../assetsLib.js';
import { formatTime, toFileUrl } from '../store.js';
import { refreshAssets, useAssets } from '../useAssets.js';

// Assets tab — the folder-backed pack library (Sound FX / Transitions / Overlays) plus the
// app's own generated media (the Forge shelf). It replaced the Templates tab in the dock,
// with the same icon. The pack's Music is NOT here: it lives in the Audio tab's Music
// place (PackMusic.jsx), as Hamza's IA specifies.
//
// Adding: one click on a row (or its + button) puts the file on the timeline at the
// playhead through App's addFile — audio files land on the audio lane, video files become
// overlay clips. Posters come from the pack itself (Mister Horse previews matched by the
// analysis) and lazy-load; a closed group renders nothing, so the full 312-item library
// opens instantly and scrolls without jank.
const dur = (s) => (s ? formatTime(s).slice(0, 5) : '');

function AssetRow({ item, onAdd, adding }) {
  return (
    <div className={`lib-row asset-row ${item.missing ? 'missing' : ''}`} onDoubleClick={() => onAdd(item)}
      title={item.missing ? 'This file is not in the assets folder' : `Add ${item.name} at the playhead`}>
      {item.poster
        ? <img className="asset-poster" src={toFileUrl(item.poster)} loading="lazy" decoding="async" alt="" draggable={false} />
        : <span className="asset-kind">{item.kind === 'video' ? <Film size={16} /> : <Music2 size={16} />}</span>}
      <div className="lib-meta">
        <b title={item.name}>{item.name}</b>
        <span className="lib-sub">
          <span>{item.kind === 'video' ? 'Video' : 'Sound'}{item.dims ? ` · ${item.dims.replace('x', '×')}` : ''}{item.duration ? ` · ${dur(item.duration)}` : ''}</span>
          {item.missing && <i className="lic by">Missing file</i>}
        </span>
      </div>
      <button className="lib-add" onClick={() => onAdd(item)} disabled={item.missing || adding === item.path}
        aria-label={`Add ${item.name} at the playhead`} title={item.kind === 'video' ? 'Add as overlay at the playhead' : 'Add at the playhead'}>
        {adding === item.path ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function Group({ name, count, open, onToggle, children }) {
  return (
    <div className="asset-group">
      <button className="asset-group-head" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{name}</span>
        <span className="asset-count">{count}</span>
      </button>
      {open && <div className="asset-group-body">{children}</div>}
    </div>
  );
}

// Sub-sections of one group: [label, items] pairs; a single pair renders without a header.
function SubLists({ pairs, renderItem }) {
  return pairs.map(([label, items]) => (
    <div key={label || 'all'} className="lib-group">
      {pairs.length > 1 && <span className="lib-group-name">{label} · {items.length}</span>}
      <div className="lib-list">{items.map(renderItem)}</div>
    </div>
  ));
}

export default function AssetsTab({ onAddFile }) {
  const lib = useAssets();
  const [q, setQ] = useState('');
  const [shelf, setShelf] = useState([]);
  const [open, setOpen] = useState({ 'Sound FX': true });
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { window.api.forgeList().then(setShelf).catch(() => {}); }, []);
  const query = q.trim().toLowerCase();
  const match = (name) => !query || name.toLowerCase().includes(query);

  const add = async (item) => {
    if (item.missing || adding) return;
    setAdding(item.path);
    setErr('');
    const r = await onAddFile?.(item.path, assetAddWhere(item));
    setAdding('');
    if (r?.error) setErr(r.error);
  };
  const addShelf = async (e, where) => {
    setErr('');
    const r = await onAddFile?.(e.path, where);
    if (r?.error) setErr(r.error);
  };

  const groups = useMemo(() => {
    if (!lib) return null;
    const by = (g) => lib.items.filter((i) => i.group === g && match(i.name));
    return {
      'Sound FX': () => {
        const items = by('Sound FX');
        const subs = [...new Set(items.map((i) => i.sub))];
        return <SubLists pairs={subs.map((s) => [s, items.filter((i) => i.sub === s)])} renderItem={(i) => <AssetRow key={i.path} item={i} onAdd={add} adding={adding} />} />;
      },
      // Honest kinds, not folder names: the pack's "sounds" folder holds 4 video files, so
      // the split is by the file's real media kind (22 video / 3 sound in this pack).
      Transitions: () => {
        const items = by('Transitions');
        const pairs = [['Video', items.filter((i) => i.kind === 'video')], ['Sound', items.filter((i) => i.kind === 'audio')]].filter(([, l]) => l.length);
        return <SubLists pairs={pairs} renderItem={(i) => <AssetRow key={i.path} item={i} onAdd={add} adding={adding} />} />;
      },
      Overlays: () => {
        const items = by('Overlays');
        const subs = [...new Set(items.map((i) => i.sub))];
        return <SubLists pairs={subs.map((s) => [s, items.filter((i) => i.sub === s)])} renderItem={(i) => <AssetRow key={i.path} item={i} onAdd={add} adding={adding} />} />;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, query, adding]);

  const counts = lib ? Object.fromEntries(ASSET_GROUPS.map((g) => [g, lib.items.filter((i) => i.group === g && match(i.name)).length])) : {};
  const shelfShown = shelf.filter((e) => match(e.prompt || ''));
  const isOpen = (name) => (query ? true : !!open[name]);
  const toggle = (name) => setOpen((o) => ({ ...o, [name]: !o[name] }));

  return (
    <div className="pad-block assets-tab">
      <div className="lib-head">
        <div>
          <h2>Assets</h2>
          <p>Your pack, from its own folder — click to add at the playhead</p>
        </div>
        <button className="btn btn-sm" onClick={() => refreshAssets()} title="Re-read the assets folder"><RefreshCw size={13} /> Refresh</button>
      </div>
      {err && <p className="error-text">{err}</p>}
      {!lib ? (
        <p className="empty-note"><Loader2 size={14} className="spin" /> Reading the assets folder…</p>
      ) : !lib.hasLibrary ? (
        <div className="assets-empty">
          <p><b>No asset pack found yet.</b></p>
          <p className="muted">ClipCraft reads its pack from this folder on this PC:</p>
          <p className="muted path">{lib.root}</p>
          <p className="muted">Put the pack's <b>library.json</b> and its media files there (keeping the folder layout), then Refresh — Sound FX, Transitions and Overlays appear here, and the pack's music appears in Audio → Music. Nothing is bundled into the app, so the pack can grow without reinstalling.</p>
          <button className="btn btn-sm" onClick={() => window.api.openFolder(lib.root)}><FolderOpen size={13} /> Open assets folder</button>
        </div>
      ) : (
        <>
          <div className="panel-search"><SearchBox value={q} onChange={setQ} placeholder="Search assets…" ariaLabel="Search assets" /></div>
          {ASSET_GROUPS.map((g) => (
            <Group key={g} name={g} count={counts[g]} open={isOpen(g)} onToggle={() => toggle(g)}>
              {groups[g]()}
            </Group>
          ))}
          <Group name="Generated" count={shelfShown.length} open={isOpen('Generated')} onToggle={() => toggle('Generated')}>
            {!shelfShown.length ? (
              <p className="empty-note">Nothing generated yet — media you make in Forge lands here, ready to add.</p>
            ) : (
              <div className="lib-list">
                {shelfShown.map((e) => (
                  <div key={e.id} className="lib-row asset-row">
                    <span className="asset-poster gen">
                      {e.kind === 'video'
                        ? <video src={toFileUrl(e.path)} muted preload="metadata" />
                        : <img src={toFileUrl(e.path)} loading="lazy" decoding="async" alt="" draggable={false} />}
                    </span>
                    <div className="lib-meta">
                      <b title={e.prompt}>{e.prompt}</b>
                      <span className="lib-sub"><span>{e.kind === 'video' ? 'Video' : 'Photo'} · {e.model}</span></span>
                    </div>
                    <button className="lib-add" onClick={() => addShelf(e, 'main')} aria-label="Add to the main track" title="Add to the main track"><Plus size={16} /></button>
                    <button className="lib-add" onClick={() => addShelf(e, 'overlay')} aria-label="Add as overlay" title="Add as overlay"><Layers size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </Group>
          <p className="muted small pad-x">Pack folder: {lib.root} · {lib.total} files indexed. Music from the pack lives in Audio → Music.</p>
        </>
      )}
    </div>
  );
}
