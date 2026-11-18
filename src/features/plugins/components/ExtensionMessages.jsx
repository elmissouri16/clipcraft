import {extensionUiError} from '../useExtensionUi.js';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Info,TriangleAlert,CircleAlert,X} from 'lucide-react';
import {t} from '../../../i18n/index.js';
export default function ExtensionMessages({hideJobs=false,onManage}){
 const [items,setItems]=useState([]),[busy,setBusy]=useState(new Set()),revision=useRef(-1),root=useRef(null),previousFocus=useRef(null);
 useEffect(()=>{
  let live=true;const accept=value=>{if(!live||value.revision<revision.current)return;revision.current=value.revision;const focused=document.activeElement,inside=root.current?.contains(focused);if(value.items.length&&!inside)previousFocus.current=focused;setItems(value.items);if(inside)requestAnimationFrame(()=>{if(live&&!focused.isConnected&&document.activeElement===document.body)(root.current?.querySelector('button:not(:disabled)')||previousFocus.current)?.focus();});};
  const off=window.api.onExtensionMessagesChanged(accept);window.api.pluginsExtensionMessages().then(accept).catch(()=>{});return()=>{live=false;off();};
 },[]);
 const [states,setStates]=useState([]),[jobBusy,setJobBusy]=useState(new Set()),[jobError,setJobError]=useState('');
 useEffect(()=>{let live=true;const accept=value=>{if(!live)return;const focused=document.activeElement,inside=root.current?.contains(focused);if(value.some(state=>state.jobs?.length)&&!inside)previousFocus.current=focused;setStates(value);if(inside)requestAnimationFrame(()=>{if(live&&!focused.isConnected&&document.activeElement===document.body)(root.current?.querySelector('button:not(:disabled)')||(previousFocus.current?.isConnected?previousFocus.current:null))?.focus();});};window.api.pluginsExtensionStatus?.().then(accept).catch(()=>{});const off=window.api.onExtensionState?.(accept);return()=>{live=false;off?.();};},[]);
 const jobs=hideJobs?[]:states.flatMap(state=>(state.jobs||[]).map(job=>({...job,key:state.key,generation:state.generation,extensionName:state.name||state.id})));
 const cancelJob=async job=>{const id=job.key+':'+job.operation;setJobBusy(value=>new Set(value).add(id));setJobError('');try{await window.api.pluginsExtensionCancelJob(job.key,job.generation,job.operation);}catch(error){setJobError(extensionUiError(error));}finally{setJobBusy(value=>{const next=new Set(value);next.delete(id);return next;});}};
 const respond=useCallback(async(id,action)=>{
  setBusy(previous=>new Set(previous).add(id));
  try{await window.api.pluginsExtensionMessageRespond(id,action);}finally{setBusy(previous=>{const next=new Set(previous);next.delete(id);return next;});}
 },[]);
 if(!items.length&&!jobs.length)return null;
 return <section className="extension-messages" ref={root} aria-label={t('plugins.extension_activity')} data-extension-messages>
  {items.slice(0,3).map(item=>{const Icon=item.kind==='error'?CircleAlert:item.kind==='warning'?TriangleAlert:Info;return <article key={item.id} className={'extension-message extension-message-'+item.kind} data-extension-message={item.id} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();respond(item.id).catch(()=>{});}}}>
   <Icon size={16} className="extension-message-icon" aria-hidden="true"/>
   <div className="extension-message-content"><span className="extension-message-source">{item.extensionName}</span><div role={item.kind==='info'?'status':'alert'}><p>{item.message}</p>{item.detail&&<p className="extension-message-detail">{item.detail}</p>}</div>
    {!!item.actions.length&&<div className="extension-message-actions">{item.actions.map(action=><button type="button" key={action.id} className="btn btn-sm" data-extension-message-action={action.id} disabled={busy.has(item.id)} onClick={()=>respond(item.id,action.id).catch(()=>{})}>{action.title}</button>)}</div>}
   </div><button type="button" className="icon-btn" data-extension-message-dismiss aria-label={t('plugins.extension_dismiss_message')} disabled={busy.has(item.id)} onClick={()=>respond(item.id).catch(()=>{})}><X size={14}/></button>
  </article>;})}
  {jobs.slice(0,3).map(job=><article key={job.key+':'+job.operation} className="extension-job extension-global-job" data-extension-global-job={job.operation}><span className="extension-message-source">{job.extensionName}</span><div className="extension-job-heading"><b>{job.title}</b><button type="button" className="btn btn-sm" data-extension-global-job-cancel disabled={job.canceling||jobBusy.has(job.key+':'+job.operation)} onClick={()=>cancelJob(job)}>{t(job.canceling?'plugins.extension_job_canceling':'app.cancel')}</button></div><progress value={job.fraction} max="1" aria-label={job.title}/>{job.message&&<p className="small dim" role="status">{job.message}</p>}</article>)}
  {jobError&&!!jobs.length&&<p role="alert" className="error-text small">{jobError}</p>}
  {jobs.length>3&&<button type="button" className="btn btn-sm" onClick={onManage}>{t('plugins.extension_jobs_more',{count:jobs.length-3})}</button>}
  {items.length>3&&<span className="extension-messages-more">{t('plugins.extension_messages_more',{count:items.length-3})}</span>}
 </section>;
}
