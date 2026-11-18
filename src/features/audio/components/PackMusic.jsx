import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, Plus } from 'lucide-react';
import BrowserControls from '../../library/components/BrowserControls.jsx';
import { useBrowserState } from '../../library/browserState.js';
import { formatTime, toFileUrl } from "../../../state/store.js";
import { assetAddWhere } from "../../library/assetsLib.js";
import { useAssets } from "../../library/useAssets.js";
import { t } from '../../../i18n/index.js';

// The asset pack's AUDIO, inside the Audio tab (Hamza's IA: pack audio goes with the
// music, NOT to Assets) — the Music place serves the pack's Music collections, and the
// Sound FX place its Sound FX collections (Hamza, 2026-11-01: sound effects belong in
// Music, with the music). One collection per manifest sub ("Library" songs and
// instrumentals, "آهات" vocal tracks; the SFX subs from the pack folders). Rows preview
// from disk and add at the playhead through App's addFile, like every other file add.
export default function PackMusic({ collection, onAddFile, group = 'Music', navigation, browserMemory }) {
  const lib = useAssets();
  const [{ q }, patch] = useBrowserState(browserMemory, `audio:pack:${group}:${collection}`, { q: '' });
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState('');
  const audio = useRef(null), previewGeneration=useRef(0), previewLease=useRef(null);
  const releasePreview=()=>{const token=previewLease.current;previewLease.current=null;if(token)window.api.pluginsReleaseSoundPreview(token).catch(()=>{});};
  useEffect(() => {
    const a = new Audio();
    a.onended = () => {releasePreview();setPlaying('');};
    a.onerror = () => {releasePreview();setPlaying('');setErr(t('plugins.preview_audio_failed'));};
    audio.current = a;
    return () => {previewGeneration.current++;a.pause();releasePreview();};
  }, []);
  const availablePaths=(lib?.items||[]).map(i=>i.path).join('\0');
  useEffect(() => { previewGeneration.current++;audio.current?.pause();releasePreview(); setPlaying(''); }, [collection, availablePaths]);

  const items = (lib?.items || []).filter((i) => i.group === group && i.sub === collection);
  const query = q.trim().toLowerCase();
  const shown = items.filter((i) => !query || i.name.toLowerCase().includes(query));

  const toggle = async (item) => {
    const a = audio.current;
    if (!a || item.missing) return;
    if (playing === item.path) { a.pause();releasePreview(); setPlaying(''); return; }
    a.pause();releasePreview();
    const generation=++previewGeneration.current;
    let source=item;
    try{if(item.localId)source=await window.api.pluginsPreviewSound(item.id);}catch(e){setErr(e.message);return;}
    if(generation!==previewGeneration.current){if(source.token)window.api.pluginsReleaseSoundPreview(source.token).catch(()=>{});return;}
    previewLease.current=source.token||null;
    a.src = toFileUrl(source.path);
    a.play().catch(() => {releasePreview();setPlaying('');});
    setPlaying(item.path);
  };
  const add = async (item) => {
    if (item.missing || adding) return;
    setAdding(item.path);
    setErr('');
    try{
      const source=item.localId?await window.api.pluginsSoundAsset(item.id):item;
      const r = await onAddFile?.(source.path, assetAddWhere(item), item.localId?source:undefined);
      if(r?.error)setErr(r.error);
    }catch(e){setErr(e.message);}finally{setAdding('');}
  };
  const isMusic = group === 'Music';

  return (
    <>
      <BrowserControls query={q} onQuery={q => patch({ q })} placeholder={t('pack.search_collection', { collection })} ariaLabel={t('pack.search_pack_collection', { collection })} navigation={navigation} summary={<>{lib?.hasLibrary ? t('pack.installed_library') : t('pack.audio_library')} · {collection}</>} />
      {err && <p className="error-text">{err}</p>}
      {!lib ? (
        <p className="empty-note"><Loader2 size={14} className="spin" /> {t('pack.reading_the_assets_folder')}</p>
      ) : lib.error ? <p className="error-text">{t('pack.could_not_read_the_audio_library_error', { error: lib.error })}</p> : !lib.hasLibrary || !items.length && !query ? (
        <>
          <p className="empty-note">{!lib.hasLibrary ? t('pack.audio_library_not_installed_yet') : t(isMusic ? 'pack.no_tracks_in_installed_library' : 'pack.no_sounds_in_installed_library', { collection })}</p>
          <p className="lib-note">{items.some(i=>i.localId)?t('plugins.pack_license_hint'):t('pack.from_your_assets_folder_free_to_use_no_cre')}</p>
        </>
      ) : (
        <>
          <div className="lib-list pack-list">
            {shown.map((item) => (
              <div key={item.path} className={`lib-row ${playing === item.path ? 'on' : ''} ${item.missing ? 'missing' : ''}`} onDoubleClick={() => add(item)}>
                <button className="lib-play" onClick={() => toggle(item)} disabled={item.missing}
                  aria-label={playing === item.path ? t('audio.stop_item', { title: item.name }) : t('audio.play_item', { title: item.name })}>
                  {playing === item.path ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                </button>
                <div className="lib-meta">
                  <b title={item.license||item.name}>{item.name}</b>
                  <span className="lib-sub"><span>{collection}{item.duration ? ` · ${formatTime(item.duration).slice(0, 5)}` : ''}</span>
                    {item.kind === 'video' && <i className="lic cc0">{t('pack.video')}</i>}
                    {item.missing && <i className="lic by">{t('pack.missing_file')}</i>}</span>
                </div>
                <button className="lib-add" onClick={() => add(item)} disabled={item.missing || adding === item.path}
                  aria-label={t('audio.add_item_at_the_playhead', { title: item.name })} title={t('audio.add_at_the_playhead')}>
                  {adding === item.path ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
                </button>
              </div>
            ))}
          </div>
          {!shown.length && <p className="empty-note">{items.length ? t('pack.nothing_matches_query', { collection, query: q.trim() }) : t(isMusic ? 'pack.no_tracks_in_assets_folder_yet' : 'pack.no_sounds_in_assets_folder_yet', { collection })}</p>}
          <p className="lib-note">{items.some(i=>i.localId)?t('plugins.pack_license_hint'):t('pack.from_your_assets_folder_free_to_use_no_cre')}</p>
        </>
      )}
    </>
  );
}
