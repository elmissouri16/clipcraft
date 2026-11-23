import PluginIdentityIcon from './PluginIdentityIcon.jsx';
import {Search,PackagePlus,PackageOpen} from 'lucide-react';
import {ExtensionSettings} from './ExtensionNativeUi.jsx';
import ExtensionLifecycle from './ExtensionLifecycle.jsx';
import PluginStorageCleanup from './PluginStorageCleanup.jsx';
import PluginPackBrowser from './PluginPackBrowser.jsx';
import PluginPreferenceMigration from './PluginPreferenceMigration.jsx';
import PluginPackBuilder from './PluginPackBuilder.jsx';
import PluginProjectDependencies from './PluginProjectDependencies.jsx';
import PluginDevelopment from './PluginDevelopment.jsx';
import ExtensionCommands from './ExtensionCommands.jsx';
import PluginRecovery from './PluginRecovery.jsx';
import React, {useEffect, useRef, useState} from 'react';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import {t} from '../../../i18n/index.js';
const pluginError=error=>String(error.message||error).replace(/^Error invoking remote method 'plugins:[^']+': (?:Error: )?/,'');
const identity=manifest=>JSON.stringify([manifest.id,manifest.publisher]);
const hasIssue=row=>row.error||row.removing||row.recovered||row.manifest?.legacyExecutable&&!row.manifest.legacyExecutable.creative;

function installedPlugins(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.manifest ? identity(row.manifest) : row.key;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return Array.from(groups, ([id, versions]) => {
    // The enabled release wins even after an intentional downgrade.
    versions.sort((a,b) => Number(!!b.enabled) - Number(!!a.enabled)
      || Number(!!hasIssue(a)) - Number(!!hasIssue(b))
      || Number(!!a.manifest?.legacyExecutable) - Number(!!b.manifest?.legacyExecutable)
      || (b.manifest?.version || '').localeCompare(a.manifest?.version || '', 'en', {numeric:true}));
    return {id, versions, current:versions[0]};
  }).sort((a,b) => (a.current.manifest?.name || a.id).localeCompare(b.current.manifest?.name || b.id) || a.id.localeCompare(b.id));
}

export default function PluginSettings({initialKey=null,project,onReplaceDependency,onApplyPack,onAuthorExport}) {
  const [rows,setRows]=useState([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(initialKey),[removing,setRemoving]=useState(null),[developer,setDeveloper]=useState(false),[clearing,setClearing]=useState(null),[storageNotice,setStorageNotice]=useState(''),[creating,setCreating]=useState(false);
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[status,setStatus]=useState('all'),[view,setView]=useState('installed'),[development,setDevelopment]=useState(null),[developerBusy,setDeveloperBusy]=useState(false),details=useRef(null),inventory=useRef(null);
  const [inspected,setInspected]=useState(null);
  const run=async fn=>{setBusy(true);setError('');try{const result=await fn();if(result)setRows(result);}catch(e){setError(pluginError(e));}finally{setBusy(false);}};
  useEffect(()=>{
    let live=true;
    const refresh=()=>window.api.pluginsList().then(value=>{if(live)setRows(value);}).catch(e=>{if(live)setError(pluginError(e));}).finally(()=>{if(live)setBusy(false);});
    const session=value=>{if(!live)return;setDevelopment(value.session);if(value.session&&value.session.status!=='ended')setDeveloper(true);};
    refresh();window.api.pluginsDevelopment?.().then(session).catch(()=>{});
    const off=window.api.onPluginsChanged?.(refresh),offDev=window.api.onPluginDevelopmentChanged?.(session);
    return()=>{live=false;off?.();offDev?.();};
  },[]);
  useEffect(()=>{details.current?.scrollTo({top:0});},[selected]);
  useEffect(()=>{if(view==='installed')inventory.current?.querySelector('.plugin-row.on')?.scrollIntoView({block:'nearest'});},[selected,query,kind,status,view]);
  const remove=key=>run(async()=>{const value=await window.api.pluginsRemove(key);setInspected(null);setRemoving(null);return value;});
  const installedBusy=false;
  const sessionActive=development&&development.status!=='ended';
  const replacements=new Map();
  for(const row of rows)if(row.manifest?.main&&!row.error&&!row.removing&&!row.recovered){const id=identity(row.manifest);if(!replacements.has(id)||row.enabled)replacements.set(id,row);}
  const replacementFor=row=>row.manifest?.legacyExecutable&&replacements.get(identity(row.manifest));
  // Identity artwork may come from the enabled version of the same publisher's
  // package; older render dependencies keep their own exact bytes and digest.
  const artwork=new Map();
  for(const row of rows)if(row.manifest?.icon&&!row.error&&!row.removing&&!row.recovered){const id=identity(row.manifest);if(!artwork.has(id)||row.enabled)artwork.set(id,row);}
  const artworkFor=row=>row.manifest?.icon?row:row.manifest&&artwork.get(identity(row.manifest))||row;
  const isExtension=row=>!!row.manifest?.main||!!row.manifest?.legacyExecutable&&!row.manifest.legacyExecutable.creative;
  const groups=React.useMemo(()=>installedPlugins(rows),[rows]);
  const term=query.trim().toLocaleLowerCase();
  const visible=groups.filter(({current,versions})=>{
    const m=current.manifest;
    return [m?.name,m?.publisher,m?.id].join(' ').toLocaleLowerCase().includes(term)
      && (kind==='all'||(kind==='extension')===isExtension(current))
      && (status==='all'||status==='enabled'&&current.enabled||status==='disabled'&&!current.enabled||status==='issues'&&versions.some(hasIssue));
  });
  const selectedGroup=visible.find(group=>group.id===selected||group.versions.some(row=>row.key===selected))||visible[0];
  const selectedRow=selectedGroup && (selectedGroup.versions.find(row=>row.key===inspected)
    || (status==='issues' && selectedGroup.versions.find(hasIssue)) || selectedGroup.current);
  useEffect(()=>{if(!busy && selected!== (selectedGroup?.id||null)){setSelected(selectedGroup?.id||null);setInspected(null);}},[busy,selectedGroup?.id,selected]);
  const rowStatus=item=>item.removing?t('plugins.removal_pending'):item.error?t('plugins.unavailable'):item.recovered?t('plugins.recovered_disabled'):item.manifest?.legacyExecutable?t(replacementFor(item)?'plugins.legacy_replacement_installed':'plugins.legacy_migration_required'):item.enabled?t('plugins.enabled'):item.available?t('plugins.retained'):t('plugins.disabled');
  const select=(key,inspect=false)=>{const row=rows.find(item=>item.key===key);setSelected(row?.manifest?identity(row.manifest):key);setInspected(inspect?key:null);setRemoving(null);setClearing(null);setStorageNotice('');};
  const renderDetails=row=><div ref={details} data-plugin-details className="plugin-package-details" role="region" aria-label={row.manifest?.name||t('plugins.package_details')}>
    <header className="plugin-detail-heading"><PluginIdentityIcon row={row} artwork={artworkFor(row)} large/><div className="plugin-detail-identity"><h4>{row.manifest?.name||row.key.slice(0,12)}</h4>{row.manifest&&<><p>{t('plugins.publisher',{publisher:row.manifest.publisher})}</p><span className="plugin-detail-meta">{t(isExtension(row)?'plugins.kind_extension':'plugins.kind_pack')}<span>·</span>{row.manifest.version}<span>·</span>{rowStatus(row)}</span></>}</div></header>
    {row.recovered&&!row.removing&&<p className="set2-note">{t('plugins.recovered_hint')}</p>}
    {row.removing?<p role="status" data-removal-pending>{t('plugins.removal_pending_hint')}</p>:row.error?<p role="alert" className="error-text">{row.error}</p>:<>
      <div className="plugin-package-overview"><p>{row.manifest.description}</p><button type="button" className="btn btn-sm" data-enable-plugin disabled={busy||!!row.manifest.legacyExecutable&&!row.manifest.legacyExecutable.creative} onClick={()=>run(()=>window.api.pluginsEnable(row.key,!row.enabled))}>{t(row.enabled?'plugins.disable':'plugins.enable')}</button></div>
      <div className="plugin-activation" hidden={!row.manifest.main}><h5 className="set2-group-label">{t('plugins.activation')}</h5>{row.manifest.main&&<ExtensionLifecycle key={row.key} row={row} disabled={busy||!row.enabled} act={fn=>run(async()=>{await fn();return window.api.pluginsList();})}/>}</div>
      {row.manifest.legacyExecutable?<div data-legacy-migration><p className="set2-note" role="status">{t(replacementFor(row)?'plugins.legacy_replacement_hint':'plugins.legacy_migration_hint')}</p>{replacementFor(row)&&<button type="button" className="btn btn-sm" data-open-plugin-replacement onClick={()=>select(replacementFor(row).key,true)}>{t('plugins.open_replacement')}</button>}</div>:null}
      {row.manifest.main&&row.enabled&&<div className="plugin-selected-settings" data-plugin-configuration><ExtensionSettings extensionId={row.manifest.id} extensionKey={row.key}/></div>}
      {row.manifest.main&&!!row.manifest.contributes.commands.length&&<details className="plugin-disclosure" data-plugin-tools><summary>{t('plugins.commands')} <span className="muted">{row.manifest.contributes.commands.length}</span></summary><div className="plugin-disclosure-body"><ExtensionCommands key={row.key} row={row}/></div></details>}
    </>}
    <details className="plugin-disclosure" data-plugin-advanced>
      <summary>{t('plugins.package_details')}</summary>
      <div className="plugin-disclosure-body">
        {selectedGroup.versions.length>1&&<label className="field">{t('plugins.installed_versions')}
          <select data-plugin-version value={row.key} onChange={e=>select(e.target.value,true)}>
            {selectedGroup.versions.map(version=><option key={version.key} value={version.key}>{version.manifest.version} · {rowStatus(version)}</option>)}
          </select></label>}
        {row.manifest&&!row.manifest.legacyExecutable&&<p className="set2-note plugin-permissions">{t(row.manifest.main?'plugins.extension_access':'plugins.no_permissions')}</p>}
        {row.manifest&&<><p className="set2-note">{row.manifest.id} · {t('plugins.api_version',{version:row.manifest.apiVersion})}</p><p className="set2-note">{t('plugins.minimum',{version:row.manifest.minClipcraftVersion})}</p>
          <details><summary>{t('plugins.package_contents')}</summary><ul>{Object.entries(row.manifest.contributes).flatMap(([kind,items])=>items.map(p=><li key={`${kind}/${p.id}`}>{p.name}{p.license&&<details><summary>{t('plugins.asset_license')}</summary><p className="plugin-license">{p.license}</p></details>}</li>))}</ul></details></>}
        <details><summary>{t('plugins.fingerprint')}</summary><code className="plugin-fingerprint">{row.key}</code></details>
        {!row.error&&!row.removing&&<PluginPreferenceMigration key={'preferences:'+row.key} row={row} rows={rows}/>}
        <div className="settings-actions">
          {!row.removing&&(row.error||!!row.manifest?.legacyPreferences?.panels?.length)&&<button type="button" className="btn btn-sm" data-clear-panel-data disabled={busy} onClick={()=>{setClearing(row.key);setStorageNotice('');}}>{t('plugins.clear_panel_data')}</button>}
          <button type="button" className="btn btn-sm btn-ghost" data-remove-plugin disabled={busy} onClick={()=>row.removing?remove(row.key):setRemoving(row.key)}>{t(row.removing?'plugins.retry_remove':'plugins.remove')}</button>
        </div>
      </div>
    </details>
    {storageNotice&&<p role="status" data-panel-data-cleared>{storageNotice}</p>}
    {!row.removing&&clearing===row.key&&<div className="plugin-confirmation" role="group" aria-label={t('plugins.clear_panel_data')}><p>{t('plugins.clear_panel_data_hint')}</p><div className="settings-actions"><button type="button" className="btn" data-confirm-clear-panel-data disabled={busy} onClick={()=>run(async()=>{await window.api.pluginsClearPanelStorage(row.key);setClearing(null);setStorageNotice(t('plugins.panel_data_cleared'));return window.api.pluginsList();})}>{t('plugins.confirm_clear_panel_data')}</button><button type="button" className="btn btn-ghost" onClick={()=>setClearing(null)}>{t('plugins.cancel')}</button></div></div>}
    {!row.removing&&removing===row.key&&<div className="plugin-confirmation" role="group" aria-label={t('plugins.remove')}><p>{t('plugins.remove_hint')}</p><div className="settings-actions"><button type="button" className="btn btn-danger" data-confirm-remove-plugin disabled={busy} onClick={()=>remove(row.key)}>{t('plugins.confirm_remove')}</button><button type="button" className="btn btn-ghost" onClick={()=>setRemoving(null)}>{t('plugins.cancel')}</button></div></div>}
  </div>;
  return <div className="plugin-settings" aria-busy={busy}>
    <div className="seg-tabs small plugin-settings-nav" role="group" aria-label={t('plugins.settings_views')}>
      {['installed','content','create'].map(id=><button type="button" key={id} className={view===id?'on':''} aria-pressed={view===id} data-plugin-view={id} onClick={()=>setView(id)}>{t('plugins.view_'+id)}{(id==='installed'&&installedBusy||id==='create'&&developerBusy)&&<span className="plugin-activity" aria-label={t('plugins.job_running')}/>}{id==='create'&&sessionActive&&!developerBusy&&<span className="plugin-session-indicator" title={t('plugins.session_active')}/>}</button>)}
    </div>
    {/* Keep task workspaces mounted: switching views must not invoke job cleanup. */}
    <div className="plugin-settings-view" data-plugin-view-panel="installed" hidden={view!=='installed'}>
      <div className="plugin-inventory-toolbar"><label className="plugin-search"><Search size={14}/><input type="search" data-plugin-search aria-label={t('plugins.search_installed')} placeholder={t('plugins.search_installed')} value={query} onChange={e=>setQuery(e.target.value)}/></label><button type="button" className="btn btn-sm btn-primary" data-install-plugin disabled={busy} onClick={()=>run(async()=>{const value=await window.api.pluginsInstall();const added=value?.find(item=>!rows.some(row=>row.key===item.key));if(added)select(added.key);return value;})}><PackagePlus size={14}/>{t('plugins.install')}</button></div>
      <div className="plugin-inventory-filters"><span className="plugin-inventory-count">{t('plugins.installed_count',{count:groups.length})}</span><select data-plugin-kind aria-label={t('plugins.filter_kind')} value={kind} onChange={e=>setKind(e.target.value)}>{['all','extension','pack'].map(value=><option key={value} value={value}>{t('plugins.filter_'+value)}</option>)}</select><select data-plugin-status aria-label={t('plugins.filter_status')} value={status} onChange={e=>{setInspected(null);setStatus(e.target.value);}}>{['all','enabled','disabled','issues'].map(value=><option key={value} value={value}>{t('plugins.status_'+value)}</option>)}</select></div>
      {busy&&<p className="set2-note" role="status">{t('plugins.working')}</p>}
      {error&&<p className="error-text" role="alert">{error}</p>}
      <div className="plugin-manager" data-plugin-manager>
        <div ref={inventory} className="plugin-list" role="group" aria-label={t('plugins.installed')}>
          {visible.map(({id,current:item})=><div className="plugin-entry" key={id}>
            <button type="button" className={`btn btn-ghost plugin-row ${selectedGroup.id===id?'on':''}`} aria-pressed={selectedGroup.id===id} title={item.manifest?.name} onClick={()=>select(item.key)}>
              <PluginIdentityIcon row={item} artwork={artworkFor(item)}/><span className="plugin-row-description"><b>{item.manifest?.name||item.key.slice(0,12)}</b><span className="plugin-row-meta"><small>{item.manifest?.publisher||t('plugins.unavailable')}</small><span className="plugin-row-status" data-state={item.error||item.removing?'issue':item.enabled?'enabled':'disabled'}>{rowStatus(item)}</span></span></span>
            </button>
          </div>)}
          {!busy&&!error&&!visible.length&&<div className="plugin-list-empty"><PackageOpen size={24}/><p>{t(rows.length?'plugins.search_empty':'plugins.empty')}</p>{!!rows.length&&<button type="button" className="btn btn-sm btn-ghost" onClick={()=>{setQuery('');setKind('all');setStatus('all');}}>{t('plugins.clear_filters')}</button>}</div>}
        </div>
        {selectedRow?renderDetails(selectedRow):<div className="plugin-detail-empty"><PackageOpen size={32}/><h4>{t(error?'plugins.unavailable':rows.length?'plugins.select_plugin':'plugins.empty')}</h4><p>{t(error?'plugins.recovery_hint':rows.length?'plugins.select_plugin_hint':'plugins.empty_hint')}</p></div>}
      </div>
      {project&&<PluginProjectDependencies project={project} onReplace={onReplaceDependency}/>}
      <details className="plugin-disclosure plugin-maintenance" data-plugin-maintenance><summary>{t('plugins.maintenance')}</summary><div className="plugin-disclosure-body">
        <PluginStorageCleanup/>
        <SettingsGroup label={t('plugins.recovery_title')} hint={t('plugins.recovery_hint')}><PluginRecovery busy={busy} setBusy={setBusy} onRecovered={value=>{setRows(value);setError('');setSelected(null);setRemoving(null);setClearing(null);}}/></SettingsGroup>
        <details><summary>{t('plugins.about_permissions')}</summary><p className="set2-note">{t('plugins.data_only')}</p></details>
      </div></details>
    </div>
    <div className="plugin-settings-view" data-plugin-view-panel="content" hidden={view!=='content'}><PluginPackBrowser active={view==='content'} rows={rows} onApply={onApplyPack}/></div>
    <div className="plugin-settings-view" data-plugin-view-panel="create" hidden={view!=='create'}>
      <SettingsGroup label={t('plugins.builder_title')} hint={t('plugins.create_hint')} aside={<button type="button" className="btn btn-sm btn-primary" data-open-pack-builder disabled={creating} onClick={()=>setCreating(true)}>{t('plugins.create_pack')}</button>}/>
      <SettingsGroup label={t('plugins.developer')} hint={t('plugins.developer_hint')}>
        <label className="plugin-dev-watch"><input type="checkbox" data-plugin-developer checked={developer} disabled={!!sessionActive||developerBusy} onChange={e=>setDeveloper(e.target.checked)}/>{t('plugins.enable_developer_tools')}</label>
        {developer&&<button type="button" className="btn btn-sm" data-install-plugin-folder disabled={busy} onClick={()=>run(()=>window.api.pluginsInstall(true))}>{t('plugins.install_compiled_folder')}</button>}
      </SettingsGroup>
      {developer&&<PluginDevelopment visible={view==='create'} onAuthorExport={onAuthorExport} onBusy={setDeveloperBusy}/>}
    </div>
    {creating&&<PluginPackBuilder project={project} onClose={()=>{setCreating(false);requestAnimationFrame(()=>document.querySelector('[data-open-pack-builder]')?.focus());}}/>}
  </div>;
}
