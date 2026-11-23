import {AudioLines,Blend,CaseSensitive,Eye,Grid3X3,Move,Palette,Star,Type,WandSparkles,X} from 'lucide-react';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {packBrowserItems,filterPackBrowser,PACK_CONTENT_KINDS} from '../../../../shared/pluginBrowser.mjs';
import PluginContentPreview from './PluginContentPreview.jsx';
import {t,tn} from '../../../i18n/index.js';

const contentIcons = {
  textStyles: Type, effects: WandSparkles, transitions: Blend, motionPresets: Move,
  luts: Grid3X3, colorPresets: Palette, fonts: CaseSensitive, sounds: AudioLines,
};

function PackResult({row, selected, favorite, busy, onPreview, onFavorite}) {
  const Icon = contentIcons[row.kind];
  const type = t('plugins.builder_summary_' + row.kind);
  const previewLabel = t('plugins.preview_of', {name: row.item.name});
  const favoriteLabel = t('plugins.browser_favorite_item', {name: row.item.name});
  return (
    <li className={'plugin-browser-item' + (selected ? ' on' : '')} data-pack-item={row.favoriteId}>
      <button type="button" className="pack-result-main" data-preview-item aria-pressed={selected}
        aria-label={[previewLabel, type, row.pluginName].join(', ')} onClick={() => onPreview(row)}>
        <span className="pack-result-icon"><Icon size={16} aria-hidden="true"/></span>
        <b className="pack-result-name">{row.item.name}</b>
        <span className="pack-result-type">{type}</span>
        <span className="pack-result-source">{row.pluginName}</span>
        <span className="pack-result-preview"><Eye size={14} aria-hidden="true"/><span>{t('plugins.browser_preview')}</span></span>
      </button>
      <button type="button" className="icon-btn" data-favorite-item title={favoriteLabel}
        aria-label={favoriteLabel} aria-pressed={favorite} disabled={busy} onClick={() => onFavorite(row)}>
        <Star size={15} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true"/>
      </button>
    </li>
  );
}

export default function PluginPackBrowser({rows,onApply,active=true}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState(''),[tag,setTag]=useState(''),[only,setOnly]=useState(false),[favorites,setFavorites]=useState([]),[preview,setPreview]=useState(null),[previewValid,setPreviewValid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[page,setPage]=useState(0);
 const sequence=useRef(0),params=useRef({});
 const listRef = useRef(null), previewTitle = useRef(null), searchRef = useRef(null);
 useLayoutEffect(() => {
   if (!preview) return;
   listRef.current?.querySelector('[data-preview-item][aria-pressed=true]')?.scrollIntoView({block: 'nearest', container: 'nearest'});
   previewTitle.current?.focus({preventScroll: true});
   previewTitle.current?.scrollIntoView({block: 'nearest'});
 }, [preview]);
 const closePreview = () => {
   const trigger = listRef.current?.querySelector('[data-preview-item][aria-pressed=true]') || searchRef.current;
   sequence.current++;
   setPreview(null);
   setBusy(false);
   requestAnimationFrame(() => {
     trigger?.focus({preventScroll: true});
     trigger?.scrollIntoView({block: 'nearest'});
   });
 };
 const items=useMemo(()=>packBrowserItems(rows),[rows]),tags=[...new Set(items.flatMap(i=>i.tags).filter(t=>!PACK_CONTENT_KINDS.includes(t)))].sort(),shown=filterPackBrowser(items,{query,kind,tag,favoritesOnly:only,favorites});
 useEffect(()=>{let live=true;window.api.pluginsBrowserFavorites().then(v=>live&&setFavorites(v)).catch(e=>live&&setError(e.message));return()=>{live=false;sequence.current++;};},[]);
 const catalogIdentity=JSON.stringify(items.map(item=>[item.favoriteId,item.key]).sort());
 useEffect(()=>{sequence.current++;setPreview(null);setBusy(false);},[catalogIdentity]);
 useEffect(()=>setPage(0),[query,kind,tag,only]);
 useEffect(()=>setPage(v=>Math.min(v,Math.max(0,Math.ceil(shown.length/24)-1))),[shown.length]);
 const select=async row=>{const token=++sequence.current;setBusy(true);setError('');setNotice('');setPreviewValid(false);params.current={};try{const value=await window.api.pluginsPreviewContent({key:row.key,kind:row.kind,id:row.item.id});if(sequence.current===token)setPreview(value);}catch(e){if(sequence.current===token){setPreview(null);setError(e.message);}}finally{if(sequence.current===token)setBusy(false);}};
 const toggleFavorite = async row => {
   setBusy(true);
   setError('');
   try {
     setFavorites(await window.api.pluginsSetBrowserFavorite(row.favoriteId, !favorites.includes(row.favoriteId)));
   } catch (e) {
     setError(e.message);
   } finally {
     setBusy(false);
   }
 };
 return <SettingsGroup label={t('plugins.browser_title')}><section className="plugin-section-body" data-pack-browser>
  {!!items.length&&<><div className="settings-grid plugin-browser-filters"><label className="field"><span className="sr-only">{t('plugins.browser_search')}</span><input ref={searchRef} type="search" placeholder={t('plugins.browser_search')} data-pack-search value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label><label className="field"><span className="sr-only">{t('plugins.browser_type')}</span><select data-pack-type value={kind} onChange={e=>setKind(e.target.value)}><option value="">{t('plugins.browser_all_types')}</option>{PACK_CONTENT_KINDS.map(k=><option key={k} value={k}>{t('plugins.builder_summary_'+k)}</option>)}</select></label><label className="field"><span className="sr-only">{t('plugins.browser_tag')}</span><select data-pack-tag value={tag} onChange={e=>setTag(e.target.value)}><option value="">{t('plugins.browser_all_tags')}</option>{tags.map(k=><option key={k} value={k}>{t('plugins.browser_tag_'+k)}</option>)}</select></label></div>
  <div className="plugin-browser-summary"><label className="field row"><input type="checkbox" data-pack-favorites checked={only} onChange={e=>setOnly(e.target.checked)}/><span>{t('plugins.browser_favorites')}</span></label><span role="status">{tn('plugins.browser_count',shown.length)}</span></div></>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status" data-pack-applied>{notice}</p>}
  {!shown.length&&<p className="set2-empty">{t(items.length?'plugins.browser_no_results':'plugins.browser_empty')}</p>}
  <div className={'plugin-browser-workspace'+(preview?' has-preview':'')} aria-busy={busy}><div className="plugin-browser-results">
    {shown.length > 0 && <>
      <div className="pack-result-head" aria-hidden="true">
        <span className="pack-result-name">{t('home.name')}</span>
        <span className="pack-result-type">{t('plugins.browser_type')}</span>
        <span className="pack-result-source">{t('plugins.browser_pack')}</span>
      </div>
      <ul ref={listRef} className="plugin-browser-items" aria-label={t('plugins.view_content')}>
        {shown.slice(page * 24, (page + 1) * 24).map(row =>
          <PackResult key={row.favoriteId} row={row} favorite={favorites.includes(row.favoriteId)} busy={busy}
            selected={preview?.key === row.key && preview.kind === row.kind && preview.item.id === row.item.id}
            onPreview={select} onFavorite={toggleFavorite}/>
        )}
      </ul>
    </>}
  {shown.length>24&&<div className="settings-actions"><button className="btn btn-sm" disabled={page===0} onClick={()=>setPage(v=>v-1)}>{t('plugins.browser_previous')}</button><span>{page+1} / {Math.ceil(shown.length/24)}</span><button className="btn btn-sm" disabled={(page+1)*24>=shown.length} onClick={()=>setPage(v=>v+1)}>{t('plugins.browser_next')}</button></div>}
  </div>{preview&&<div className="plugin-browser-inspector" data-pack-preview><div className="plugin-preview-heading"><div><h4 ref={previewTitle} tabIndex={-1}>{preview.item.name}</h4><span className="muted pack-preview-origin">{preview.pluginName} · {preview.version}</span></div><div className="settings-actions"><button type="button" className="btn btn-sm btn-primary" data-apply-pack-item disabled={busy||!onApply||!previewValid} onClick={async()=>{setBusy(true);setError('');try{await onApply({...preview,params:params.current});setNotice(t('plugins.browser_applied'));}catch(e){setError(e.message);}finally{setBusy(false);}}}>{t('plugins.browser_apply')}</button></div><button type="button" className="icon-btn" data-close-pack-preview aria-label={t('plugins.browser_close')} title={t('plugins.browser_close')} onClick={closePreview}><X size={14}/></button></div><PluginContentPreview active={active} key={`${preview.key}/${preview.kind}/${preview.item.id}`} content={preview} onValidityChange={setPreviewValid} onParametersChange={value=>{params.current=value;}}/>{preview.item.license&&<details><summary>{t('plugins.asset_license')}</summary><p className="plugin-license">{preview.item.license}</p></details>}

  </div>}</div>
 </section></SettingsGroup>;
}
