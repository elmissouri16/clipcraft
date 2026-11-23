import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Mic, Music, Pause, Play, Plus, Square, Upload } from 'lucide-react';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { FavStar, favLibrary, useFavorites } from "../../../app/favorites.jsx";
import TextToSpeech from './TextToSpeech.jsx';
import PackMusic from './PackMusic.jsx';
import OnlineMediaBrowser from '../../library/components/OnlineMediaBrowser.jsx';
import { projectCredits } from '../../library/credits.js';
import { t, tn } from '../../../i18n/index.js';
import { followPreviewAudio } from '../audioTap.js';

function tagLabel(label) {
  const key = 'audio.tag_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const translated = t(key);
  return translated === key ? label : translated;
}

const previewId = item => JSON.stringify([item.sourceId || '', item.id]);
function usePreview() {
  const audio = useRef(null);
  const generation = useRef(0);
  const [state, setState] = useState({ id: null, loading: false, error: '' });
  useEffect(() => {
    const a = new Audio();
    const unsubscribe = followPreviewAudio(a);
    a.onended = () => setState((s) => ({ ...s, id: null }));
    audio.current = a;
    return () => { generation.current++; a.pause(); unsubscribe(); audio.current = null; };
  }, []);
  const toggle = async (item) => {
    const a = audio.current;
    if (!a) return;
    const id = previewId(item), request = ++generation.current;
    a.pause();
    if (state.id === id) return setState({ id: null, loading: false, error: '' });
    setState({ id, loading: true, error: '' });
    try {
      const res = item.path ? { path: item.path } : await window.api.mediaSourcePreview(item);
      if (request !== generation.current) return;
      if (res.error) throw Error(res.error);
      a.src = toFileUrl(res.path);
      await a.play();
      if (request === generation.current) setState({ id, loading: false, error: '' });
    } catch (e) {
      if (request === generation.current) setState({ id: null, loading: false, error: e.message });
    }
  };
  const stop = () => {
    generation.current++;
    audio.current?.pause();
    setState({ id: null, loading: false, error: '' });
  };
  return { ...state, toggle, stop };
}

function Row({ item, preview, onAdd, adding, fav = item.path ? null : favLibrary(item) }) {
  const playing = preview.id === previewId(item);
  return (
    <div className={`lib-row ${playing ? 'on' : ''}`} onDoubleClick={() => onAdd(item)}>
      <button className="lib-play" onClick={() => preview.toggle(item)} aria-label={playing ? t('audio.stop_item', { title: item.title }) : t('audio.play_item', { title: item.title })}>
        {playing && preview.loading ? <Loader2 size={15} className="spin" /> : playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <div className="lib-meta">
        <b title={item.title}>{item.title}</b>
        <span className="lib-sub">
          <span>{item.category || item.creator}{item.duration ? ` · ${formatTime(item.duration).slice(0, 5)}` : ''}</span>
          {item.license === 'unknown' && <i className="lic unknown">{t('audio.licence_unknown')}</i>}
          {item.license && item.license !== 'unknown' && (
            <i className={`lic ${item.license}`} title={item.license === 'by' ? t('audio.free_to_use_with_a_credit') : t('audio.free_to_use_no_credit_needed')}>
              {item.license === 'by' ? t('audio.credit_required') : t('audio.no_credit_required')}
            </i>
          )}
        </span>
      </div>
      {item.sourceLinks && <button className="icon-btn sm" aria-label={t('audio.view_source_for', { title: item.title })} title={t('audio.original_source_and_licence')} onDoubleClick={e => e.stopPropagation()} onClick={() => window.api.mediaSourceLink(item)}><ExternalLink size={13} /></button>}
      {fav && <FavStar entry={fav} />}
      <button className="lib-add" onClick={() => onAdd(item)} aria-label={t('audio.add_item_at_the_playhead', { title: item.title })} title={t('audio.add_at_the_playhead')} disabled={adding === item.id}>
        {adding === item.id ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
      </button>
    </div>
  );
}

// Audio panel: Music, Sound effects and Yours (imported audio and voice-over).
export default function AudioLibrary({ media, project, onImport, onAddMedia, onLibraryAdd, onAddFile, onTtsAdd, onTtsBegin, selectedText, onOpenSettings, settingsVersion, recorder, onStartRecord, MediaCard, onRemoveMedia, onPeek, peekId, onShowCredits, navigation, browserMemory, section = 'music:All' }) {
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
  useEffect(() => preview.stop(), [section, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {['music','sfx','trolls'].includes(view) && (sub.startsWith('pack:') ? (
        <PackMusic key={section} group={view === 'music' ? 'Music' : 'Sound FX'} collection={sub.slice(5)} onAddFile={onAddFile} navigation={navigation} browserMemory={browserMemory} />
      ) : <OnlineMediaBrowser key={view} kind={view} navigation={navigation} browserMemory={browserMemory}
        categoryLabel={tagLabel} settingsVersion={settingsVersion} onOpenSettings={onOpenSettings}>
        {results => <div className="lib-list">{results.map(item => <Row key={item.id} item={item} preview={preview} adding={adding} onAdd={add}/>)}</div>}
      </OnlineMediaBrowser>)}

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
