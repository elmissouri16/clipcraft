import React,{useEffect,useState} from 'react';
import NumBox from '../../../components/ui/NumBox.jsx';
import Dropdown from '../../../components/ui/Dropdown.jsx';
import {t} from '../../../i18n/index.js';
export default function PluginCommands({row,controller,exportMode=false}){
 const [inputs,setInputs]=useState({});
 useEffect(()=>()=>controller?.cancelManual?.(row?.key),[row?.key]);
 if(!row?.manifest?.contributes?.commands?.length)return null;
 const busy=['permission','running','review','applying'].includes(controller?.status?.phase);
 const status=controller?.status?.key===row.key?controller.status:null;
 return <section className="plugin-commands" aria-label={t('plugins.commands')}>
  {!exportMode&&<h5>{t('plugins.commands')}</h5>}
  {row.manifest.contributes.commands.map(command=>{
   const input={...Object.fromEntries(command.parameters.map(p=>[p.id,p.default])),...inputs[command.id]};
   return <div key={command.id} className="plugin-command" data-plugin-command={command.id}>
    {(!exportMode||row.manifest.contributes.commands.length>1)&&<b>{command.name}</b>}{command.description&&<p className="dim small">{command.description}</p>}
    <fieldset className="plugin-command-fields" disabled={busy}>
    {command.parameters.map(p=>p.type==='enum'?<label key={p.id} className="plugin-enum-field"><span>{p.name}</span><Dropdown value={input[p.id]} options={p.options} ariaLabel={p.name} disabled={busy} onChange={value=>setInputs(previous=>({...previous,[command.id]:{...previous[command.id],[p.id]:value}}))} /></label>:<NumBox key={p.id} layout="field" label={p.name} value={input[p.id]} min={p.min} max={p.max} step={p.step} onChange={value=>setInputs(previous=>({...previous,[command.id]:{...previous[command.id],[p.id]:value}}))} />)}
    </fieldset>
    <button type="button" className={exportMode?"btn btn-primary":"btn"} disabled={!row.enabled||!controller?.hasProject||busy} onClick={()=>controller.run({id:command.id,key:row.key,permissions:row.manifest.permissions,development:!!row.development},input)}>{t(exportMode?'plugins.gif_export':'plugins.run_command')}</button>
   </div>;
  })}
  {!controller?.hasProject&&<p className="dim small">{t('plugins.command_open_project')}</p>}
  {status&&<div role={status.phase==='failed'?'alert':'status'} className="plugin-command-status" data-phase={status.phase}>
   <p>{status.message||t(status.phase==='permission'?'plugins.command_permission_pending':'plugins.command_running')}</p>
   {status.artifact&&<div className="plugin-export-artifact"><p>{status.artifact.width}×{status.artifact.height} · {t('home.fps_value',{fps:status.artifact.fps})} · {status.artifact.duration_sec.toFixed(2)} s · {(status.artifact.bytes/1024).toFixed(0)} KB</p><p className="dim small">{status.artifact.path}</p><button type="button" className="btn" onClick={()=>window.api.openFile(status.artifact.path)}>{t('export.open_file')}</button> <button type="button" className="btn btn-ghost" onClick={()=>window.api.showInFolder(status.artifact.path)}>{t('activity.show_in_folder')}</button></div>}
   {status.pluginMessage&&<p className="dim small">{t('plugins.command_response',{message:status.pluginMessage})}</p>}
   {busy&&<><progress value={status.progress||0} max="1" aria-label={t('plugins.command_progress')} /> {status.phase!=='applying'&&<button type="button" className="btn btn-ghost" onClick={controller.cancel}>{t('plugins.cancel')}</button>}</>}
  </div>}
 </section>;
}
