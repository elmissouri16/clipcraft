import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,ChevronDown,CheckCircle2,AlertCircle,PanelsTopLeft,Puzzle,Settings,X} from 'lucide-react';
import ContextMenu from '../../../components/ui/ContextMenu.jsx';
import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import {useExtensionUi,extensionUiError,extensionUiMessage} from '../useExtensionUi.js';
import {t} from '../../../i18n/index.js';
import ExtensionActionIcon from './ExtensionActionIcon.jsx';
import PluginIdentityIcon from './PluginIdentityIcon.jsx';
const pendingReads=new Set(),pendingWrites=new Set(),draftSavers=new Set();
export async function flushExtensionSettings(){
 const reads=await Promise.all([...pendingReads]);if(reads.some(value=>value===false))return false;
 const drafts=await Promise.all([...draftSavers].map(flush=>flush()));if(drafts.some(value=>value===false))return false;
 const saved=await Promise.all([...pendingWrites]);return !saved.some(value=>value===false);
}

function ToolbarPlugins({actions,busy,run,result,error,onManagePlugins,onPluginPanels}){
 const [menu,setMenu]=useState(null);
 const [open,setOpen]=useState(false);
 const trigger=useRef(null),notice=useRef(null);
 const message=error||result?.message,failed=!!error||!!result?.failed;
 const title=error?t('plugins.actions_menu'):result?.entry.title;
 const details=t('plugins.action_details');
 const Icon=failed?AlertCircle:CheckCircle2;
 useLayoutEffect(()=>{setOpen(failed);},[result,error,failed]);
 useEffect(()=>{
  if(!open)return;
  const outside=event=>{if(!notice.current?.contains(event.target)&&!trigger.current?.contains(event.target))setOpen(false);};
  const escape=event=>{
   if(event.key!=='Escape')return;
   event.preventDefault();event.stopPropagation();
   if(notice.current?.contains(document.activeElement))trigger.current?.focus();
   setOpen(false);
  };
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',escape,true);
  return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
 },[open]);
 const menuItems=[
  {label:t('plugins.actions_manage'),icon:Settings,onClick:onManagePlugins},
  {label:t('plugins.panels'),icon:PanelsTopLeft,onClick:onPluginPanels},
 ];
 if(message)menuItems.push({id:'plugin-action-details',label:details,detail:title,icon:Icon,onClick:()=>setOpen(true)});
 if(actions.length)menuItems.push('sep',...actions.map(entry=>({
  id:'extension-action-menu-'+entry.id,label:entry.title,detail:entry.extensionName,
  icon:entry.icon?props=><ExtensionActionIcon entry={entry} {...props}/>:undefined,
  disabled:!!busy||entry.enabled===false,hint:entry.disabledReason,onClick:()=>run(entry),
 })));
 const closeMenu=reason=>{
  setMenu(null);
  if(reason==='escape'||reason==='choose')trigger.current?.focus();
 };
 return <div className="extension-toolbar" data-extension-actions="toolbar">
  <button ref={trigger} type="button" className="btn btn-sm plugin-actions-toggle" data-extension-action-overflow
    aria-haspopup="menu" aria-expanded={!!menu} aria-description={failed?title+' · '+message:undefined} data-failed={failed}
    onClick={event=>{
     const rect=event.currentTarget.getBoundingClientRect();
     setOpen(false);setMenu(menu?null:{x:rect.right-340,y:rect.bottom+6});
    }}>
   <Puzzle size={15} aria-hidden="true"/>{t('plugins.actions_menu')}<ChevronDown size={13} aria-hidden="true"/>
  </button>
  {menu&&createPortal(<ContextMenu {...menu} className="extension-toolbar-menu" triggerRef={trigger} label={t('plugins.actions_menu')} items={menuItems} onClose={closeMenu}/>,document.body)}
  <span className="sr-only" role="status">{!failed&&message}</span>
  {open&&message&&createPortal(<section ref={notice} className="extension-toolbar-notice extension-message" aria-label={title}>
    <div className="extension-message-content">
     {!error&&<span className="extension-message-source">{result.entry.extensionName}</span>}
     <strong>{title}</strong>
     <p className="extension-message-detail" role={failed?'alert':undefined}>{message}</p>
    </div>
    <button type="button" className="icon-btn" aria-label={t('app.dismiss')} onClick={()=>{trigger.current?.focus();setOpen(false);}}><X size={15}/></button>
   </section>,document.body)}
 </div>;
}

export function ExtensionActions({location,extensionId,extensionKey,onChanged,beforeRun,onResult,onManagePlugins,onPluginPanels}){
 const {items,error}=useExtensionUi(location,extensionId,extensionKey),[busy,setBusy]=useState(''),[result,setResult]=useState(null);
 const toolbar=location==='toolbar',message=result?.message,failed=result?.failed;
 const [packages,setPackages]=useState([]);
 const packageKeys=items.map(entry=>entry.key).join('|');
 useEffect(()=>{if(location!=='export')return;let live=true;window.api.pluginsList?.().then(rows=>{if(live)setPackages(rows);}).catch(()=>{});return()=>{live=false;};},[location,packageKeys]);
 const run=async entry=>{
  if(busy||entry.enabled===false)return;
  setBusy(entry.id);if(!toolbar)setResult(null);
  const report=(message,failed)=>{const outcome={entry,message,failed};setResult(outcome);onResult?.(outcome);};
  try{
   if(!await flushExtensionSettings())throw Error(t('plugins.extension_settings_failed'));
   await beforeRun?.(entry);
   const response=await window.api.pluginsExtensionUiExecute(entry.id,undefined,entry.instance);
   if(response?.error)throw Error(response.error);
   report(extensionUiMessage(response,t('plugins.extension_completed')),false);
   onChanged?.();
  }catch(e){report(extensionUiError(e)||t('plugins.command_failed'),true);}
  finally{setBusy('');}
 };
 const actions=items.filter(i=>i.kind==='action');
 if(toolbar)return <ToolbarPlugins actions={actions} busy={busy} run={run} result={result} error={error} onManagePlugins={onManagePlugins} onPluginPanels={onPluginPanels}/>;
 if(!actions.length&&!error)return null;
 if(location==='export')return <section className="extension-export-options" data-extension-actions="export">
  <details>
   <summary><span>{t('plugins.export_with_plugin')}</span><span className="extension-export-count">{actions.length}</span><ChevronDown size={14}/></summary>
   <div className="extension-export-list">
    {actions.map(entry=>{
     const row=packages.find(row=>row.key===entry.key)||{key:entry.key,manifest:{id:entry.extensionId,name:entry.extensionName}};
     return <button key={entry.id} type="button" className="extension-export-option" data-extension-action={entry.id} disabled={!!busy||entry.enabled===false} title={entry.enabled===false?entry.disabledReason||entry.title:entry.title} onClick={()=>run(entry)}>
      {entry.icon?<ExtensionActionIcon entry={entry} size={24}/>:<PluginIdentityIcon row={row}/>} <span className="extension-export-copy"><strong>{entry.title}</strong><span>{entry.extensionName}</span></span><ArrowRight size={15} aria-hidden="true"/>
     </button>;
    })}
   </div>
  </details>
  {(message||error)&&<span role="status" className="extension-export-status" data-failed={failed||!!error}>{message||error}</span>}
 </section>;
 return <div className="extension-native-actions" data-extension-actions={location}>
  {actions.map(entry=><button key={entry.id} type="button" className="btn btn-sm" data-extension-action={entry.id} aria-label={entry.title}
    disabled={entry.enabled===false||!!busy} aria-busy={busy===entry.id||undefined}
    title={entry.enabled===false?entry.disabledReason||entry.title:entry.title} onClick={()=>run(entry)}>
    {entry.icon&&<ExtensionActionIcon entry={entry}/>}<span>{entry.title}</span>
   </button>)}
  {(message||error)&&<span role="status" className="dim small">{message||error}</span>}
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
