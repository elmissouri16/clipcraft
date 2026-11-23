import React, {useEffect, useRef, useState} from 'react';
import {Loader2, WifiOff} from 'lucide-react';
import BrowserControls, {BrowserField, CREDIT_OPTIONS, creditSummary} from './BrowserControls.jsx';
import OpenverseNotice from './OpenverseNotice.jsx';
import {useBrowserState} from '../browserState.js';
import {t} from '../../../i18n/index.js';

function useMediaSources(settingsVersion) {
  const [catalog, setCatalog] = useState({sources:null, error:''});
  useEffect(() => {
    let generation = 0, timer;
    const refresh = () => {
      const current = ++generation;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const sources = await window.api.mediaSources();
          if (current === generation) setCatalog({sources, error:''});
        } catch (e) {
          if (current === generation) setCatalog({sources:[], error:e.message});
        }
      }, 20);
    };
    refresh();
    const off = window.api.onPluginsChanged(refresh);
    const offUi = window.api.onExtensionUiChanged(refresh);
    return () => { generation++; clearTimeout(timer); off(); offUi(); };
  }, [settingsVersion]);
  return catalog;
}

export default function OnlineMediaBrowser(props) {
  const {sources, error} = useMediaSources(props.settingsVersion);
  const [prefs, setPrefs] = useBrowserState(props.browserMemory, 'online:providers', {});
  const choices = sources?.filter(source => source.kinds.includes(props.kind)) || [];
  const source = choices.find(row => row.id === prefs[props.kind]) || choices[0];
  if (!source) return <>{props.navigation}<p className="empty-note">{error || t(sources ? 'stock.no_enabled_provider' : 'settings.loading')}</p></>;
  return <Search key={source.id + '/' + props.kind} {...props} source={source} choices={choices}
    choose={id => setPrefs({[props.kind]:id})}/>;
}

function Search({kind, source, choices, choose, navigation, browserMemory, categoryLabel, onOpenSettings, children}) {
  const audio = !['photo','video'].includes(kind);
  const [prefs, patch] = useBrowserState(browserMemory, 'online:' + source.id + ':' + kind,
    {q:'', term:'', categoryId:'', licenses:'cc0', orientation:''});
  const {q, term, categoryId, licenses, orientation} = prefs;
  const [result, setResult] = useState({results:[], loading:false});
  const seq = useRef(0);
  const load = async page => {
    const current = ++seq.current;
    setResult(old => ({...old, results:page === 1 ? [] : old.results, loading:true, error:''}));
    try {
      const value = await window.api.mediaSearch({provider:source.id, kind, q:term, categoryId, licenses, orientation, page});
      if (current !== seq.current) return;
      if (value.error) throw Error(value.error);
      setResult(old => ({...value, results:page === 1 ? value.results : [...old.results,...value.results], loading:false}));
    } catch (e) {
      if (current === seq.current) setResult({results:[], loading:false, error:e.message});
    }
  };
  useEffect(() => {
    if (source.configured) load(1);
    return () => { seq.current++; };
  }, [source.id, source.configured, kind, term, categoryId, licenses, orientation]);
  const categories = source.categories[kind] || [];
  const placeholder = t(({photo:'stock.search_stock_photos',video:'stock.search_stock_videos',music:'audio.search_online_music',sfx:'audio.search_sound_effects',trolls:'audio.search_meme_sounds'})[kind]);
  return <>
    <BrowserControls query={q} onQuery={q => patch({q,...(!q ? {term:''} : {})})}
      onSearch={() => q === term ? source.configured && load(1) : patch({term:q})} disabled={!source.configured}
      placeholder={placeholder} ariaLabel={t(audio ? 'audio.search_the_library' : 'stock.search_stock_media')} navigation={navigation}
      summary={[source.name, source.attribution && creditSummary(licenses), source.licenseSummary && t(source.licenseSummary), categoryId && categoryLabel(categoryId), orientation && t(orientation === 'vertical' ? 'stock.portrait' : 'stock.landscape')].filter(Boolean).join(' · ')}
      onReset={() => patch({licenses:'cc0', orientation:'', categoryId:''})}>
      {choices.length > 1 && <BrowserField label={t('settings.provider')} ariaLabel={t(audio ? 'library.audio_provider' : 'stock.photo_provider')}
        value={source.id} options={choices.map(row => ({value:row.id,label:row.name}))} onChange={choose}/>}
      {!!categories.length && <BrowserField label={t(kind === 'music' ? 'audio.genre' : 'audio.category')} ariaLabel={t(audio ? 'audio.audio_category' : 'audio.category')}
        value={categoryId} onChange={categoryId => patch({categoryId})} options={[{value:'',label:t('stock.all_categories')},...categories.map(id => ({value:id,label:categoryLabel(id)}))]}/>}
      {source.attribution && <BrowserField label={t('audio.copyright_attribution')} ariaLabel={t(audio ? 'audio.audio_licences' : 'stock.photo_licences')}
        value={licenses} onChange={licenses => patch({licenses})} options={CREDIT_OPTIONS}/>}
      {kind === 'photo' && source.orientation && <BrowserField label={t('stock.orientation')} value={orientation} onChange={orientation => patch({orientation})}
        options={[{value:'',label:t('stock.any_shape')},{value:'horizontal',label:t('stock.landscape')},{value:'vertical',label:t('stock.portrait')}]}/>}
      {source.attribution && <p className="browser-filter-help">{t('audio.cc_by_includes_cc0_results_and_media_that')}</p>}
    </BrowserControls>
    {!source.configured ? <div className="card stock-key">
      <p>{t('stock.configure_provider',{name:source.name})}</p>
      <button className="btn btn-sm btn-primary" onClick={() => onOpenSettings?.('plugins:' + source.key)}>{t('settings.add_api_key')}</button>
    </div> : <>
      {result.error && <div className="lib-error"><WifiOff size={15}/><span>{result.error}</span><button className="btn btn-sm" onClick={() => load(1)}>{t('audio.retry')}</button></div>}
      {children(result.results)}
      {result.loading && <div className="lib-loading"><Loader2 size={16} className="spin"/>{t('settings.loading')}</div>}
      {!result.loading && !result.error && !result.results.length && <div className="browser-empty">
        <p>{t('stock.no_matches_on_source_with_filters',{source:source.name})}</p>
        {source.attribution && licenses === 'cc0' && <button className="btn btn-sm" onClick={() => patch({licenses:'attribution'})}>{t('audio.include_credit_required_media')}</button>}
      </div>}
      {!result.loading && result.page < result.pages && !!result.results.length && <button className="btn btn-ghost btn-sm lib-more" onClick={() => load(result.page + 1)}>{t('audio.load_more')}</button>}
    </>}
    {source.notice === 'openverse' ? <OpenverseNotice/> : source.notice && <p className="lib-note">{t(source.notice)}</p>}
  </>;
}
