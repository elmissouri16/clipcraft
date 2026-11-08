import { samplePictureUrl } from "../../features/effects/previews.jsx";
import React, { useEffect, useId, useState } from 'react';
import { Clock3, Film, FolderOpen, Import, Monitor, Play, Plus, Search, X } from 'lucide-react';

// The developer's Instagram — shown in the About dialog.
export const DEV_INSTAGRAM_URL = 'https://www.instagram.com/hamza_abika/';

// Support ClipCraft's development — the developer's PayPal.me page, opened in the
// system browser (app:openHelp allowlist) from the Home quick tools and the top bar.
export const SUPPORT_URL = 'https://paypal.me/hamzaAbika';

// ClipCraft home / start screen (pass 3) — ClipCraft's own layout: a slim brand header with a
// time-aware greeting, a "stage" hero whose five format frames carry real photography (the
// bundled preview photos) and launch a project on click, a quick-tools row where every tile
// does something real, an aligned recent-project gallery with a Resume action for the latest project. No sidebar, no banner clone: the stage is the hero.

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
  const [failed, setFailed] = useState(false);
  const [a, b] = preset.ratio.split(':').map(Number);
  const wide = a / b >= 2;
  const style = { aspectRatio: `${a} / ${b}`, ...(wide ? { width: '100%' } : { height: 66 }) };
  return (
    <span className="home-frame" style={style} aria-hidden="true">
      <img className="home-frame-img" src={failed ? samplePictureUrl() : preset.img} alt="" draggable={false}
        onError={failed ? undefined : () => setFailed(true)} />
      <span className="home-frame-scrim" />
      <span className="home-frame-grid" />
      <span className="home-frame-chip"><Play size={10} fill="currentColor" /></span>
    </span>
  );
}

// A recent's thumbnail: the video sprite's first frame, an image, or the placeholder glyph.
// Fixed gallery cells contain the full poster; sprite frames are clipped before fitting.
function RecentThumb({ r, placeholder = 26 }) {
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
  // The version badge reads the real app version (package.json via app:version) —
  // it must never drift from the shipped build again.
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.api?.appVersion?.().then((v) => { if (v) setVersion(v.split(".").slice(0, 2).join('.')); }).catch(() => {});
  }, []);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shownRecents = q ? recents.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.ratio || '').includes(q)) : recents;
  const latest = recents[0] || null;
  return (
    <div className="home">
      <header className="home-top">
        <img src="./logo.png" alt="" className="home-logo" draggable={false} />
        <div className="home-brand">
          <span className="home-name">Clip<b>Craft</b></span>
          <span className="home-greet">{greeting()} — ready when you are.</span>
        </div>
        <span className="home-ver">{version ? `Version ${version}` : 'ClipCraft'}</span>
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
          <button className="home-action" onClick={() => window.api.openHelp(SUPPORT_URL)} aria-label="Support ClipCraft on PayPal">
            <span className="home-action-icon"><img src="./paypal.svg" alt="" className="home-paypal-mark" draggable={false} /></span>
            <span className="home-action-text"><b>Support the project</b><span>Support its development via PayPal.</span></span>
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
          {shownRecents.length > 0 && (
            <div className="home-grid">
              {shownRecents.map((r) => {
                const resume = r === latest;
                const name = r.name || 'Untitled';
                return (
                  <div key={r.slotId || r.path} className={`home-card${resume ? ' home-card-latest' : ''}`}>
                    <button type="button" className="home-card-open" onClick={() => onOpenRecent(r)} title={r.path || name}
                      aria-label={`${resume ? 'Resume' : 'Open'} ${name}`}>
                      <span className="home-card-thumb">
                        <RecentThumb r={r} />
                        {resume && <span className="home-card-latest-tag">Jump back in</span>}
                        <span className="home-card-ratio">{r.ratio || '16:9'}</span>
                        <span className="home-card-open-cta"><Play size={12} fill="currentColor" /> {resume ? 'Resume' : 'Open'}</span>
                      </span>
                      <span className="home-card-body">
                        <b className="home-card-name" dir="auto">{name}</b>
                        <span className="home-card-meta">{relDate(r.modifiedAt)}{r.slotId && !r.path ? ' · Auto-saved' : ''}</span>
                      </span>
                    </button>
                    <button type="button" className="icon-btn home-card-x" aria-label={`Remove ${name} from recents`} title="Remove from recents"
                      onClick={() => onRemoveRecent(r)}><X size={14} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

    </div>
  );
}
