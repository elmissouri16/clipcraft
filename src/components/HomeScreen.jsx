import { spritePosterStyle } from '../recents.js';
import React, { useState } from 'react';
import { Clock3, Film, FolderOpen, Import, Instagram, Monitor, Play, Plus, Search, X } from 'lucide-react';

// The developer's Instagram — shown in the home footer and the About dialog.
export const DEV_INSTAGRAM_URL = 'https://www.instagram.com/hamza_abika/';

// ClipCraft home / start screen (pass 3) — ClipCraft's own layout: a slim brand header with a
// time-aware greeting, a "stage" hero whose five format frames carry real photography (the
// bundled preview photos) and launch a project on click, a quick-tools row where every tile
// does something real, a "Jump back in" continue card for the latest project, and the
// recent-projects gallery. No sidebar, no banner clone: the stage is the hero.

// ratio -> the sizeFor() short side that yields the labelled pixel size; img -> the preview
// photo whose crop suits the format (bundled in public/preview, see CREDITS.txt there).
const PRESETS = [
  { ratio: '16:9', label: 'Landscape', use: 'YouTube & desktop', size: '1920 × 1080', short: 1080, img: './preview/p1015.jpg' },
  { ratio: '9:16', label: 'Vertical', use: 'Reels, TikTok, Shorts', size: '1080 × 1920', short: 1080, img: './preview/p1025.jpg' },
  { ratio: '1:1', label: 'Square', use: 'Feed posts', size: '1080 × 1080', short: 1080, img: './preview/p292.jpg' },
  { ratio: '4:5', label: 'Portrait', use: 'Feed portrait', size: '1080 × 1350', short: 1080, img: './preview/p1060.jpg' },
  { ratio: '21:9', label: 'Ultrawide', use: 'Cinematic', size: '2520 × 1080', short: 1080, img: './preview/p1016.jpg' },
];
const FPS = [24, 30, 60];

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

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

// A stage frame drawn at the preset's real proportions with a real photo inside, standing on
// the stage floor. Tall/narrow frames are height-driven; the ultrawide frame is width-driven
// so its ratio stays true.
function StageFrame({ preset }) {
  const [a, b] = preset.ratio.split(':').map(Number);
  const wide = a / b >= 2;
  const style = { aspectRatio: `${a} / ${b}`, ...(wide ? { width: '100%' } : { height: 66 }) };
  return (
    <span className="home-frame" style={style} aria-hidden="true">
      <img className="home-frame-img" src={preset.img} alt="" draggable={false} />
      <span className="home-frame-scrim" />
      <span className="home-frame-grid" />
      <span className="home-frame-chip"><Play size={10} fill="currentColor" /></span>
    </span>
  );
}

// '9:16' -> '9 / 16' for CSS aspect-ratio: card thumbnails take the PROJECT's true shape
// (W4) instead of a forced 16/9 box that letterboxes portrait projects into a smear.
function ratioCss(ratio) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio || ''));
  return m ? `${m[1]} / ${m[2]}` : '16 / 9';
}

// A recent's thumbnail: the video sprite's first frame, an image, or the placeholder glyph.
// Shared by the continue card and the gallery cards.
function RecentThumb({ r, placeholder = 22 }) {
  if (r.thumb && r.thumb.kind === 'sprite') return <div className="home-card-poster" style={spritePosterStyle(r.thumb)} role="img" aria-label="" />;
  if (r.thumb) return <img src={r.thumb.kind === 'image' ? r.thumb.src : r.thumb} alt="" draggable={false} />;
  return <Film size={placeholder} />;
}

// The empty-state mark: a mini stage — three ratio frames on a floor, a playhead over two
// timeline bars — built from divs only.
function EmptyStage() {
  return (
    <div className="home-empty-stage" aria-hidden="true">
      <div className="home-empty-frames">
        <span className="home-empty-f f-wide" />
        <span className="home-empty-f f-tall" />
        <span className="home-empty-f f-sq" />
      </div>
      <div className="home-empty-track">
        <span className="home-empty-playhead" />
        <span className="home-empty-bar a" />
        <span className="home-empty-bar b" />
      </div>
    </div>
  );
}

export default function HomeScreen({ recents, onNew, onOpen, onOpenRecent, onRemoveRecent, onImportMedia, onRecordStart, unsavedNote, onRestoreUnsaved, onDiscardUnsaved }) {
  const [fps, setFps] = useState(30);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shownRecents = q ? recents.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.ratio || '').includes(q)) : recents;
  const featured = shownRecents[0] || null;
  const rest = shownRecents.slice(1);
  return (
    <div className="home">
      <header className="home-top">
        <img src="./logo.png" alt="" className="home-logo" draggable={false} />
        <div className="home-brand">
          <span className="home-name">Clip<b>Craft</b></span>
          <span className="home-greet">{greeting()} — ready when you are.</span>
        </div>
        <span className="home-ver">Version 1.0</span>
      </header>

      <main className="home-body">
        {unsavedNote && (
          <div className="home-recover" role="status">
            <div>
              <b>Your last project was not saved.</b>
              <span> It was kept on this PC ({new Date(unsavedNote.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}).</span>
            </div>
            <div className="home-recover-actions">
              <button className="btn btn-primary btn-sm" onClick={onRestoreUnsaved}>Restore</button>
              <button className="btn btn-sm" onClick={onDiscardUnsaved}>Discard</button>
            </div>
          </div>
        )}

        <section className="home-hero" aria-labelledby="home-new">
          <div className="home-hero-side">
            <span className="home-eyebrow">New project</span>
            <h1 id="home-new">Start cutting.</h1>
            <p className="home-hero-sub">Pick the frame your video lives in — you can reshape it later, any time, in the editor.</p>
            <label className="home-fps">
              <span>Frame rate</span>
              <span className="seg" role="group" aria-label="Frame rate">
                {FPS.map((f) => (
                  <button key={f} className={fps === f ? 'on' : ''} aria-pressed={fps === f} onClick={() => setFps(f)}>{f} fps</button>
                ))}
              </span>
            </label>
          </div>
          <div className="home-hero-stage">
            <div className="home-frames">
              {PRESETS.map((p) => (
                <button key={p.ratio} className="home-frame-card" onClick={() => onNew(p, fps)} aria-label={`New ${p.ratio} project`}>
                  <span className="home-frame-slot"><StageFrame preset={p} /></span>
                  <b>{p.ratio}</b>
                  <span className="home-preset-use">{p.label} · {p.use}</span>
                  <span className="home-preset-size">{p.size}</span>
                  <span className="home-preset-go"><Plus size={14} /> New project</span>
                </button>
              ))}
            </div>
            <div className="home-stage-floor" aria-hidden="true" />
          </div>
        </section>

        <section className="home-quick" aria-label="Quick tools">
          <button className="home-action" onClick={onOpen}>
            <span className="home-action-icon"><FolderOpen size={18} /></span>
            <span className="home-action-text"><b>Open project…</b><span>Pick up a .clipcraft file where you left it.</span></span>
          </button>
          <button className="home-action" onClick={onImportMedia}>
            <span className="home-action-icon"><Import size={18} /></span>
            <span className="home-action-text"><b>Import media…</b><span>Start from clips you already have — a new project opens around them.</span></span>
          </button>
          <button className="home-action" onClick={() => onRecordStart?.(fps)}>
            <span className="home-action-icon"><Monitor size={18} /></span>
            <span className="home-action-text"><b>Record screen</b><span>Capture your screen straight onto a new timeline.</span></span>
          </button>
        </section>

        <section className="home-recents" aria-labelledby="home-recent-title">
          <div className="home-recents-head">
            <h2 id="home-recent-title"><Clock3 size={16} /> Recent projects · {recents.length}</h2>
            {recents.length > 0 && (
              <span className="home-search-wrap">
                <Search size={14} aria-hidden="true" />
                <input type="search" className="home-search" placeholder="Search projects…" value={query}
                  onChange={(e) => setQuery(e.target.value)} aria-label="Search recent projects" />
              </span>
            )}
          </div>
          {!recents.length && (
            <div className="home-empty">
              <EmptyStage />
              <p><b>Nothing on the shelf yet.</b></p>
              <p className="muted">The projects you save or open will wait for you here, one click away.</p>
            </div>
          )}
          {recents.length > 0 && !shownRecents.length && (
            <p className="muted">No projects match “{query}”.</p>
          )}
          {featured && (
            <div className="home-continue" onClick={() => onOpenRecent(featured)} title={featured.path}>
              <div className="home-card-thumb home-continue-thumb" style={{ aspectRatio: ratioCss(featured.ratio) }}>
                <RecentThumb r={featured} placeholder={30} />
                <span className="home-card-ratio">{featured.ratio || '16:9'}</span>
              </div>
              <div className="home-continue-body">
                <span className="home-eyebrow">Jump back in</span>
                <b className="home-continue-name">{featured.name || 'Untitled'}</b>
                <span className="home-continue-meta">{featured.ratio || '16:9'} · {relDate(featured.modifiedAt)}{featured.slotId && !featured.path ? ' · Auto-saved' : ''}</span>
                <span className="home-continue-cta">
                  <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onOpenRecent(featured); }}>
                    <Play size={13} fill="currentColor" /> Resume
                  </button>
                </span>
              </div>
              <button className="icon-btn home-card-x" aria-label={`Remove ${featured.name || 'project'} from recents`} title="Remove from recents"
                onClick={(e) => { e.stopPropagation(); onRemoveRecent(featured); }}><X size={14} /></button>
            </div>
          )}
          {rest.length > 0 && (
            <div className="home-grid">
              {rest.map((r) => (
                <div key={r.slotId || r.path} className="home-card" onClick={() => onOpenRecent(r)} title={r.path || ''}>
                  <div className="home-card-thumb" style={{ aspectRatio: ratioCss(r.ratio) }}>
                    <RecentThumb r={r} />
                    <span className="home-card-ratio">{r.ratio || '16:9'}</span>
                  </div>
                  <div className="home-card-body">
                    <b className="home-card-name">{r.name || 'Untitled'}</b>
                    <span className="home-card-meta">{relDate(r.modifiedAt)}{r.slotId && !r.path ? ' · Auto-saved' : ''}</span>
                  </div>
                  <button className="icon-btn home-card-x" aria-label={`Remove ${r.name || 'project'} from recents`} title="Remove from recents"
                    onClick={(e) => { e.stopPropagation(); onRemoveRecent(r); }}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="home-foot">
        <span>ClipCraft 1.0</span>
        <button className="home-dev" onClick={() => window.api.openHelp(DEV_INSTAGRAM_URL)} title="Developer on Instagram">
          Developed by <b>Hamza Abika</b> <Instagram size={13} /> @hamza_abika
        </button>
        <span>Cut it your way — works offline · no watermark</span>
      </footer>
    </div>
  );
}
