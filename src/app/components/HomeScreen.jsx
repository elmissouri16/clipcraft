import React, { useEffect, useId, useRef, useState } from 'react';
import { Film, FolderOpen, Import, LayoutGrid, List, Monitor, Search, Trash2, X, Settings } from 'lucide-react';

// ClipCraft home: a header with the three ways in (open, import, record), a compact row of formats
// for a new project, and the projects themselves as a grid or a list. One quiet surface: no hero,
// no slogans; the projects are the main content.

// ratio -> the sizeFor() short side that yields the labelled pixel size.
export const PRESETS = [
  { ratio: '16:9', label: 'Landscape', use: 'YouTube, desktop', size: '1920 × 1080', short: 1080 },
  { ratio: '9:16', label: 'Vertical', use: 'Reels, TikTok, Shorts', size: '1080 × 1920', short: 1080 },
  { ratio: '1:1', label: 'Square', use: 'Feed posts', size: '1080 × 1080', short: 1080 },
  { ratio: '4:5', label: 'Portrait', use: 'Feed portrait', size: '1080 × 1350', short: 1080 },
  { ratio: '21:9', label: 'Ultrawide', use: 'Cinematic', size: '2520 × 1080', short: 1080 },
];
const FPS = [24, 30, 60];
const VIEW_KEY = 'clipcraft.homeView';

const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};

// "Today" / "Yesterday" / "N days ago" inside the last week, a plain date before that.
const relDate = (ts) => {
  if (!ts) return '';
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(new Date(ts))) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtDate(ts);
};

// Where a project lives: its file name, or the automatic save.
const placeOf = (r) => (r.path ? String(r.path).split(/[\\/]/).pop() : r.slotId ? 'Auto-saved' : '');

// The format as an outline at its true proportions, fitted in a fixed box.
function FormatShape({ ratio }) {
  const [a, b] = ratio.split(':').map(Number);
  // Fitted inside a 50 × 32 box, so every format reads at the same visual weight.
  const scale = Math.min(50 / a, 32 / b), w = a * scale, h = b * scale;
  return <span className="home-format-shape" aria-hidden="true"><span style={{ width: Math.round(w), height: Math.round(h) }} /></span>;
}

// A project's thumbnail: the video sprite's first frame, an image, or the placeholder glyph.
// Fixed cells contain the whole poster; sprite frames are clipped before fitting.
function RecentThumb({ r, placeholder = 22 }) {
  const thumb = r.thumb;
  const src = typeof thumb === 'string' ? thumb : thumb?.src;
  const [failed, setFailed] = useState(false);
  const clipId = `recent-frame-${useId().replace(/:/g, '')}`;
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <Film size={placeholder} />;
  if (thumb.kind === 'sprite') {
    const w = Math.max(1, Number(thumb.w) || 160), h = Math.max(1, Number(thumb.h) || 90);
    const count = Math.max(1, Math.floor(Number(thumb.count) || 1));
    const frame = Math.round(Math.min(1, Math.max(0, Number(thumb.at) || 0)) * (count - 1));
    return (
      <svg className="home-card-sprite" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs><clipPath id={clipId}><rect width={w} height={h} /></clipPath></defs>
        <image href={src} width={w * count} height={h} x={-frame * w} clipPath={`url(#${clipId})`} onError={() => setFailed(true)} />
      </svg>
    );
  }
  return <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} />;
}

// Asked before a project leaves the list. Removing also deletes its auto-saved copy, so the text says
// what is lost: for a project that was only auto-saved, the project itself. Cancel has the focus;
// Escape and a click outside cancel.
function RemoveDialog({ project, onCancel, onConfirm }) {
  const cancel = useRef(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const name = String(project.name || 'Untitled').slice(0, 80), onlyAutoSaved = !project.path;
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-text"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal close-modal">
        <div className="modal-icon error"><Trash2 size={22} /></div>
        <h3 id="remove-title" dir="auto">{onlyAutoSaved ? `Delete “${name}”?` : `Remove “${name}” from projects?`}</h3>
        <p id="remove-text" className="muted">{onlyAutoSaved
          ? 'This project was only auto-saved and has no file, so it will be deleted permanently. This cannot be undone.'
          : `The project file stays on disk (${placeOf(project)}) and can be opened again. Its auto-saved copy is deleted, so changes never saved to the file are lost.`}</p>
        <div className="modal-actions">
          <button ref={cancel} type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}><Trash2 size={14} /> {onlyAutoSaved ? 'Delete project' : 'Remove'}</button>
        </div>
      </div>
    </div>
  );
}

const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };

export default function HomeScreen({ recents, onNew, onOpen, onOpenRecent, onRemoveRecent, onImportMedia, onRecordStart, unsavedNote, onRestoreUnsaved, onDiscardUnsaved, agentBadge = null, onSettings }) {
  const [fps, setFps] = useState(30);
  // The version reads the real app version (package.json via app:version).
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.api?.appVersion?.().then((v) => { if (v) setVersion(v.split('.').slice(0, 2).join('.')); }).catch(() => {});
  }, []);
  const [view, setView] = useState(readView);
  const chooseView = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* the choice just isn't remembered */ } };
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? recents.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.ratio || '').includes(q)) : recents;
  const latest = recents[0] || null;
  const [removing, setRemoving] = useState(null); // the project awaiting confirmation

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <img src="./logo.png" alt="" className="home-logo" draggable={false} />
          <span className="home-name">ClipCraft</span>
          <span className="home-ver">{version ? `Version ${version}` : 'ClipCraft'}</span>
        </div>
        <nav className="home-actions" aria-label="Start">
          {agentBadge}
          <button type="button" className="btn home-action" onClick={onOpen}><FolderOpen size={15} /><span>Open project</span></button>
          <button type="button" className="btn home-action" onClick={onImportMedia}><Import size={15} /><span>Import media</span></button>
          <button type="button" className="btn home-action" onClick={() => onRecordStart?.(fps)}><Monitor size={15} /><span>Record screen</span></button>
          {/* Settings reachable before a project is open (voices, agents, external MCP agents, keys): the
              same control as the editor's top bar. */}
          {onSettings && <button type="button" className="icon-btn settings-btn home-settings" onClick={onSettings} aria-label="Settings" title="Settings"><Settings size={17} /></button>}
        </nav>
      </header>

      <main className="home-body">
        {unsavedNote && (
          <div className="home-recover" role="status">
            <div>
              <b>Recover a previous session</b>
              <span> A local recovery copy is available ({new Date(unsavedNote.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}).</span>
            </div>
            <div className="home-recover-actions">
              <button className="btn btn-primary btn-sm" onClick={onRestoreUnsaved}>Restore</button>
              <button className="btn btn-sm" onClick={onDiscardUnsaved}>Discard</button>
            </div>
          </div>
        )}

        <section className="home-section" aria-labelledby="home-new-title">
          <div className="home-section-head">
            <h2 id="home-new-title">New project</h2>
            <span className="home-seg home-fps" role="group" aria-label="Frame rate">
              {FPS.map((f) => (
                <button key={f} type="button" className={fps === f ? 'on' : ''} aria-pressed={fps === f} onClick={() => setFps(f)}>{f} fps</button>
              ))}
            </span>
          </div>
          <div className="home-formats">
            {PRESETS.map((p) => (
              <button key={p.ratio} type="button" className="home-frame-card" onClick={() => onNew(p, fps)} aria-label={`New ${p.ratio} project`} title={`${p.label} · ${p.use}`}>
                <FormatShape ratio={p.ratio} />
                <span className="home-format-text">
                  <b>{p.ratio}</b>
                  <span>{p.label}</span>
                </span>
                <span className="home-format-size">{p.size}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="home-section home-recents" aria-labelledby="home-recent-title">
          <div className="home-section-head">
            <h2 id="home-recent-title">Projects {recents.length > 0 && <span className="home-count">{recents.length}</span>}</h2>
            {recents.length > 0 && (
              <div className="home-tools">
                <span className="home-search-wrap">
                  <Search size={14} aria-hidden="true" />
                  <input type="search" className="home-search" placeholder="Search projects" value={query}
                    onChange={(e) => setQuery(e.target.value)} aria-label="Search recent projects" />
                </span>
                <span className="home-seg home-view" role="group" aria-label="Project view">
                  <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} aria-label="Grid view" title="Grid" onClick={() => chooseView('grid')}><LayoutGrid size={14} /></button>
                  <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} aria-label="List view" title="List" onClick={() => chooseView('list')}><List size={14} /></button>
                </span>
              </div>
            )}
          </div>

          {!recents.length && (
            <div className="home-empty">
              <Film size={22} aria-hidden="true" />
              <p><b>No projects yet</b></p>
              <p className="muted">Choose a format above, or open a project file. Projects you open or save appear here.</p>
            </div>
          )}
          {recents.length > 0 && !shown.length && <p className="home-none muted">No projects match “{query}”.</p>}

          {shown.length > 0 && view === 'grid' && (
            <div className="home-grid">
              {shown.map((r) => {
                const resume = r === latest, name = r.name || 'Untitled';
                return (
                  <div key={r.slotId || r.path} className={`home-card${resume ? ' home-card-latest' : ''}`}>
                    <button type="button" className="home-card-open" onClick={() => onOpenRecent(r)} title={r.path || name} aria-label={`${resume ? 'Resume' : 'Open'} ${name}`}>
                      <span className="home-card-thumb"><RecentThumb r={r} /></span>
                      <span className="home-card-body">
                        <b className="home-card-name" dir="auto">{name}</b>
                        <span className="home-card-meta">{[r.ratio || '16:9', relDate(r.modifiedAt), r.slotId && !r.path ? 'Auto-saved' : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                    <button type="button" className="icon-btn home-card-x" aria-label={`Remove ${name}`} title="Remove" onClick={() => setRemoving(r)}><X size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {shown.length > 0 && view === 'list' && (
            <div className="home-list" role="table" aria-label="Projects">
              <div className="home-row home-row-head" role="row">
                <span role="columnheader">Name</span><span role="columnheader">Format</span><span role="columnheader">Modified</span><span role="columnheader">Location</span><span />
              </div>
              {shown.map((r) => {
                const resume = r === latest, name = r.name || 'Untitled';
                return (
                  <div key={r.slotId || r.path} className={`home-row home-card${resume ? ' home-card-latest' : ''}`} role="row">
                    <button type="button" className="home-card-open" onClick={() => onOpenRecent(r)} title={r.path || name} aria-label={`${resume ? 'Resume' : 'Open'} ${name}`}>
                      <span className="home-card-thumb"><RecentThumb r={r} placeholder={16} /></span>
                      <b className="home-card-name" dir="auto">{name}</b>
                    </button>
                    <span className="home-row-cell" role="cell">{r.ratio || '16:9'}</span>
                    <span className="home-row-cell home-card-meta" role="cell">{relDate(r.modifiedAt)}</span>
                    <span className="home-row-cell home-row-place" role="cell" title={r.path || ''}>{placeOf(r)}</span>
                    <button type="button" className="icon-btn home-card-x" aria-label={`Remove ${name}`} title="Remove" onClick={() => setRemoving(r)}><X size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
      {removing && <RemoveDialog project={removing} onCancel={() => setRemoving(null)} onConfirm={() => { const r = removing; setRemoving(null); onRemoveRecent(r); }} />}
    </div>
  );
}
