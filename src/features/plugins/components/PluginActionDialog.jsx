import React,{useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import NumBox from '../../../components/ui/NumBox.jsx';
import Dropdown from '../../../components/ui/Dropdown.jsx';
import {t} from '../../../i18n/index.js';
export default function PluginActionDialog({request,onSubmit,onClose}){
 const root=useRef(null),entry=request.entry,status=request.status,phase=status.phase,busy=['permission','running','review','applying'].includes(phase);
 const [input,setInput]=useState(()=>Object.fromEntries(entry.command.parameters.map(p=>[p.id,p.default])));
 const containFocus=useRef(()=>{});
 useLayoutEffect(()=>{
  const el=root.current,timers=new Set();
  const contain=()=>{const timer=setTimeout(()=>{timers.delete(timer);const dialogs=[...document.querySelectorAll('[aria-modal="true"]')].filter(d=>d.getClientRects().length);if(!el.isConnected||dialogs.at(-1)!==el||el.contains(document.activeElement))return;(el.querySelector('[data-plugin-action-primary]:not(:disabled)')||el.querySelector('button:not(:disabled)')||el).focus({preventScroll:true});},0);timers.add(timer);};
  containFocus.current=contain;el.addEventListener('focusout',contain,true);document.addEventListener('focusin',contain,true);
  (el.querySelector('.plugin-command-fields input:not(:disabled),[data-plugin-action-primary]:not(:disabled)')||el).focus();contain();
  return()=>{containFocus.current=()=>{};for(const timer of timers)clearTimeout(timer);el.removeEventListener('focusout',contain,true);document.removeEventListener('focusin',contain,true);requestAnimationFrame(()=>{if(document.querySelector('[data-plugin-action-dialog]'))return;const target=request.restore?.isConnected?request.restore:document.querySelector('.plugin-actions-toggle');target?.focus({preventScroll:true});});};
 },[]);
 useLayoutEffect(()=>containFocus.current(),[phase]);
 const keys=event=>{
  if(event.defaultPrevented)return;
  if(event.key==='Escape'){
   if(root.current.querySelector('.dropdown [aria-expanded="true"]'))return;
   event.preventDefault();event.stopPropagation();if(phase!=='applying')onClose();
  }
  if(event.key==='Tab'){
   const buttons=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
   if(!buttons.length){event.preventDefault();return;}
   const index=buttons.indexOf(document.activeElement);
   if(event.shiftKey&&index<=0){event.preventDefault();buttons.at(-1).focus();}
   else if(!event.shiftKey&&(index===buttons.length-1||index<0)){event.preventDefault();buttons[0].focus();}
  }
 };
 return <div ref={root} className="modal-backdrop plugin-action-backdrop" role="dialog" aria-modal="true" aria-labelledby="plugin-action-title" data-plugin-action-dialog data-phase={phase} tabIndex={-1} onKeyDown={keys} onMouseDown={event=>{if(event.target===event.currentTarget&&phase!=='applying')onClose();}}>
  <section className="modal plugin-action-dialog">
   <div className="panel-head"><h3 id="plugin-action-title">{entry.label}</h3><button className="icon-btn" type="button" disabled={phase==='applying'} aria-label={t('plugins.action_close')} onClick={onClose}><X size={16}/></button></div>
   <div className="plugin-action-body">
    <p className="small dim">{entry.pluginName} · {entry.version}{entry.development?' · '+t('plugins.dev_badge'):''}</p>
    <p className="small dim">{t('plugins.publisher',{publisher:entry.publisher})}</p>
    {entry.command.description&&<p>{entry.command.description}</p>}
    {entry.command.parameters.length>0&&<fieldset className="plugin-command-fields" disabled={phase!=='configure'}>
     {entry.command.parameters.map(p=>p.type==='enum'?<label className="plugin-enum-field" key={p.id}><span>{p.name}</span><Dropdown ariaLabel={p.name} value={input[p.id]} options={p.options} disabled={phase!=='configure'} onChange={value=>setInput(values=>({...values,[p.id]:value}))}/></label>:<NumBox key={p.id} layout="field" label={p.name} value={input[p.id]} min={p.min} max={p.max} step={p.step} onChange={value=>setInput(values=>({...values,[p.id]:value}))}/>) }
    </fieldset>}
    {phase!=='configure'&&<div className="plugin-command-status" role={phase==='failed'?'alert':'status'} data-plugin-action-phase={phase}>
     <p>{status.message||t(phase==='permission'?'plugins.command_permission_pending':'plugins.command_running')}</p>
     {busy&&<progress max="1" value={status.progress||0} aria-label={t('plugins.command_progress')}/>}
     {status.pluginMessage&&<p className="dim small">{t('plugins.command_response',{message:status.pluginMessage})}</p>}
     {status.artifact&&<div className="plugin-export-artifact"><p>{status.artifact.width}×{status.artifact.height} · {status.artifact.duration_sec.toFixed(2)} s</p><button className="btn btn-sm" onClick={()=>window.api.openFile(status.artifact.path)}>{t('export.open_file')}</button><button className="btn btn-sm" onClick={()=>window.api.showInFolder(status.artifact.path)}>{t('activity.show_in_folder')}</button></div>}
    </div>}
   </div>
   <footer className="dialog-actions"><button className="btn btn-ghost" type="button" data-plugin-action-primary={phase!=='configure'||undefined} disabled={phase==='applying'} onClick={onClose}>{t(busy?'plugins.cancel':phase==='configure'?'app.cancel':'plugins.action_close')}</button>{phase==='configure'&&<button data-plugin-action-primary type="button" className="btn btn-primary" onClick={()=>onSubmit(input)}>{t('plugins.run_command')}</button>}</footer>
  </section>
 </div>;
}
