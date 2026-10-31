import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Mic, Music, Pause, Play, Plus, Search, Sparkles, Square, Upload, WifiOff, X } from 'lucide-react';
import { formatTime, toFileUrl } from '../store.js';
import { FavStar, favLibrary, useFavorites } from '../favorites.jsx';
import TextToSpeech from './TextToSpeech.jsx';
import PackMusic from './PackMusic.jsx';

// Chip label -> search words. Openverse matches titles and tags, so some genres search better under another word.
export const MUSIC_TAGS = [
  ['Vlog', 'upbeat'], ['Happy', 'happy'], ['Chill', 'chill'], ['Epic', 'epic'], ['Cinematic', 'cinematic'], ['Inspiring', 'inspiring'],
  ['Hip hop', 'beat'], ['Rap', 'rap'], ['Dance', 'dance'], ['Electronic', 'electro'], ['Funny', 'funny'], ['Romantic', 'romantic'],
  ['Sad', 'sad'], ['Travel', 'travel'], ['Fitness', 'energy'], ['Corporate', 'motivational'], ['Acoustic', 'guitar'],
];
// Sound effects: [label, search words, online category, offline categories]. Both online sources are searched
// together (the category browses one of them, the words the other); matching offline effects come first.
export const SFX_TAGS = [
  ['Transition', 'transition', 'transition', ['Transition']], ['Whoosh', 'whoosh'], ['UI', 'interface', 'ui', ['UI']],
  ['Impact', 'impact', 'impact', ['Hit']], ['Cartoon', 'cartoon', 'cartoon', ['Funny']], ['Pop', 'pop'], ['Click', 'click'],
  ['Notification', 'notification'], ['Laugh', 'laugh'], ['Applause', 'applause'], ['Camera', 'camera'], ['Explosion', 'explosion'],
  ['Magic', 'magic'], ['Horror', 'horror', 'horror'], ['Ambience', 'ambience', 'ambience', ['Ambience']], ['Animals', 'animal', 'animal'],
  ['Human', 'human', 'human'], ['Footsteps', 'footsteps', 'footsteps'], ['Crowd', 'crowd', 'crowd'], ['Vehicles', 'vehicle', 'vehicle'],
  ['Doors', 'door', 'door'], ['Water', 'water', 'water'], ['Wind', 'wind'], ['Foley', 'foley', 'foley'],
];

// Trolls (meme sounds from MyInstants): [label, search words, list]. Trending and Best browse the site's lists.
export const TROLL_TAGS = [
  ['Trending', '', 'trending'], ['Best of all time', '', 'best'], ['Bruh', 'bruh'], ['Vine boom', 'vine boom'], ['Laugh', 'laugh'],
  ['Fail', 'fail'], ['Wow', 'wow'], ['Airhorn', 'airhorn'], ['Sus', 'among us'], ['Sad', 'sad violin'], ['Scream', 'scream'],
  ['Fart', 'fart'], ['Anime', 'anime'], ['Gaming', 'game over'],
];

// One shared player for previews: play() resolves the file (built-in effects are made on first use,
// online sounds are downloaded once into the library folder) and plays it.
function usePreview() {
  const audio = useRef(null);
  const [state, setState] = useState({ id: null, loading: false, error: '' });
  useEffect(() => {
    const a = new Audio();
    a.onended = () => setState((s) => ({ ...s, id: null }));
    audio.current = a;
    return () => a.pause();
  }, []);
  const toggle = async (item) => {
    const a = audio.current;
    if (state.id === item.id && !state.loading) {
      a.pause();
      return setState({ id: null, loading: false, error: '' });
    }
    a.pause();
    setState({ id: item.id, loading: true, error: '' });
    // Imported files (favorites) play straight from disk; library sounds are resolved (and downloaded once).
    const res = item.path ? { path: item.path } : await window.api.libraryFile(item);
    if (res.error) return setState({ id: null, loading: false, error: res.error });
    a.src = toFileUrl(res.path);
    a.play().catch(() => {});
    setState({ id: item.id, loading: false, error: '' });
  };
  const stop = () => {
    audio.current?.pause();
    setState({ id: null, loading: false, error: '' });
  };
  return { ...state, toggle, stop };
}

function Row({ item, preview, onAdd, adding, fav = item.path ? null : favLibrary(item) }) {
  const playing = preview.id === item.id;
  return (
    <div className={`lib-row ${playing ? 'on' : ''}`} onDoubleClick={() => onAdd(item)}>
      <button className="lib-play" onClick={() => preview.toggle(item)} aria-label={playing ? `Stop ${item.title}` : `Play ${item.title}`}>
        {playing && preview.loading ? <Loader2 size={15} className="spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <div className="lib-meta">
        <b title={item.title}>{item.title}</b>
        <span className="lib-sub">
          <span>{item.provider === 'builtin' ? item.category : item.provider === 'sfxmint' ? (item.category || '').replace(/^./, (c) => c.toUpperCase()) : item.creator}{item.duration ? ` · ${formatTime(item.duration).slice(0, 5)}` : ''}</span>
          {item.license && !['builtin', 'unknown'].includes(item.license) && (
            <i className={`lic ${item.license}`} title={item.license === 'by' ? 'Free to use with a credit to the artist' : 'Free to use, no credit needed'}>
              {item.license === 'by' ? 'Credit' : 'Free'}
            </i>
          )}
        </span>
      </div>
      {fav && <FavStar entry={fav} />}
      <button className="lib-add" onClick={() => onAdd(item)} aria-label={`Add ${item.title} at the playhead`} title="Add at the playhead" disabled={adding === item.id}>
        {adding === item.id ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function OnlineSearch({ kind, tags, preview, onAdd, adding, fixedTag, offline = [] }) {
  const [q, setQ] = useState('');
  const [ownTag, setTag] = useState(tags[0][0]);
  const tag = fixedTag || ownTag;
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const chip = tags.find(([label]) => label === tag) || tags[0];
  const query = q.trim() || chip[1];
  const load = async (page) => {
    setRes((r) => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    const out = await window.api.librarySearch({ kind, q: query, category: q.trim() ? '' : chip[2], page });
    if (out.error) return setRes((r) => ({ ...r, loading: false, error: out.error }));
    setRes((r) => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(''); }, [fixedTag]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [tag, kind]);
  return (
    <>
      <form className="lib-search" onSubmit={(e) => { e.preventDefault(); load(1); }}>
        <Search size={14} aria-hidden="true" />
        <input type="search" value={q} placeholder={kind === 'music' ? 'Search music' : kind === 'trolls' ? 'Search meme sounds' : 'Search sound effects'} aria-label="Search the library"
          onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => setQ('')}><X size={13} /></button>}
      </form>
      {!fixedTag && <div className="chips scroll-x">
        {tags.map(([t]) => (
          <button key={t} className={`chip ${!q.trim() && tag === t ? 'on' : ''}`} onClick={() => { setQ(''); setTag(t); }}>{t}</button>
        ))}
      </div>}
      {res.error && (
        <div className="lib-error"><WifiOff size={15} /> <span>{res.error}</span> <button className="btn btn-sm" onClick={() => load(1)}>Retry</button></div>
      )}
      <div className="lib-list">
        {!q.trim() && offline.map((it) => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}
        {res.results.map((it) => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}
        {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> Loading…</div>}
        {!res.loading && !res.error && !res.results.length && <p className="empty-note">Nothing found for “{query || tag}”.</p>}
        {!res.loading && res.page < res.pages && res.results.length > 0 && (
          <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>Load more</button>
        )}
      </div>
    </>
  );
}

// Audio panel like CapCut's: Music, Sound effects and Yours (imported audio and voice-over).
export default function AudioLibrary({ media, project, onImport, onAddMedia, onLibraryAdd, onAddFile, onTtsAdd, selectedText, onOpenSettings, recorder, onStartRecord, MediaCard, onRemoveMedia, onPeek, peekId, section = 'music:Vlog' }) {
  // Split on the FIRST colon only: pack sections carry a second one ('music:pack:Library').
  const [group, sub] = section.includes(':') ? [section.slice(0, section.indexOf(':')), section.slice(section.indexOf(':') + 1)] : [section, ''];
  const view = group === 'yours' && sub === 'favorites' ? 'favorites' : group;
  const favs = useFavorites().list.filter((e) => e.type === 'audio');
  const [adding, setAdding] = useState(null);
  const [addError, setAddError] = useState('');
  const [builtin, setBuiltin] = useState([]);
  const [copied, setCopied] = useState(false);
  const preview = usePreview();
  useEffect(() => { window.api.libraryBuiltin().then(setBuiltin); }, []);
  useEffect(() => preview.stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => preview.stop(), [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (item) => {
    setAdding(item.id);
    setAddError('');
    const res = await onLibraryAdd(item);
    setAdding(null);
    if (res?.error) setAddError(res.error);
  };

  // Credit lines for CC BY sounds used on the timeline.
  const used = new Set([...project.audioClips, ...project.videoClips, ...(project.overlayClips || [])].map((c) => c.mediaId));
  const credits = media.filter((m) => m.credit && m.credit.license === 'by' && used.has(m.id)).map((m) => m.credit.line);
  const copyCredits = async () => {
    await navigator.clipboard.writeText(credits.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const audio = media.filter((m) => m.type === 'audio');
  const groups = [...new Set(builtin.map((b) => b.category))];
  return (
    <>
      {(preview.error || addError) && <p className="error-text">{preview.error || addError}</p>}

      {view === 'music' && (sub.startsWith('pack:') ? (
        <PackMusic collection={sub.slice(5)} onAddFile={onAddFile} />
      ) : (
        <>
          <div className="tab-title">Music · {sub}</div>
          <OnlineSearch kind="music" tags={MUSIC_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} />
        </>
      ))}

      {view === 'sfx' && sub === 'offline' && (
        <>
          <div className="tab-title"><Sparkles size={13} /> Sound effects · work offline</div>
          {groups.map((g) => (
            <div key={g} className="lib-group">
              <span className="lib-group-name">{g}</span>
              <div className="lib-list">
                {builtin.filter((b) => b.category === g).map((it) => <Row key={it.id} item={it} preview={preview} onAdd={add} adding={adding} />)}
              </div>
            </div>
          ))}
        </>
      )}
      {view === 'sfx' && sub !== 'offline' && (
        <>
          <div className="tab-title">Sound effects · {sub}</div>
          <p className="lib-src-note">Free for any video. Sounds marked “Credit” need a credit line (listed under Credits).</p>
          <OnlineSearch kind="sfxall" tags={SFX_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding}
            offline={builtin.filter((b) => (SFX_TAGS.find(([t]) => t === sub)?.[3] || []).includes(b.category))} />
        </>
      )}

      {view === 'trolls' && (
        <>
          <div className="tab-title">Trolls · {sub}</div>
          <OnlineSearch kind="trolls" tags={TROLL_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} />
          <p className="lib-note">Sounds from <a href="#" onClick={(e) => { e.preventDefault(); window.api.openHelp('https://www.myinstants.com'); }}>MyInstants</a>.</p>
        </>
      )}

      {view === 'favorites' && (
        <>
          <div className="tab-title">Favorite sounds</div>
          {!favs.length && (
            <p className="empty-note">Click the star on any sound (music, sound effects or your own audio) to keep it here for all your projects.</p>
          )}
          <div className="lib-list">
            {favs.map((e) => (e.source === 'file' ? (
              e.missing ? (
                <div key={e.key} className="lib-row missing" title={e.item.path}>
                  <div className="lib-meta"><b>{e.item.name}</b><span className="lib-sub"><span>File moved or deleted</span></span></div>
                  <FavStar entry={e} />
                </div>
              ) : (
                <Row key={e.key} preview={preview} adding={adding} fav={e}
                  item={{ id: e.key, title: e.item.name, path: e.item.path, provider: 'file', creator: 'Your file', duration: e.item.duration }}
                  onAdd={async () => { setAdding(e.key); const r = await onAddFile(e.item.path); setAdding(null); if (r?.error) setAddError(r.error); }} />
              )
            ) : (
              <Row key={e.key} item={e.item} preview={preview} onAdd={add} adding={adding} fav={e} />
            )))}
          </div>
        </>
      )}

      {view === 'tts' && <TextToSpeech onAdd={onTtsAdd} selectedText={selectedText} onOpenSettings={onOpenSettings} />}

      {view === 'credits' && (
        <>
          <div className="tab-title">Credits</div>
          {!credits.length && (
            <p className="empty-note">No sound on the timeline needs a credit. Offline and CC0 sounds never do;
              music and sound effects marked “Credit” list their credit line here once you use them.</p>
          )}
        </>
      )}

      {view === 'yours' && (
        <>
          <div className="tab-title">Your audio <button className="btn btn-primary btn-sm" onClick={onImport}><Upload size={14} /> Import</button></div>
          <div className={`card rec ${recorder.recording ? 'live' : ''}`}>
            <div className="card-row">
              <span className="card-icon"><Mic size={18} /></span>
              <div>
                <b>Voice-over</b>
                <p>Recorded from the playhead and added to the Audio track</p>
              </div>
            </div>
            {recorder.recording ? (
              <button className="btn btn-danger" onClick={recorder.stop}><Square size={13} /> Stop · {Math.round(recorder.seconds)}s</button>
            ) : (
              <button className="btn" onClick={onStartRecord}><span className="rec-dot" /> Record</button>
            )}
            {recorder.error && <p className="error-text">{recorder.error}</p>}
          </div>
          {audio.length ? (
            <div className="asset-list">
              {audio.map((m) => <MediaCard key={m.id} m={m} onAdd={onAddMedia} onRemove={onRemoveMedia} onPeek={onPeek} peeking={peekId === m.id} />)}
            </div>
          ) : (
            <p className="empty-note"><Music size={14} /> Import MP3, WAV or M4A files, or add music from the library.</p>
          )}
        </>
      )}

      {credits.length > 0 && (
        <div className="card lib-credits">
          <b>Credits needed</b>
          <p>These CC BY sounds are on the timeline. Paste the credits in your video description.</p>
          <pre>{credits.join('\n')}</pre>
          <button className="btn btn-sm" onClick={copyCredits}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy credits</>}</button>
        </div>
      )}
      {(view === 'music' || view === 'credits') && (
        <p className="lib-note">Only CC0, public domain and CC BY sounds are shown: free to use in your videos; CC BY needs a credit.</p>
      )}
    </>
  );
}
