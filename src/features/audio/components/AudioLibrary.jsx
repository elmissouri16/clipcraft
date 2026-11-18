import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Loader2, Mic, Music, Pause, Play, Plus, Square, Upload, WifiOff } from 'lucide-react';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { FavStar, favLibrary, useFavorites } from "../../../app/favorites.jsx";
import TextToSpeech from './TextToSpeech.jsx';
import PackMusic from './PackMusic.jsx';
import OpenverseNotice from '../../library/components/OpenverseNotice.jsx';
import BrowserControls, { BrowserField, CREDIT_OPTIONS, creditSummary } from '../../library/components/BrowserControls.jsx';
import { useBrowserState } from '../../library/browserState.js';
import { projectCredits } from '../../library/credits.js';
import { t, tn } from '../../../i18n/index.js';

// Chip label -> search words. Openverse matches titles and tags, so some genres search better under another word.
export const MUSIC_TAGS = [
  ['Vlog', 'upbeat'], ['Happy', 'happy'], ['Chill', 'chill'], ['Epic', 'epic'], ['Cinematic', 'cinematic'], ['Inspiring', 'inspiring'],
  ['Hip hop', 'beat'], ['Rap', 'rap'], ['Dance', 'dance'], ['Electronic', 'electro'], ['Funny', 'funny'], ['Romantic', 'romantic'],
  ['Sad', 'sad'], ['Travel', 'travel'], ['Fitness', 'energy'], ['Corporate', 'motivational'], ['Acoustic', 'guitar'],
];
// Sound effects: [label, search words, online category]. Both online sources are searched
// together (the category browses one of them, the words the other).
export const SFX_TAGS = [
  ['Transition', 'transition', 'transition', ['Transition']], ['Whoosh', 'whoosh'], ['UI', 'interface', 'ui', ['UI']],
  ['Impact', 'impact', 'impact', ['Hit']], ['Cartoon', 'cartoon', 'cartoon', ['Funny']], ['Pop', 'pop'], ['Click', 'click'],
  ['Notification', 'notification'], ['Laugh', 'laugh'], ['Applause', 'applause'], ['Camera', 'camera'], ['Explosion', 'explosion'],
  ['Magic', 'magic'], ['Horror', 'horror', 'horror'], ['Ambience', 'ambience', 'ambience', ['Ambience']], ['Animals', 'animal', 'animal'],
  ['Human', 'human', 'human'], ['Footsteps', 'footsteps', 'footsteps'], ['Crowd', 'crowd', 'crowd'], ['Vehicles', 'vehicle', 'vehicle'],
  ['Doors', 'door', 'door'], ['Water', 'water', 'water'], ['Wind', 'wind'], ['Foley', 'foley', 'foley'],
];

// Soundza (sound effects from soundza.com, searched through its API): [label, search params].
// Chips lean on the API's own ranking filters (good_for) or a style; the words go in the box.
export const SOUNDZA_TAGS = [
  ['Whoosh', { q: 'whoosh' }], ['Transition', { goodFor: 'transition' }], ['UI clicks', { goodFor: 'ui_click' }],
  ['Notification', { goodFor: 'notification' }], ['Impact', { goodFor: 'impact_on_beat' }], ['Reveal', { goodFor: 'reveal' }],
  ['Footsteps', { goodFor: 'footsteps' }], ['Magic', { q: 'magic' }], ['Explosion', { q: 'explosion' }],
  ['Cartoon', { style: 'cartoon' }], ['Retro', { style: 'retro' }], ['Ambience', { type: 'ambience', goodFor: 'background_bed' }],
];

// Trolls (meme sounds from MyInstants): [label, search words, list]. Trending and Best browse the site's lists.
export const TROLL_TAGS = [
  ['Trending', '', 'trending'], ['Best of all time', '', 'best'], ['Bruh', 'bruh'], ['Vine boom', 'vine boom'], ['Laugh', 'laugh'],
  ['Fail', 'fail'], ['Wow', 'wow'], ['Airhorn', 'airhorn'], ['Sus', 'among us'], ['Sad', 'sad violin'], ['Scream', 'scream'],
  ['Fart', 'fart'], ['Anime', 'anime'], ['Gaming', 'game over'],
];

// A chip's label in the UI language; the English label stays the chip's id (sections are `kind:Label`).
export const tagLabel = (label) => (label === 'All' ? t('audio.all_categories') : t(`audio.tag_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`));

// One shared player for previews: play() resolves the file (online sounds are downloaded once
// into the library folder) and plays it. Soundza results carry a preview link: the main
// process fetches that small preview file once (the page itself may only play local media),
// and it never counts as a download of the sound.
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
    // Imported files (favorites) play straight from disk; Soundza previews are fetched by the
    // main process; other library sounds are resolved (and downloaded once).
    const res = item.path ? { path: item.path } : item.previewUrl ? await window.api.soundzaPreview(item) : await window.api.libraryFile(item);
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
      <button className="lib-play" onClick={() => preview.toggle(item)} aria-label={playing ? t('audio.stop_item', { title: item.title }) : t('audio.play_item', { title: item.title })}>
        {playing && preview.loading ? <Loader2 size={15} className="spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <div className="lib-meta">
        <b title={item.title}>{item.title}</b>
        <span className="lib-sub">
          <span>{item.provider === 'sfxmint' || item.provider === 'soundza' ? (item.category || '').replace(/^./, (c) => c.toUpperCase()) || item.creator : item.creator}{item.duration ? ` · ${formatTime(item.duration).slice(0, 5)}` : ''}</span>
          {item.license === 'unknown' && <i className="lic unknown">{t('audio.licence_unknown')}</i>}
          {item.license && item.license !== 'unknown' && (
            <i className={`lic ${item.license}`} title={item.license === 'by' ? t('audio.free_to_use_with_a_credit') : t('audio.free_to_use_no_credit_needed')}>
              {item.license === 'by' ? t('audio.credit_required') : t('audio.no_credit_required')}
            </i>
          )}
        </span>
      </div>
      {item.origin === 'openverse' && <button className="icon-btn sm" aria-label={t('audio.view_source_for', { title: item.title })} title={t('audio.original_source_and_licence')} onDoubleClick={e => e.stopPropagation()} onClick={() => window.api.openverseSource(item)}><ExternalLink size={13} /></button>}
      {fav && <FavStar entry={fav} />}
      <button className="lib-add" onClick={() => onAdd(item)} aria-label={t('audio.add_item_at_the_playhead', { title: item.title })} title={t('audio.add_at_the_playhead')} disabled={adding === item.id}>
        {adding === item.id ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

function OnlineSearch({ kind, tags, preview, onAdd, adding, fixedTag, onSectionChange, navigation, providerControl, browserMemory }) {
  const [state, patch] = useBrowserState(browserMemory, `audio:search:${kind}`, { q: '', term: '', licenses: 'cc0' });
  const { q, term, licenses } = state;
  const request = useRef(0);
  const openverse = kind !== 'trolls';
  const tag = fixedTag || 'All';
  const chip = tags.find(([label]) => label === tag);
  const query = [term.trim(), chip?.[1] || ''].filter(Boolean).join(' ') || (kind === 'music' ? 'background music' : kind === 'trolls' ? '' : 'sound effect');
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  const source = kind === 'trolls' ? 'MyInstants' : 'Openverse';
  const load = async page => {
    const seq = ++request.current;
    setRes(r => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    try {
      const out = await window.api.librarySearch({ kind, q: query, licenses, category: !term.trim() ? chip?.[2] : '', page });
      if (seq !== request.current) return;
      if (out.error) return setRes(r => ({ ...r, loading: false, error: out.error }));
      setRes(r => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
    } catch (e) { if (seq === request.current) setRes(r => ({ ...r, loading: false, error: e.message })); }
  };
  useEffect(() => {
    load(1); return () => { request.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tag, licenses, term]);
  return <>
    <BrowserControls query={q} onQuery={q => patch({ q, ...(!q ? { term: '' } : {}) })} onSearch={() => q === term ? load(1) : patch({ term: q })}
      placeholder={kind === 'music' ? t('audio.search_online_music') : kind === 'trolls' ? t('audio.search_meme_sounds') : t('audio.search_sound_effects')} ariaLabel={t('audio.search_the_library')} navigation={navigation}
      summary={<>{source}{` · ${openverse ? creditSummary(licenses) : t('audio.licence_unknown')}`}{chip && ` · ${tagLabel(tag)}`}</>}
      onReset={() => { patch({ licenses: 'cc0' }); onSectionChange(`${kind}:All`); }}>
      {providerControl}
      <BrowserField label={kind === 'music' ? t('audio.genre') : t('audio.category')} ariaLabel={t('audio.audio_category')} value={tag} onChange={value => onSectionChange(`${kind}:${value}`)} options={[{ value: 'All', label: tagLabel('All') }, ...tags.map(([value]) => ({ value, label: tagLabel(value) }))]} />
      {openverse && <BrowserField label={t('audio.copyright_attribution')} ariaLabel={t('audio.audio_licences')} value={licenses} onChange={licenses => patch({ licenses })} options={CREDIT_OPTIONS} />}
      {openverse && <p className="browser-filter-help">{t('audio.cc_by_includes_cc0_results_and_media_that')}</p>}
    </BrowserControls>
    {res.error && <div className="lib-error"><WifiOff size={15} /><span>{res.error}</span><button className="btn btn-sm" onClick={() => load(1)}>{t('audio.retry')}</button></div>}
    <div className="lib-list">{res.results.map(it => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}</div>
    {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('settings.loading')}</div>}
    {!res.loading && !res.error && !res.results.length && <div className="browser-empty"><p>{term ? t('audio.no_matches_on_source_for_term', { source, term }) : t('audio.no_matches_on_source', { source })}</p>{openverse && licenses === 'cc0' && <button className="btn btn-sm" onClick={() => patch({ licenses: 'attribution' })}>{t('audio.include_credit_required_media')}</button>}</div>}
    {!res.loading && res.page < res.pages && res.results.length > 0 && <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('audio.load_more')}</button>}
    {openverse ? <OpenverseNotice /> : <p className="lib-note">{t('audio.meme_sounds_from_myinstants_their_rights_a')}</p>}
  </>;
}

function SoundzaSearch({ fixedTag, preview, onAdd, adding, onOpenSettings, navigation, providerControl, browserMemory, settingsVersion, onSectionChange }) {
  const [hasKey, setHasKey] = useState(null);
  const [state, patch] = useBrowserState(browserMemory, 'audio:search:soundza', { q: '', term: '' });
  const { q, term } = state;
  const request = useRef(0);
  const tag = fixedTag || 'All';
  const chip = SOUNDZA_TAGS.find(([label]) => label === tag);
  const [res, setRes] = useState({ results: [], page: 0, pages: 0, loading: false, error: '' });
  useEffect(() => { let alive = true; window.api.soundzaStatus().then(s => { if (alive) setHasKey(!!s.hasKey); }).catch(() => { if (alive) setHasKey(false); }); return () => { alive = false; }; }, [settingsVersion]);
  const load = async page => {
    const seq = ++request.current;
    setRes(r => ({ ...r, loading: true, error: '', ...(page === 1 ? { results: [] } : {}) }));
    try {
      const out = await window.api.soundzaSearch({ ...chip?.[1], q: term.trim() || chip?.[1]?.q || '', page });
      if (seq !== request.current) return;
      if (out.error) return setRes(r => ({ ...r, loading: false, error: out.error }));
      setRes(r => ({ results: page === 1 ? out.results : [...r.results, ...out.results], page: out.page, pages: out.pages, loading: false, error: '' }));
    } catch (e) { if (seq === request.current) setRes(r => ({ ...r, loading: false, error: e.message })); }
  };
  useEffect(() => { if (hasKey) load(1); return () => { request.current++; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, tag, term]);
  return <>
    <BrowserControls query={q} onQuery={q => patch({ q, ...(!q ? { term: '' } : {}) })} onSearch={() => term === q ? hasKey && load(1) : patch({ term: q })} placeholder={t('audio.search_sound_effects')} ariaLabel={t('audio.search_soundza')} navigation={navigation} summary={<>Soundza{chip && ` · ${tagLabel(tag)}`}</>} disabled={!hasKey} onReset={() => { onSectionChange('soundza:All'); }}>
      {providerControl}
      <BrowserField label={t('audio.category')} ariaLabel={t('audio.audio_category')} value={tag} onChange={value => onSectionChange(`soundza:${value}`)} options={[{ value: 'All', label: tagLabel('All') }, ...SOUNDZA_TAGS.map(([value]) => ({ value, label: tagLabel(value) }))]} />
    </BrowserControls>
    {hasKey === null ? <p className="empty-note">{t('audio.checking_soundza_connection')}</p> : !hasKey ? <div className="card stock-key"><div className="card-row"><span className="card-icon"><KeyRound size={18} /></span><div><b>{t('audio.connect_soundza')}</b><p>{t('audio.add_a_soundza_key_in_settings_api_keys_to')}</p></div></div><div className="stock-key-actions"><button className="btn btn-sm" onClick={() => window.api.openHelp('https://soundza.com/developers/keys')}><ExternalLink size={13} /> {t('audio.get_a_free_key')}</button><button className="btn btn-primary btn-sm" onClick={() => onOpenSettings?.('services:soundza')}>{t('settings.add_api_key')}</button></div></div> : <>
      {res.error && <div className="lib-error"><WifiOff size={15} /><span>{res.error}</span><button className="btn btn-sm" onClick={() => load(1)}>{t('audio.retry')}</button></div>}
      <div className="lib-list">{res.results.map(it => <Row key={it.id} item={it} preview={preview} onAdd={onAdd} adding={adding} />)}</div>
      {res.loading && <div className="lib-loading"><Loader2 size={16} className="spin" /> {t('settings.loading')}</div>}
      {!res.loading && !res.error && !res.results.length && <p className="empty-note">{t('audio.no_matches_on_soundza_with_the_current_fil')}</p>}
      {!res.loading && res.page < res.pages && res.results.length > 0 && <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(res.page + 1)}>{t('audio.load_more')}</button>}
    </>}
    <p className="lib-note">{t('audio.sounds_from_soundza_under_the_soundza_stan')}</p>
  </>;
}

// Audio panel: Music, Sound effects and Yours (imported audio and voice-over).
export default function AudioLibrary({ media, project, onImport, onAddMedia, onLibraryAdd, onAddFile, onTtsAdd, onTtsBegin, selectedText, onOpenSettings, settingsVersion, recorder, onStartRecord, MediaCard, onRemoveMedia, onPeek, peekId, onShowCredits, onSectionChange, navigation, providerControl, browserMemory, section = 'music:All' }) {
  // Split on the FIRST colon only: pack sections carry a second one ('music:pack:Library').
  const [group, sub] = section.includes(':') ? [section.slice(0, section.indexOf(':')), section.slice(section.indexOf(':') + 1)] : [section, ''];
  const view = group === 'yours' && sub === 'favorites' ? 'favorites' : group;
  // The synthesized built-in sounds were removed from the app; favorites saved while they
  // existed are dropped here so they never offer a sound that is gone.
  const favs = useFavorites().list.filter((e) => e.type === 'audio' && e.item?.provider !== 'builtin');
  const [adding, setAdding] = useState(null);
  const [addError, setAddError] = useState('');
  const [copied, setCopied] = useState(false);
  const preview = usePreview();
  useEffect(() => preview.stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => preview.stop(), [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (item) => {
    setAdding(item.id);
    setAddError('');
    const res = await onLibraryAdd(item);
    setAdding(null);
    if (res?.error) setAddError(res.error);
  };

  const credits = projectCredits({ ...project, media });
  const copyCredits = async () => {
    await navigator.clipboard.writeText(credits.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const audio = media.filter((m) => m.type === 'audio');
  return (
    <>
      {(preview.error || addError) && <p className="error-text">{preview.error || addError}</p>}
      {credits.length > 0 && ['yours', 'favorites'].includes(view) && <div className="lib-credit-reminder">
        <button type="button" className="lib-credit-link" onClick={onShowCredits} title={t('audio.view_attribution_for_media_used_on_the_tim')}>
          {tn('audio.credits_needed_count', credits.length)}
        </button>
        <button type="button" className="icon-btn sm" onClick={copyCredits} aria-label={copied ? t('audio.credits_copied') : t('audio.copy_credits')} title={copied ? t('audio.copied') : t('audio.copy_credits')}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>}

      {(view === 'music' || view === 'sfx') && (sub.startsWith('pack:') ? (
        <PackMusic key={`${view}:${sub}`} group={view === 'music' ? 'Music' : 'Sound FX'} collection={sub.slice(5)} onAddFile={onAddFile} navigation={navigation} browserMemory={browserMemory} />
      ) : <OnlineSearch key={view} kind={view === 'music' ? 'music' : 'sfx'} tags={view === 'music' ? MUSIC_TAGS : SFX_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} onSectionChange={onSectionChange} navigation={navigation} providerControl={providerControl} browserMemory={browserMemory} />)}
      {view === 'soundza' && <SoundzaSearch fixedTag={sub} preview={preview} onAdd={add} adding={adding} onOpenSettings={onOpenSettings} onSectionChange={onSectionChange} navigation={navigation} providerControl={providerControl} browserMemory={browserMemory} settingsVersion={settingsVersion} />}
      {view === 'trolls' && <OnlineSearch key="trolls" kind="trolls" tags={TROLL_TAGS} fixedTag={sub} preview={preview} onAdd={add} adding={adding} onSectionChange={onSectionChange} navigation={navigation} browserMemory={browserMemory} />}

      {view === 'favorites' && (
        <>
          <div className="tab-title">{t('audio.favorite_sounds')}</div>
          {!favs.length && (
            <p className="empty-note">{t('audio.click_the_star_on_any_sound_music_sound_ef')}</p>
          )}
          <div className="lib-list">
            {favs.map((e) => (e.source === 'file' ? (
              e.missing ? (
                <div key={e.key} className="lib-row missing" title={e.item.path}>
                  <div className="lib-meta"><b>{e.item.name}</b><span className="lib-sub"><span>{t('audio.file_moved_or_deleted')}</span></span></div>
                  <FavStar entry={e} />
                </div>
              ) : (
                <Row key={e.key} preview={preview} adding={adding} fav={e}
                  item={{ id: e.key, title: e.item.name, path: e.item.path, provider: 'file', creator: t('audio.your_file'), duration: e.item.duration }}
                  onAdd={async () => { setAdding(e.key); const r = await onAddFile(e.item.path); setAdding(null); if (r?.error) setAddError(r.error); }} />
              )
            ) : (
              <Row key={e.key} item={e.item} preview={preview} onAdd={add} adding={adding} fav={e} />
            )))}
          </div>
        </>
      )}

      {view === 'tts' && <TextToSpeech onAdd={onTtsAdd} onBegin={onTtsBegin} selectedText={selectedText} onOpenSettings={onOpenSettings} settingsVersion={settingsVersion} />}

      {view === 'credits' && (
        <>
          <div className="tab-title">{t('audio.credits')}</div>
          {!credits.length && (
            <p className="empty-note">{t('audio.no_media_on_the_timeline_requires_cc_by_at')}</p>
          )}
        </>
      )}

      {view === 'yours' && (
        <>
          <div className="tab-title">{t('audio.this_projects_audio')} <button className="btn btn-primary btn-sm" onClick={onImport}><Upload size={14} /> {t('audio.import')}</button></div>
          <div className={`card rec ${recorder.recording ? 'live' : ''}`}>
            <div className="card-row">
              <span className="card-icon"><Mic size={18} /></span>
              <div>
                <b>{t('audio.voice_over')}</b>
                <p>{t('audio.recorded_from_the_playhead_and_added_to_th')}</p>
              </div>
            </div>
            {recorder.recording ? (
              <button className="btn btn-danger" onClick={recorder.stop}><Square size={13} /> {t('audio.stop_after_seconds', { seconds: Math.round(recorder.seconds) })}</button>
            ) : (
              <button className="btn" onClick={onStartRecord}><span className="rec-dot" /> {t('audio.record')}</button>
            )}
            {recorder.error && <p className="error-text">{recorder.error}</p>}
          </div>
          {audio.length ? (
            <div className="asset-list">
              {audio.map((m) => <MediaCard key={m.id} m={m} onAdd={onAddMedia} onRemove={onRemoveMedia} onPeek={onPeek} peeking={peekId === m.id} />)}
            </div>
          ) : (
            <p className="empty-note"><Music size={14} /> {t('audio.import_mp3_wav_or_m4a_files_or_add_music_f')}</p>
          )}
        </>
      )}

      {credits.length > 0 && view === 'credits' && (
        <div className="card lib-credits">
          <b>{t('audio.credits_needed')}</b>
          <p>{t('audio.these_cc_by_images_and_sounds_are_on_the_t')}</p>
          <pre>{credits.join('\n')}</pre>
          <button className="btn btn-sm" onClick={copyCredits}>{copied ? <><Check size={13} /> {t('audio.copied')}</> : <><Copy size={13} /> {t('audio.copy_credits')}</>}</button>
        </div>
      )}
      {view === 'credits' && (
        <p className="lib-note">{t('audio.openverse_searches_use_cc0_by_default_with')}</p>
      )}
    </>
  );
}
