import React,{useEffect,useRef,useState} from 'react';
import {useExtensionUi,extensionUiError} from '../useExtensionUi.js';
import {samePreparationDocument} from '../extensionDraft.js';
import {inspectorBinding} from '../../../../shared/extensionInspector.mjs';
import {pluginEffectDefinition} from '../effectRegistry.js';
import ExtensionCurveField from './ExtensionCurveField.jsx';
import {resolveStyle} from '../../text/style.js';
import {clipLocked,findLinkPartner} from '../../../state/store.js';
function BoundField({entry,field,actual,project,selection,epoch,clip,disabled,onSet}){
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const anchor=useRef(null),editing=useRef(false),settled=useRef(false),latest=useRef({});latest.current={project,selection,epoch};
 const start=()=>{if(!editing.current){anchor.current={...latest.current,selection:structuredClone(selection)};editing.current=true;settled.current=false;}};
 useEffect(()=>{if(anchor.current&&!samePreparationDocument(anchor.current.project,project)){editing.current=false;anchor.current=null;setDraft(null);}},[project]);
 const change=value=>{start();setDraft(value);};
 const commit=async value=>{
  if(settled.current||busy)return;settled.current=true;
  if(value===null||value===undefined||['number','range'].includes(field.type)&&String(value).trim()===''){setDraft(null);editing.current=false;return;}
  const parsed=['number','range'].includes(field.type)?Number(value):value;
  if(JSON.stringify(parsed)===JSON.stringify(actual)){setDraft(null);editing.current=false;return;}
  const captured=anchor.current??{...latest.current,selection:structuredClone(selection)};
  setBusy(true);setError('');
  try{await onSet(entry.id,field.key,parsed,captured);setDraft(null);}catch(error){setDraft(null);setError(extensionUiError(error));}
  finally{setBusy(false);editing.current=false;anchor.current=null;}
 };
 const value=draft??actual??'',label=entry.title+': '+field.label,blocked=disabled||busy||field.readOnly;
 const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();settled.current=true;editing.current=false;setDraft(null);event.currentTarget.blur();}else if(event.key==='Enter'&&(field.type!=='string'||event.ctrlKey||event.metaKey)){event.preventDefault();commit(value);event.currentTarget.blur();}};
 const common={'aria-label':label,disabled:blocked,'data-extension-property':field.property,onFocus:start,onKeyDown:key};
 if(field.type==='curve')return <div data-extension-field={field.key}><ExtensionCurveField field={field} points={value} clip={clip} disabled={blocked} label={label} onChange={change} onCommit={commit} onCancel={()=>{settled.current=true;editing.current=false;anchor.current=null;setDraft(null);setError('');}}/>{error&&<small role="alert" className="error-text">{error}</small>}</div>;
 return <label className={`field extension-inspector-field${field.type==='boolean'?' extension-inspector-toggle':''}`} data-extension-field={field.key}>
  <span>{field.label}{field.type==='range'&&<output>{Number(value).toFixed(field.step>=1?0:2)}</output>}</span>
  {field.type==='boolean'?<input {...common} type="checkbox" className="switch" checked={value===true} onChange={event=>{settled.current=false;commit(event.target.checked);}}/>:
   field.type==='select'?<select {...common} value={value} onChange={event=>{settled.current=false;commit(event.target.value);}}>
    {!field.options.some(option=>option.value===value)&&<option value={value} disabled>{String(value)}</option>}
    {field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
   </select>:
   field.type==='string'?<textarea {...common} rows={2} value={value} maxLength={2000} onChange={event=>change(event.target.value)} onBlur={event=>commit(event.currentTarget.value)}/>:<input {...common} type={field.type==='range'?'range':field.type==='number'?'number':field.type==='color'?'color':'text'} value={value} min={field.min} max={field.max} step={field.step} maxLength={field.type==='string'?2000:undefined}
    onPointerDown={start} onChange={event=>{if(field.type==='color'){start();settled.current=false;commit(event.target.value);}else change(event.target.value);}}
    onPointerUp={field.type==='range'?event=>commit(event.currentTarget.value):undefined}
    onKeyUp={field.type==='range'?event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))commit(event.currentTarget.value);}:undefined}
    onBlur={event=>commit(event.currentTarget.value)}/>}
  {field.description&&<small className="muted">{field.description}</small>}
  {error&&<small role="alert" className="error-text">{error}</small>}
 </label>;
}
export default function ExtensionInspector({project,selection,epoch,onSet}){
 const {items,error}=useExtensionUi('inspector');
 const lane=selection?.track,clip=project[`${lane}Clips`]?.find(clip=>clip.id===selection?.id);
 if(!clip||clip.gap||!onSet)return null;
 const partner=clip.linkId?findLinkPartner(project,clip):null;
 const locked=clipLocked(project,lane,clip)||partner&&clipLocked(project,partner.track,partner.clip);
 const groups=items.filter(entry=>entry.kind==='inspector'&&entry.lanes.includes(lane));
 return <>{groups.map(entry=>{
  const media=project.media.find(item=>item.id===clip.mediaId),fields=entry.fields.map(field=>inspectorBinding(field,clip,{lane,media,style:resolveStyle(clip),effectDefinition:pluginEffectDefinition})).filter(Boolean);
  return fields.length?<section key={entry.id+':'+entry.instance+':'+epoch+':'+JSON.stringify(selection)} className="insp-card extension-inspector-group" data-extension-inspector={entry.id} aria-label={entry.title}>
   <div className="insp-card-title">{entry.title}</div>
   <div className="fields">{fields.map(({field,value})=><BoundField key={field.key} {...{entry,field,project,selection,epoch,clip,onSet}} actual={value} disabled={!!locked}/>)}</div>
  </section>:null;
 })}{error&&<p className="error-text" role="alert">{error}</p>}</>;
}
