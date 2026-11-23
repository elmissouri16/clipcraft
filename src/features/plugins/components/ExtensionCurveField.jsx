import React from 'react';
import {t} from '../../../i18n/index.js';
export default function ExtensionCurveField({field,points,clip,disabled,onChange,onCommit,onCancel,label}){
 const property=field.property.slice(6),easings=property==='volume'?['linear']:['linear','in','out','inout','continuous'];
 const patch=(index,key,value)=>onChange(points.map((point,i)=>i===index?{...point,[key]:value}:point));
 const end=clip.out??clip.in??0,next=points.length?Math.min(end,points.at(-1).source_sec+Math.max(.001,(end-(clip.in??0))/4)):clip.in??0;
 return <fieldset className="extension-curve-field" disabled={disabled} aria-label={label} data-extension-property={field.property}>
  <legend>{field.label}</legend>
  <div className="extension-curve-points">{points.map((point,index)=><div className="extension-curve-point" key={index} data-curve-point={index}>
   <label><span>{t('plugins.curve_source_time')}</span><input type="number" aria-label={t('plugins.curve_source_time')} data-curve-time value={point.source_sec} min={clip.in??0} max={end} step="any" onChange={event=>patch(index,'source_sec',event.target.value===''?'':Number(event.target.value))}/></label>
   <label><span>{t('plugins.curve_value')}</span><input type="number" aria-label={t('plugins.curve_value')} data-curve-value value={point.value} min={field.min} max={field.max} step="any" onChange={event=>patch(index,'value',event.target.value===''?'':Number(event.target.value))}/></label>
   <label><span>{t('plugins.curve_easing')}</span><select aria-label={t('plugins.curve_easing')} data-curve-easing value={point.easing} onChange={event=>patch(index,'easing',event.target.value)}>{easings.map(easing=><option value={easing} key={easing}>{t('plugins.curve_ease_'+easing)}</option>)}</select></label>
   <button type="button" className="btn btn-sm" data-curve-remove onClick={()=>onChange(points.filter((_,i)=>i!==index))}>{t('app.remove')}</button>
  </div>)}</div>
  <div className="settings-actions"><button type="button" className="btn btn-sm" data-curve-add disabled={disabled||points.length>=64||points.length>0&&next<=points.at(-1).source_sec} onClick={()=>onChange([...points,{source_sec:next,value:Math.min(field.max,Math.max(field.min,property==='opacity'||property==='volume'||property==='scale'?1:0)),easing:'linear'}])}>{t('plugins.curve_add')}</button><button type="button" className="btn btn-sm" data-curve-clear disabled={disabled||!points.length} onClick={()=>onChange([])}>{t('plugins.curve_clear')}</button><button type="button" className="btn btn-sm btn-primary" data-curve-apply onClick={()=>onCommit(points)}>{t('plugins.custom_apply')}</button><button type="button" className="btn btn-sm" data-curve-cancel onClick={onCancel}>{t('app.cancel')}</button></div>
 </fieldset>;
}
