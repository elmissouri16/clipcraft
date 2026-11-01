import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Film, FolderOpen, Image as ImageIcon, Layers, Loader2, Music2, Plus, RefreshCw } from 'lucide-react';
import SearchBox from './SearchBox.jsx';
import PackOffer from './PackOffer.jsx';
import { ASSET_GROUPS, assetAddWhere } from '../assetsLib.js';
import { formatTime, toFileUrl } from '../store.js';
import { refreshAssets, useAssets } from '../useAssets.js';

// Assets tab — the folder-backed pack library's VISUAL groups (Transitions / Overlays /
// Characters / Icons / 3D) plus the app's own generated media (the Forge shelf). It
// replaced the Templates tab in the dock, with the same icon. The pack's audio is NOT
// here (Hamza, 2026-11-01): Music lives in the Audio tab's Music place and Sound FX in
// its Sound FX place (PackMusic.jsx), with the music.
//
// Adding: one click on a row (or its + button) puts the file on the timeline at the
// playhead through App's addFile — audio files land on the audio lane, video and image
// files become overlay clips (images with the default image duration). Posters come from
// the pack itself (Mister Horse previews matched by the analysis) and lazy-load; image
// items thumbnail from the file itself, and a sub made only of images renders as a
// thumbnail grid. A closed group renders nothing, so the full 570-item library opens
// instantly and scrolls without jank (rows also carry content-visibility: auto).
const dur = (s) => (s ? formatTime(s).slice(0, 5) : '');
const KIND_LABEL = { video: 'Video', image: 'Image', audio: 'Sound' };
// The picture a row/tile shows: the pack poster when there is one, else — for image
// items — the file itself (it IS the picture).
const thumbOf = (item) => item.poster || (item.kind === 'image' && !item.missing ? item.path : null);

function AssetRow({ item, onAdd, adding }) {
  const thumb = thumbOf(item);
  return (
    <div className={`lib-row asset-row ${item.missing ? 'missing' : ''}`} onDoubleClick={() => onAdd(item)}
      title={item.missing ? 'This file is not in the assets folder' : `Add ${item.name} at the playhead`}>
      {thumb
        ? <img className="asset-poster" src={toFileUrl(thumb)} loading="lazy" decoding="async" alt="" draggable={false} />
        : <span className="asset-kind">{item.kind === 'video' ? <Film size={16} /> : item.kind === 'image' ? <ImageIcon size={16} /> : <Music2 size={16} />}</span>}
      <div className="lib-meta">
        <b title={item.name}>{item.name}</b>
        <span className="lib-sub">
          <span>{KIND_LABEL[item.kind] || 'Sound'}{item.dims ? ` · ${item.dims.replace('x', '×')}` : ''}{item.duration ? ` · ${dur(item.duration)}` : ''}</span>
          {item.missing && <i className="lic by">Missing file</i>}
        </span>
      </div>
      <button className="lib-add" onClick={() => onAdd(item)} disabled={item.missing || adding === item.path}
        aria-label={`Add ${item.name} at the playhead`} title={item.kind === 'audio' ? 'Add at the playhead' : 'Add as overlay at the playhead'}>
        {adding === item.path ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

// One tile of an image sub's thumbnail grid (Characters, Frames…): the picture large,
// the name under it, the + on hover. Double-click adds, like rows.
function AssetTile({ item, onAdd, adding }) {
  const thumb = thumbOf(item);
  return (
    <div className={`asset-tile ${item.missing ? 'missing' : ''}`} onDoubleClick={() => onAdd(item)}
      title={item.missing ? 'This file is not in the assets folder' : `Add ${item.name} at the playhead`}>
      <span className="asset-tile-img">
        {thumb
          ? <img src={toFileUrl(thumb)} loading="lazy" decoding="async" alt="" draggable={false} />
          : <ImageIcon size={22} />}
        <button className="lib-add asset-tile-add" onClick={() => onAdd(item)} disabled={item.missing || adding === item.path}
          aria-label={`Add ${item.name} at the playhead`} title="Add as overlay at the playhead">
          {adding === item.path ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
        </button>
      </span>
      <span className="asset-tile-name" title={item.name}>{item.name}</span>
      <span className="asset-tile-sub">{item.dims ? item.dims.replace('x', '×') : ''}{item.missing ? ' · Missing file' : ''}</span>
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
// A sub whose items are ALL images renders as a thumbnail grid instead of rows.
function SubLists({ pairs, renderItem, renderTile }) {
  return pairs.map(([label, items]) => {
    const grid = items.length > 0 && items.every((i) => i.kind === 'image');
    return (
      <div key={label || 'all'} className="lib-group">
        {pairs.length > 1 && <span className="lib-group-name">{label} · {items.length}</span>}
        {grid
          ? <div className="asset-grid">{items.map(renderTile)}</div>
          : <div className="lib-list">{items.map(renderItem)}</div>}
      </div>
    );
  });
}

export default function AssetsTab({ onAddFile }) {
  const lib = useAssets();
  const [q, setQ] = useState('');
  const [shelf, setShelf] = useState([]);
  const [open, setOpen] = useState({ Transitions: true });
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
    const row = (i) => <AssetRow key={i.path} item={i} onAdd={add} adding={adding} />;
    const tile = (i) => <AssetTile key={i.path} item={i} onAdd={add} adding={adding} />;
    // The plain shape most groups take: one sub-list per manifest sub.
    const bySub = (g) => () => {
      const items = by(g);
      const subs = [...new Set(items.map((i) => i.sub))];
      return <SubLists pairs={subs.map((s) => [s, items.filter((i) => i.sub === s)])} renderItem={row} renderTile={tile} />;
    };
    return {
      // Honest kinds, not folder names: pack 1's "sounds" folder holds video files, so the
      // split stays by the file's real media kind — with pack 2's real subgroups (Ink,
      // Premium) named inside the video side.
      Transitions: () => {
        const items = by('Transitions');
        const vids = items.filter((i) => i.kind === 'video');
        const vsubs = [...new Set(vids.map((i) => i.sub))];
        const pairs = [
          ...vsubs.map((s) => [vsubs.length > 1 && s !== 'Video' ? `Video · ${s}` : 'Video', vids.filter((i) => i.sub === s)]),
          ['Sound', items.filter((i) => i.kind === 'audio')],
        ].filter(([, l]) => l.length);
        return <SubLists pairs={pairs} renderItem={row} renderTile={tile} />;
      },
      Overlays: bySub('Overlays'),
      Characters: bySub('Characters'),
      Icons: bySub('Icons'),
      '3D': bySub('3D'),
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
          <PackOffer categories={['music', 'assets']} />
          <p className="muted">Or place a pack by hand — ClipCraft reads it from this folder on this PC:</p>
          <p className="muted path">{lib.root}</p>
          <p className="muted">Put the pack's <b>library.json</b> and its media files there (keeping the folder layout), then Refresh — Transitions, Overlays, Characters, Icons and 3D appear here, and the pack's music and sound effects appear in Audio. Nothing is bundled into the app, so the pack can grow without reinstalling.</p>
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
          {lib.bundled
            ? <p className="muted small pad-x">Creator Pack bundled with this build — {lib.total} files, read in place. Music and sound effects from the pack live in Audio.</p>
            : <p className="muted small pad-x">Pack folder: {lib.root} · {lib.total} files indexed. Music and sound effects from the pack live in Audio.</p>}
          {(() => {
            // A partial pack keeps its standing offer for the categories still missing.
            // Sound FX is not offered here — it belongs to Audio now, which carries its
            // own standing offer in the Sound FX view.
            const missing = [
              ...(lib.counts.Music ? [] : ['music']),
              ...(lib.counts.Transitions || lib.counts.Overlays ? [] : ['assets']),
            ];
            return missing.length ? (
              <div className="assets-pack-more">
                <p className="muted small">More of the free Creator Pack is available:</p>
                <PackOffer categories={missing} />
              </div>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
