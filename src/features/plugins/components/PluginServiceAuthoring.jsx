import React,{useEffect,useRef,useState} from 'react';
import {t} from '../../../i18n/index.js';
// Creative export presets are data. Their preview uses the ordinary native
// renderer; executable services are tested through their Node development host.
export default function PluginServiceAuthoring({session,onExport,onBusy}){
 const presets=session?.manifest?.contributes.exportPresets||[],[presetId,setPresetId]=useState(presets[0]?.id||''),[start,setStart]=useState(0),[seconds,setSeconds]=useState(5),[busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState(''),controller=useRef(null),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;controller.current?.abort();window.api.pluginsCancelAuthorTest().catch(()=>{});};},[]);
 useEffect(()=>{onBusy?.(busy);return()=>onBusy?.(false);},[busy,onBusy]);
 const render=async()=>{setBusy(true);setError('');setResult('');const abort=new AbortController();controller.current=abort;try{const answer=await onExport({key:session.key,id:presetId,start,seconds,signal:abort.signal});if(answer.error)throw Error(answer.error);if(live.current&&!abort.signal.aborted)setResult(answer.canceled?t('plugins.author_canceled'):t('plugins.author_saved',{file:answer.file}));}catch(error){if(live.current)setError(error.message);}finally{if(live.current)setBusy(false);controller.current=null;}};
 if(session?.status!=='ready'||!presets.length)return null;
 return <div className="plugin-service-authoring"><p className="set2-note">{t('plugins.author_hint')}</p><fieldset disabled={busy}><legend>{t('plugins.author_export')}</legend>
  <label>{t('plugins.author_preset')}<select data-author-preset value={presetId} onChange={event=>setPresetId(event.target.value)}>{presets.map(preset=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
  <label>{t('plugins.author_start')}<input data-author-start type="number" min="0" step="0.1" value={start} onChange={event=>setStart(Number(event.target.value))}/></label>
  <label>{t('plugins.author_seconds')}<input data-author-seconds type="number" min="0.1" max="15" step="0.1" value={seconds} onChange={event=>setSeconds(Number(event.target.value))}/></label>
  <button type="button" className="btn" data-author-render disabled={!onExport||!Number.isFinite(start)||start<0||!Number.isFinite(seconds)||seconds<=0||seconds>15} onClick={render}>{t('plugins.author_render')}</button>
 </fieldset>{busy&&<><button type="button" className="btn" data-author-cancel onClick={()=>{controller.current?.abort();window.api.pluginsCancelAuthorTest().catch(()=>{});}}>{t('app.cancel')}</button><p role="status">{t('plugins.author_running')}</p></>}{result&&<pre data-author-result role="status">{result}</pre>}{error&&<p className="error-text" data-author-error role="alert">{error}</p>}</div>;
}
