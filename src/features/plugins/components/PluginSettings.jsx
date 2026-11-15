import PluginDevelopment from './PluginDevelopment.jsx';
import PluginCommands from './PluginCommands.jsx';
import React, {useEffect, useState} from 'react';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import {t} from '../../../i18n/index.js';
import {COMMAND_PERMISSION_LABELS} from '../../../../shared/pluginCommands.mjs';

export default function PluginSettings({commands}) {
  const [rows,setRows]=useState([]), [busy,setBusy]=useState(true), [error,setError]=useState(''), [selected,setSelected]=useState(null), [removing,setRemoving]=useState(null), [developer,setDeveloper]=useState(false),[clearing,setClearing]=useState(null),[storageNotice,setStorageNotice]=useState('');
  const run=async fn=>{setBusy(true);setError('');try{const result=await fn();if(result)setRows(result);}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{let live=true;const refresh=()=>window.api.pluginsList().then(value=>{if(live)setRows(value);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});refresh();window.api.pluginsDevelopment?.().then(value=>{if(live&&value.session&&value.session.status!=='ended')setDeveloper(true);}).catch(()=>{});const off=window.api.onPluginsChanged?.(refresh);return()=>{live=false;off?.();};},[]);
  const row=rows.find(x=>x.key===selected);
  return <div className="plugin-settings" aria-busy={busy}>
    <SettingsGroup label={t('plugins.installed')}>
      <div className="settings-actions">
        <button type="button" className="btn" disabled={busy} onClick={()=>run(()=>window.api.pluginsInstall())}>{t('plugins.install')}</button>
        <label><input type="checkbox" checked={developer} onChange={e=>setDeveloper(e.target.checked)} /> {t('plugins.developer')}</label>
        {developer && <button type="button" className="btn" disabled={busy} onClick={()=>run(()=>window.api.pluginsInstall(true))}>{t('plugins.load_folder')}</button>}
      </div>
      <p className="set2-note">{t('plugins.data_only')}</p>
      {busy && <p role="status">{t('plugins.working')}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!busy && !rows.length && <p>{t('plugins.empty')}</p>}
      <div className="plugin-list" role="group" aria-label={t('plugins.installed')}>
        {rows.map(item=><button key={item.key} type="button" className={`btn btn-ghost plugin-row ${selected===item.key?'on':''}`} aria-pressed={selected===item.key} onClick={()=>{setSelected(item.key);setRemoving(null);setClearing(null);setStorageNotice('');}}>
          <span>{item.manifest?.name || item.key.slice(0,12)} {item.manifest?.version}</span>
          <span className="muted">{item.error?t('plugins.unavailable'):item.enabled?t('plugins.enabled'):item.available?t('plugins.retained'):t('plugins.disabled')}</span>
        </button>)}
      </div>
    </SettingsGroup>
    {developer&&<PluginDevelopment commands={commands}/>}
    {row && <SettingsGroup label={row.manifest?.name || t('plugins.unavailable')}>
      {row.error ? <p role="alert">{row.error}</p> : <>
        <p>{row.manifest.description}</p>
        <p className="muted">{t('plugins.publisher',{publisher:row.manifest.publisher})}</p>
        <p>{row.manifest.id} · {row.manifest.version} · {'API'} {row.manifest.apiVersion}</p>
        <p>{t('plugins.minimum',{version:row.manifest.minClipcraftVersion})}</p>
        <p>{row.manifest.permissions.length?row.manifest.permissions.map(permission=>t(COMMAND_PERMISSION_LABELS[permission])).join(' · '):t('plugins.no_permissions')}</p>
        {!!row.manifest.contributes.aiProviders?.length&&<p className="set2-note">{t('plugins.provider_setup_hint')}</p>}
        <ul>{Object.entries(row.manifest.contributes).flatMap(([kind,items])=>items.map(p=><li key={`${kind}/${p.id}`}>{p.name}</li>))}</ul>
      </>}
      <PluginCommands key={row.key} row={row} controller={commands} />
      <details><summary>{t('plugins.fingerprint')}</summary><code className="plugin-fingerprint">{row.key}</code></details>
      <div className="settings-actions">
        {!row.error && <button type="button" className="btn" disabled={busy} onClick={()=>run(()=>window.api.pluginsEnable(row.key,!row.enabled))}>{t(row.enabled?'plugins.disable':'plugins.enable')}</button>}
        {(row.error||row.manifest?.contributes.panels?.some(p=>p.permissions.includes('storage.local')))&&<button type="button" className="btn" data-clear-panel-data disabled={busy} onClick={()=>{setClearing(row.key);setStorageNotice('');}}>{t('plugins.clear_panel_data')}</button>}
        <button type="button" className="btn" disabled={busy} onClick={()=>setRemoving(row.key)}>{t('plugins.remove')}</button>
      </div>
      {storageNotice&&<p role="status" data-panel-data-cleared>{storageNotice}</p>}
      {clearing===row.key&&<div role="group" aria-label={t('plugins.clear_panel_data')}><p>{t('plugins.clear_panel_data_hint')}</p><button type="button" className="btn" data-confirm-clear-panel-data disabled={busy} onClick={()=>run(async()=>{await window.api.pluginsClearPanelStorage(row.key);setClearing(null);setStorageNotice(t('plugins.panel_data_cleared'));return window.api.pluginsList();})}>{t('plugins.confirm_clear_panel_data')}</button> <button type="button" className="btn btn-ghost" onClick={()=>setClearing(null)}>{t('plugins.cancel')}</button></div>}
      {removing===row.key && <div role="group" aria-label={t('plugins.remove')}><p>{t('plugins.remove_hint')}</p><button type="button" className="btn" disabled={busy} onClick={()=>run(async()=>{const value=await window.api.pluginsRemove(row.key);setSelected(null);setRemoving(null);return value;})}>{t('plugins.confirm_remove')}</button> <button type="button" className="btn btn-ghost" onClick={()=>setRemoving(null)}>{t('plugins.cancel')}</button></div>}
    </SettingsGroup>}
  </div>;
}
