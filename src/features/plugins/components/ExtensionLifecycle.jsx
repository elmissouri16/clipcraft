import React,{useEffect,useState} from 'react';
import {t} from '../../../i18n/index.js';
import {extensionUiError} from '../useExtensionUi.js';

export default function ExtensionLifecycle({row,disabled=false,act,onBusy}){
 const [diagnostic,setDiagnostic]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true,sequence=0;const refresh=async()=>{const request=++sequence;try{const value=await window.api.pluginsExtensionDiagnostics();if(live&&request===sequence)setDiagnostic(value.items.find(item=>item.key===row.key)||null);}catch(e){if(live)setError(extensionUiError(e));}};refresh();const off=window.api.onExtensionState(refresh);return()=>{live=false;off();};},[row.key]);
 useEffect(()=>{onBusy?.(busy);return()=>onBusy?.(false);},[busy,onBusy]);
 const perform=async fn=>{setBusy(true);setError('');try{await (act?act(fn):fn());}catch(e){setError(extensionUiError(e));}finally{setBusy(false);}};
 const state=diagnostic?.state||'inactive',running=['activating','running','stopping'].includes(state);
 return <section className="plugin-extension-lifecycle" data-extension-lifecycle={state} aria-busy={busy}>
  <p role="status">{t('plugins.extension_state_'+state)}</p>
  <div className="settings-actions">
   <button type="button" className="btn btn-sm" data-trust-extension hidden={running} disabled={disabled||busy||running} onClick={()=>perform(()=>window.api.pluginsExtensionTrust(row.key))}>{t('plugins.extension_activate')}</button>
   <button type="button" className="btn btn-sm btn-ghost" data-stop-extension hidden={!running} disabled={busy||!running} onClick={()=>perform(()=>window.api.pluginsExtensionStop(row.key))}>{t('plugins.extension_stop')}</button>
  </div>
  {!!diagnostic?.jobs?.length&&<div className="extension-job-list" aria-label={t('plugins.extension_jobs')}>
   {diagnostic.jobs.map(job=><div key={job.operation} className="extension-job" data-extension-job={job.operation}>
    <div className="extension-job-heading"><b>{job.title}</b><button type="button" className="btn btn-sm btn-ghost" data-extension-job-cancel disabled={job.canceling} onClick={()=>window.api.pluginsExtensionCancelJob(row.key,diagnostic.generation,job.operation).catch(e=>setError(extensionUiError(e)))}>{t(job.canceling?'plugins.extension_job_canceling':'plugins.cancel')}</button></div>
    <progress max="1" value={job.fraction||0} aria-label={job.title}/>
    <p className="dim small" role="status">{job.canceling?t('plugins.extension_job_canceling'):job.message||t('plugins.job_running')}</p>
   </div>)}
  </div>}
  {(error||diagnostic?.error)&&<p className="error-text" role="alert">{error||diagnostic.error}</p>}
  {diagnostic&&<details className="plugin-disclosure" data-extension-diagnostics><summary>{t('plugins.extension_diagnostics')}</summary><div className="plugin-disclosure-body">
   <p className="dim small">{row.manifest.id}</p>
   <code className="plugin-fingerprint">{diagnostic.generation}</code>
   {diagnostic.events&&<p className="dim small">{t('plugins.extension_event_queue',{queued:diagnostic.events.queued,missed:diagnostic.events.missed})}</p>}
   <div className="plugin-dev-log" role="log" aria-label={t('plugins.extension_diagnostics')} tabIndex={0}>{diagnostic.logs.map((log,index)=><div key={index} className={'plugin-dev-record '+log.level}><span className="dim">{log.level}</span><pre>{log.message}</pre></div>)}</div>
  </div></details>}
 </section>;
}
