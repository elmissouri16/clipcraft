import React,{useEffect,useState} from 'react';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import PluginCommands from './PluginCommands.jsx';
import {t} from '../../../i18n/index.js';
export default function PluginDevelopment({commands}){
 const [state,setState]=useState({session:null,logs:[],dropped:0}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;const update=value=>{if(live)setState(value);};window.api.pluginsDevelopment().then(update).catch(e=>{if(live)setError(e.message);});const off=window.api.onPluginDevelopmentChanged(update);return()=>{live=false;off();};},[]);
 const act=async fn=>{setBusy(true);setError('');try{setState(await fn());}catch(e){setError(e.message);}finally{setBusy(false);}};
 const session=state.session,active=session&&session.status!=='ended',row=session?.key?{key:session.key,development:true,enabled:session.status==='ready',manifest:session.manifest}:null;
 return <SettingsGroup label={t('plugins.dev_session')}>
  <section className="plugin-development" data-dev-status={session?.status||'idle'} aria-busy={busy}>
   <p className="set2-note">{t('plugins.dev_hint')}</p>
   <div className="settings-actions">
    <button type="button" className="btn" data-dev-start disabled={busy||active} onClick={()=>act(()=>window.api.pluginsStartDevelopment())}>{t('plugins.dev_start')}</button>
    <button type="button" className="btn" data-dev-reload disabled={busy||!active||session?.status==='loading'} onClick={()=>act(()=>window.api.pluginsReloadDevelopment())}>{t('plugins.dev_reload')}</button>
    <button type="button" className="btn btn-ghost" data-dev-end disabled={busy||!active} onClick={()=>act(()=>window.api.pluginsEndDevelopment())}>{t('plugins.dev_end')}</button>
   </div>
   {session&&<>
    <p><b>{session.manifest.name}</b> · {t('plugins.dev_generation',{generation:session.generation})} · {t('plugins.dev_status_'+session.status)}</p>
    <p className="dim small plugin-dev-source">{session.source}</p>
    <label className="plugin-dev-watch"><input type="checkbox" data-dev-watch checked={!!session.watch} disabled={busy||!active} onChange={event=>act(()=>window.api.pluginsWatchDevelopment(event.target.checked))}/>{t('plugins.dev_watch')}</label>
    {active&&<p className="set2-note">{t('plugins.dev_panel_hint')}</p>}
    {session.error&&<p className="error-text" role="alert">{session.error}</p>}
    {row&&<PluginCommands key={row.key} row={row} controller={commands}/>}
   </>}
   {error&&<p className="error-text" role="alert">{error}</p>}
   <div className="settings-actions"><b>{t('plugins.dev_logs')}</b><button type="button" className="btn btn-sm btn-ghost" data-dev-clear-logs disabled={busy||!state.logs.length} onClick={()=>act(()=>window.api.pluginsClearDevelopmentLogs())}>{t('plugins.dev_clear_logs')}</button></div>
   <div className="plugin-dev-log" role="log" aria-label={t('plugins.dev_logs')} tabIndex={0}>
    {!state.logs.length&&<p className="dim small">{t('plugins.dev_empty_logs')}</p>}
    {state.logs.map(log=><div key={log.id} className={'plugin-dev-record '+log.level}><span className="dim">{log.time.slice(11,19)} · {log.generation} · {log.source} · {log.level}</span><pre>{log.message}</pre></div>)}
   </div>
   {!!state.dropped&&<p className="dim small">{t('plugins.dev_dropped',{count:state.dropped})}</p>}
  </section>
 </SettingsGroup>;
}
