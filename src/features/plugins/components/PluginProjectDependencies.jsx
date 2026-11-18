import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {collectPackDependencies,dependencyKey} from '../../../../shared/pluginDependencies.mjs';
import {allFonts,fontsReady,onFontsChanged,getFontRevision,fontStatus} from '../../text/fonts.js';
import {preferredPluginEffects,pluginEffectDefinition,subscribePluginEffects,pluginEffectsRevision} from '../effectRegistry.js';
import {preferredPluginTransitions,pluginTransitionDefinition} from '../transitionRegistry.js';
import {preferredPackLuts,useCreativePacks} from '../creativeRegistry.js';
import {t} from '../../../i18n/index.js';
export default function PluginProjectDependencies({project,onReplace}){
 useSyncExternalStore(onFontsChanged,getFontRevision,getFontRevision);
 useCreativePacks();useSyncExternalStore(subscribePluginEffects,pluginEffectsRevision,pluginEffectsRevision);
 const local=useMemo(()=>collectPackDependencies(project),[project]);
 const requests=local.references.map(({kind,digest,id,pluginId})=>({kind,digest,id,...(pluginId?{pluginId}:{})})),signature=JSON.stringify(requests);
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[reportError,setReportError]=useState(''),[busy,setBusy]=useState(false),[choices,setChoices]=useState({}),[notice,setNotice]=useState('');
 const sequence=useRef(0),owner=useRef(project);owner.current=project;
 const refresh=async()=>{const token=++sequence.current;try{const value=await window.api.pluginsDependencies(requests);if(token===sequence.current){setRows(value);setReportError('');}}catch(e){if(token===sequence.current)setReportError(e.message);}};
 useEffect(()=>{refresh();const off=window.api.onPluginsChanged?.(refresh);return()=>{sequence.current++;off?.();};},[signature]);
 const options=row=>{
  if(row.kind==='font')return allFonts().map(f=>({value:f.id,name:f.name,to:f,disabled:fontStatus(f.id)===false})).filter(v=>v.value!==`pack-font:${row.digest}:${row.id}`);
  if(row.kind==='lut')return preferredPackLuts().filter(l=>l.digest!==row.digest||l.id!==row.id).map(l=>({value:`pack-lut:${l.digest}:${l.id}`,name:`${l.name} — ${l.pluginName}`,to:l}));
  const items=row.kind==='effect'?preferredPluginEffects():preferredPluginTransitions(),definition=row.kind==='effect'?pluginEffectDefinition:pluginTransitionDefinition;
  return items.map(v=>({value:v.id,name:v.name,to:definition(v.id)})).filter(v=>v.to&&(v.to.digest!==row.digest||v.to.id!==row.id));
 };
 const perform=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(String(e.message||e).replace(/^Error invoking remote method 'plugins:[^']+': (?:Error: )?/,''));}finally{setBusy(false);}};
 const replace=(row,localRow)=>perform(async()=>{const choice=options(row).find(v=>v.value===choices[dependencyKey(row)]);if(!choice)throw Error(t('plugins.choose_replacement'));const captured=owner.current;
  if(row.kind==='font'){await fontsReady((project?.textClips||[]).filter(c=>c.font===`pack-font:${row.digest}:${row.id}`).map(c=>({...c,font:choice.to.id})),{strict:true});if(owner.current!==captured)throw Error(t('plugins.project_changed'));}
  const from={kind:row.kind,digest:row.digest,id:row.id,...(localRow.pluginId?{pluginId:localRow.pluginId}:{})};const changed=onReplace({from,to:choice.to});setNotice(t('plugins.dependencies_replaced',{count:changed}));
 });
 const attention=!!(reportError||local.invalid.length||rows.some(row=>local.references.find(item=>dependencyKey(item)===dependencyKey(row))?.required&&!['ready','retained'].includes(row.status)));
 if(!local.references.length&&!local.invalid.length&&!local.copied.length&&!local.ownedSounds&&!reportError)return <p data-project-dependencies className="set2-note">{t('plugins.no_project_dependencies')}</p>;
 return <SettingsGroup label={t('plugins.project_dependencies')}><section className="plugin-section-body" data-project-dependencies>
  <p className="set2-note">{t('plugins.project_pack_count',{count:local.references.length})}</p>
  {attention&&<p role="alert" className="error-text" data-project-pack-attention>{t('plugins.project_pack_attention')}</p>}
  <details className="plugin-disclosure" data-project-pack-details><summary>{t('plugins.project_pack_review')}</summary><div className="plugin-disclosure-body">
  <p className="set2-note">{t('plugins.project_dependencies_hint')}</p>
  {reportError&&<p role="alert" className="error-text">{reportError}</p>}{error&&<p role="alert" className="error-text">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!local.references.length&&!local.invalid.length&&<p>{t('plugins.no_project_dependencies')}</p>}
  {rows.map(row=>{const key=dependencyKey(row),item=local.references.find(v=>dependencyKey(v)===key);if(!item)return null;const replacements=options(row);return <div key={key} data-project-dependency={key} className="settings-group">
   <b>{row.name||item.name}</b><p>{row.pluginName||item.pluginId||row.digest.slice(0,12)} {row.version||item.version||''} · {t(`plugins.dependency_kind_${row.kind}`)} · {t(`plugins.dependency_${row.status}`)} · {t('plugins.dependency_uses',{count:item.uses.length})}{!item.required&&` · ${t('plugins.dependency_inactive')}`}</p>
   <details><summary>{t('plugins.fingerprint')}</summary><code className="plugin-fingerprint">{row.digest}</code></details>{row.error&&<p>{row.error}</p>}
   {['effect','transition'].includes(row.kind)&&!!replacements.length&&<p className="set2-note">{t('plugins.replacement_parameters_hint')}</p>}
   <div className="settings-actions">{!['ready','retained'].includes(row.status)&&<button className="btn btn-sm" disabled={busy} data-install-required={row.digest} onClick={()=>perform(()=>window.api.pluginsInstallDependency(row.digest))}>{t('plugins.reinstall_exact')}</button>}
    {row.status==='disabled'&&<button className="btn btn-sm" disabled={busy} onClick={()=>perform(()=>window.api.pluginsEnable(row.digest,true))}>{t('plugins.enable')}</button>}
    {!!replacements.length&&<><select aria-label={t('plugins.replacement_for',{name:row.name||item.name})} value={choices[key]||''} disabled={busy} onChange={e=>setChoices(v=>({...v,[key]:e.target.value}))}><option value="">{t('plugins.choose_replacement')}</option>{replacements.map(v=><option key={v.value} value={v.value} disabled={v.disabled}>{v.name}</option>)}</select><button className="btn btn-sm" data-replace-dependency={key} disabled={busy||!choices[key]||!onReplace} onClick={()=>replace(row,item)}>{t('plugins.replace_all_uses')}</button></>}
   </div>
  </div>;})}
  {!!local.invalid.length&&<p role="alert">{t('plugins.invalid_project_dependencies')}</p>}
  {!!local.copied.length&&<p>{t('plugins.copied_presets_hint',{count:local.copied.length})}</p>}
  {!!local.ownedSounds&&<p>{t('plugins.owned_sounds_hint',{count:local.ownedSounds})}</p>}
 </div></details></section></SettingsGroup>;
}
