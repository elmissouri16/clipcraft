import PluginServiceAuthoring from './PluginServiceAuthoring.jsx';
import PluginAuthorPreview from './PluginAuthorPreview.jsx';
import React,{useEffect,useState} from 'react';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import ExtensionCommands from './ExtensionCommands.jsx';
import ExtensionLifecycle from './ExtensionLifecycle.jsx';
import {t} from '../../../i18n/index.js';
export default function PluginDevelopment({onAuthorExport,onBusy,visible=true}){
 const [state,setState]=useState({session:null,logs:[],dropped:0}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorBusy,setAuthorBusy]=useState(false),[nodeBusy,setNodeBusy]=useState(false);
 useEffect(()=>{let live=true;const update=value=>{if(live)setState(value);};window.api.pluginsDevelopment().then(update).catch(e=>{if(live)setError(e.message);});const off=window.api.onPluginDevelopmentChanged(update),offRuntime=window.api.onExtensionState?.(()=>window.api.pluginsDevelopment().then(update).catch(()=>{}));return()=>{live=false;off();offRuntime?.();};},[]);
 const workBusy=busy||authorBusy||nodeBusy;
 useEffect(()=>{onBusy?.(workBusy);return()=>onBusy?.(false);},[workBusy,onBusy]);
 const act=async fn=>{setBusy(true);setError('');try{setState(await fn());}catch(e){setError(e.message);}finally{setBusy(false);}};
 const session=state.session,active=session&&session.status!=='ended',row=session?.key?{key:session.key,development:true,enabled:session.status==='ready',manifest:session.manifest}:null;
 return <SettingsGroup label={t('plugins.dev_session')}>
  <section className="plugin-development" data-dev-status={session?.status||'idle'} data-dev-generation={session?.generation||0} data-dev-key={session?.key||''} aria-busy={busy}>
   <p className="set2-note">{t('plugins.dev_hint')}</p>
   <div className="settings-actions">
    <button type="button" className="btn" data-dev-start disabled={busy||active} onClick={()=>act(()=>window.api.pluginsStartDevelopment())}>{t('plugins.dev_start')}</button>
    <button type="button" className="btn" data-dev-reload disabled={busy||!active||session?.status==='loading'} onClick={()=>act(()=>window.api.pluginsReloadDevelopment())}>{t('plugins.dev_reload')}</button>
    <button type="button" className="btn btn-ghost" data-dev-end disabled={busy||!active} onClick={()=>act(()=>window.api.pluginsEndDevelopment())}>{t('plugins.dev_end')}</button>
   </div>
   {session&&<>
    <p><b>{session.manifest.name}</b> · {t('plugins.dev_generation',{generation:session.generation})} · {t('plugins.dev_status_'+session.status)}</p>
    <details className="plugin-disclosure"><summary>{t('plugins.dev_source_details')}</summary><p className="dim small plugin-dev-source">{session.source}</p></details>
    <label className="plugin-dev-watch"><input type="checkbox" data-dev-watch checked={!!session.watch} disabled={busy||!active} onChange={event=>act(()=>window.api.pluginsWatchDevelopment(event.target.checked))}/>{t('plugins.dev_watch')}</label>
    {session.manifest.main?<><p className="set2-note">{t('plugins.dev_node_hint')}</p>{session.diagnosticKey&&<ExtensionLifecycle key={session.diagnosticKey} row={{key:session.diagnosticKey,manifest:session.manifest}} disabled={busy||!active||session.status!=='ready'} onBusy={setNodeBusy}/>}</>:null}
    {session.manifest.main&&active&&<div className="plugin-debugger">
     <p className="set2-note">{t('plugins.dev_debug_hint')}</p>
     <div className="settings-actions"><button type="button" className="btn btn-sm" data-dev-debug disabled={busy||nodeBusy||session.status!=='ready'||!session.trusted||session.runtimeState!=='running'} onClick={()=>act(()=>window.api.pluginsDebugDevelopment(!session.debuggerUrl))}>{t(session.debuggerUrl?'plugins.dev_debug_stop':'plugins.dev_debug_start')}</button></div>
     {session.debuggerUrl&&<label className="field"><span>{t('plugins.dev_debug_address')}</span><input data-dev-debug-url readOnly value={session.debuggerUrl} onFocus={event=>event.target.select()}/></label>}
    </div>}
    {session.error&&<p className="error-text" role="alert">{session.error}</p>}
    {!session.manifest.main&&<><PluginAuthorPreview session={session} active={visible}/><PluginServiceAuthoring key={'services:'+(session.key||session.status)} session={session} onExport={onAuthorExport} onBusy={setAuthorBusy}/></>}
    {row?.manifest.main&&<ExtensionCommands key={row.key} row={row}/>}
   </>}
   {error&&<p className="error-text" role="alert">{error}</p>}
   <details className="plugin-disclosure" data-dev-log-details><summary>{t('plugins.dev_logs')} · {state.logs.length}</summary><div className="plugin-disclosure-body"><div className="settings-actions"><button type="button" className="btn btn-sm btn-ghost" data-dev-clear-logs disabled={busy||!state.logs.length} onClick={()=>act(()=>window.api.pluginsClearDevelopmentLogs())}>{t('plugins.dev_clear_logs')}</button></div>
   <div className="plugin-dev-log" role="log" aria-label={t('plugins.dev_logs')} tabIndex={0}>
    {!state.logs.length&&<p className="dim small">{t('plugins.dev_empty_logs')}</p>}
    {state.logs.map(log=><div key={log.id} className={'plugin-dev-record '+log.level}><span className="dim">{log.time.slice(11,19)} · {log.generation} · {log.source} · {log.level}</span><pre>{log.message}</pre></div>)}
   </div>
   {!!state.dropped&&<p className="dim small">{t('plugins.dev_dropped',{count:state.dropped})}</p>}
   </div></details>
  </section>
 </SettingsGroup>;
}
