import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,ChevronDown,SquareTerminal,CheckCircle2,AlertCircle} from 'lucide-react';
import ContextMenu from '../../../components/ui/ContextMenu.jsx';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import {useExtensionUi,extensionUiError,extensionUiMessage} from '../useExtensionUi.js';
import {t} from '../../../i18n/index.js';
import PluginIdentityIcon from './PluginIdentityIcon.jsx';
const pendingReads=new Set(),pendingWrites=new Set(),draftSavers=new Set();
export async function flushExtensionSettings(){
 const reads=await Promise.all([...pendingReads]);if(reads.some(value=>value===false))return false;
 const drafts=await Promise.all([...draftSavers].map(flush=>flush()));if(drafts.some(value=>value===false))return false;
 const saved=await Promise.all([...pendingWrites]);return !saved.some(value=>value===false);
}
export function ExtensionActions({location,extensionId,extensionKey,onChanged,beforeRun,onResult}){
 const {items,error}=useExtensionUi(location,extensionId,extensionKey),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[position,setPosition]=useState(null),more=useRef(null);
 const [packages,setPackages]=useState([]);
 const packageKeys=items.map(entry=>entry.key).join('|');
 useEffect(()=>{if(location!=='export')return;let live=true;window.api.pluginsList?.().then(rows=>{if(live)setPackages(rows);}).catch(()=>{});return()=>{live=false;};},[location,packageKeys]);
 const run=async entry=>{setBusy(entry.id);setMessage('');setFailed(false);setPosition(null);try{if(!await flushExtensionSettings())throw Error(t('plugins.extension_settings_failed'));await beforeRun?.(entry);const result=await window.api.pluginsExtensionUiExecute(entry.id);if(result?.error)throw Error(result.error);const message=extensionUiMessage(result,t('plugins.extension_completed'));setMessage(message);onResult?.({entry,message,failed:false});onChanged?.();}catch(e){setFailed(true);const message=extensionUiError(e);setMessage(message);onResult?.({entry,message,failed:true});}finally{setBusy('');}};
 const actions=items.filter(i=>i.kind==='action');if(!actions.length&&!error)return null;
 const toolbar=location==='toolbar',direct=toolbar?actions.slice(0,2):actions,Status=failed?AlertCircle:CheckCircle2;
 if(location==='export')return <section className="extension-export-options" data-extension-actions="export">
  <details>
   <summary><span>{t('plugins.export_with_plugin')}</span><span className="extension-export-count">{actions.length}</span><ChevronDown size={14}/></summary>
   <div className="extension-export-list">
    {actions.map(entry=>{
     const row=packages.find(row=>row.key===entry.key)||{key:entry.key,manifest:{id:entry.extensionId,name:entry.extensionName}};
     return <button key={entry.id} type="button" className="extension-export-option" data-extension-action={entry.id} disabled={!!busy} onClick={()=>run(entry)}>
      <PluginIdentityIcon row={row}/><span className="extension-export-copy"><strong>{entry.title}</strong><span>{entry.extensionName}</span></span><ArrowRight size={15} aria-hidden="true"/>
     </button>;
    })}
   </div>
  </details>
  {(message||error)&&<span role="status" className="extension-export-status" data-failed={failed||!!error}>{message||error}</span>}
 </section>;
 return <div className="extension-native-actions" data-extension-actions={location}>
  {direct.map(entry=><button key={entry.id} type="button" className={toolbar?'icon-btn':'btn btn-sm'} data-extension-action={entry.id} aria-label={entry.title} title={entry.title} disabled={!!busy} onClick={()=>run(entry)}>{toolbar?<SquareTerminal size={16}/>:entry.title}</button>)}
  {toolbar&&actions.length>2&&<button ref={more} type="button" className="icon-btn" data-extension-action-overflow aria-label={t('plugins.extension_more_actions')} title={t('plugins.extension_more_actions')} aria-haspopup="menu" aria-expanded={!!position} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setPosition(position?null:{x:rect.right-260,y:rect.bottom+6});}}><ChevronDown size={14}/></button>}
  {position&&createPortal(<ContextMenu {...position} label={t('plugins.extension_more_actions')} onClose={()=>{setPosition(null);requestAnimationFrame(()=>more.current?.focus());}} items={actions.slice(2).map(entry=>({id:'extension-action-menu-'+entry.id,label:entry.title,disabled:!!busy,onClick:()=>run(entry)}))}/>,document.body)}
  {(message||error)&&(toolbar?<span className="extension-native-result" role="status" title={message||error} aria-label={message||error} data-failed={failed||!!error}><Status size={15}/></span>:<span role="status" className="dim small">{message||error}</span>)}
 </div>;

}
function NativeSettings({entry,onChanged}){
 const [values,setValues]=useState({}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),drafts=useRef({}),dirty=useRef(new Set());
 useEffect(()=>{let live=true;setLoading(true);const operation=window.api.pluginsExtensionSettingsRead(entry.id).then(value=>{if(live)setValues(value);return true;}).catch(error=>{if(live)setError(extensionUiError(error));return false;}).finally(()=>{pendingReads.delete(operation);if(live)setLoading(false);});pendingReads.add(operation);return()=>{live=false;};},[entry.id,entry.generation]);
 const save=(f,value)=>{drafts.current[f.key]=value;dirty.current.delete(f.key);const operation=(async()=>{setBusy(f.key);setError('');try{await window.api.pluginsExtensionSettingsUpdate(entry.id,f.key,value);setValues(await window.api.pluginsExtensionSettingsRead(entry.id));onChanged?.();return true;}catch(e){dirty.current.add(f.key);setError(extensionUiError(e));return false;}finally{setBusy('');}})();pendingWrites.add(operation);operation.finally(()=>pendingWrites.delete(operation));return operation;};
 useEffect(()=>{
  const flush=async()=>{const unchanged=f=>['secret','number'].includes(f.type)&&String(drafts.current[f.key]??'').trim()==='';for(const f of entry.fields)if(dirty.current.has(f.key)&&unchanged(f))dirty.current.delete(f.key);const results=await Promise.all(entry.fields.filter(f=>dirty.current.has(f.key)).map(f=>save(f,f.type==='number'?Number(drafts.current[f.key]):drafts.current[f.key])));return results.every(Boolean);};
  draftSavers.add(flush);return()=>draftSavers.delete(flush);
 },[entry.id,entry.generation]); // eslint-disable-line react-hooks/exhaustive-deps
 return <SettingsGroup label={entry.title}><div className="extension-native-settings" data-extension-settings={entry.id} aria-busy={loading||!!busy}>{entry.fields.map(f=>f.type==='boolean'?<label key={f.key} className="set2-switch-row"><span className="set2-switch-text"><b>{f.label}</b>{f.description&&<small className="muted">{f.description}</small>}</span><input type="checkbox" className="switch" aria-label={f.label} checked={values[f.key]===true} disabled={loading||!!busy} onChange={e=>save(f,e.target.checked)}/></label>:<label key={f.key} className="field"><span>{f.label}</span>{f.type==='select'?<select aria-label={f.label} value={values[f.key]??f.default??''} disabled={loading||!!busy} onChange={e=>save(f,e.target.value)}>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input type={f.type==='secret'?'password':f.type==='number'?'number':'text'} aria-label={f.label} value={f.type==='secret'?(typeof values[f.key]==='string'?values[f.key]:''):values[f.key]??f.default??''} min={f.min} max={f.max} step={f.step} disabled={loading||!!busy} onChange={e=>{drafts.current[f.key]=e.target.value;dirty.current.add(f.key);setValues(v=>({...v,[f.key]:e.target.value}));}} onBlur={e=>{const raw=e.target.value;if(!dirty.current.has(f.key))return;if(['secret','number'].includes(f.type)&&!raw.trim()){dirty.current.delete(f.key);if(f.type==='number')window.api.pluginsExtensionSettingsRead(entry.id).then(setValues).catch(()=>{});return;}save(f,f.type==='number'?Number(raw):raw);}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>}{f.description&&<small className="muted">{f.description}</small>}{f.type==='secret'&&values[f.key]?.saved&&<span className="settings-actions"><small className="muted">{t('services.key_saved')}</small><button className="btn btn-sm btn-ghost" type="button" disabled={loading||!!busy} onClick={()=>save(f,'')}>{t('plugins.extension_clear_secret')}</button></span>}</label>)}{error&&<p role="alert" className="error-text">{error}</p>}</div></SettingsGroup>;
}
export function ExtensionSettings({location,extensionId,extensionKey,onChanged}){
 const {items,error}=useExtensionUi(location,extensionId,extensionKey);return <>{items.filter(i=>i.kind==='settings').map(entry=><NativeSettings key={entry.id+':'+entry.generation} entry={entry} onChanged={onChanged}/>)}{error&&<p role="alert" className="error-text">{error}</p>}<ExtensionActions location={location||'settings.plugins'} extensionId={extensionId} extensionKey={extensionKey} onChanged={onChanged}/></>;
}
