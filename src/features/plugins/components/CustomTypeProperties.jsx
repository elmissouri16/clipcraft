import React,{useEffect,useRef,useState} from 'react';
import {t} from '../../../i18n/index.js';
import {customTimelineEdit,customTypesRevision,customClipType,customTrackType} from '../../../../shared/customTimeline.mjs';
const initial=schema=>schema.type==='object'?Object.fromEntries(Object.entries(schema.properties).filter(([key])=>schema.required?.includes(key)).map(([key,value])=>[key,initial(value)])):schema.type==='array'?[]:schema.type==='boolean'?false:schema.type==='null'?null:schema.type==='string'?schema.enum?.[0]??'':schema.minimum??0;
function DataNode({schema,value,path,label,onChange,labels}){
 const [open,setOpen]=useState(path.length===0),[limit,setLimit]=useState(32);
 const fieldLabel=label||path.join('.');
 if(schema.type==='object'||schema.type==='array'){
  const rows=schema.type==='object'?Object.entries(schema.properties).map(([key,child])=>[key,child,value?.[key]]):(value??[]).map((item,index)=>[index,schema.items,item]);
  return <details className="custom-data-group" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{fieldLabel||t('plugins.custom_data')} <small>{rows.length}</small></summary>{open&&<>
   {rows.slice(0,limit).map(([key,child,item])=><div key={key}><DataNode schema={child} value={item} path={[...path,key]} label={path.length===0?(labels?.[key]??String(key)):String(key)} onChange={onChange}/>{schema.type==='array'&&<button type="button" className="btn btn-sm" onClick={()=>onChange(path,(value??[]).filter((_,index)=>index!==key))}>{t('app.remove')}</button>}</div>)}
   {rows.length>limit&&<button type="button" className="btn btn-sm" onClick={()=>setLimit(count=>count+32)}>{t('plugins.custom_more')}</button>}
   {schema.type==='array'&&<button type="button" className="btn btn-sm" disabled={value?.length>=(schema.maxItems??8192)} onClick={()=>onChange(path,[...(value??[]),initial(schema.items)])}>{t('plugins.custom_add_item')}</button>}
  </>}</details>;
 }
 const name=fieldLabel||t('plugins.custom_data'),props={'aria-label':name,'data-custom-property':path.join('.')};
 if(schema.type==='null')return <label className="field"><span>{name}</span><output>{value===undefined?t('plugins.custom_unset'):String(value)}</output></label>;
 return <label className="field"><span>{name}{value===undefined&&<small className="muted"> {t('plugins.custom_unset')}</small>}</span>
  {schema.type==='boolean'?<input {...props} type="checkbox" checked={value===true} onChange={event=>onChange(path,event.target.checked)}/>:
   schema.type==='string'&&schema.enum?<select {...props} value={value??''} onChange={event=>onChange(path,event.target.value)}>{value===undefined&&<option value="" disabled>{t('plugins.custom_choose')}</option>}{schema.enum.map(option=><option key={option}>{option}</option>)}</select>:
   schema.type==='string'?<textarea {...props} rows={2} value={value??''} maxLength={schema.maxLength??65536} onChange={event=>onChange(path,event.target.value)}/>:<input {...props} type={['number','integer'].includes(schema.type)?'number':'text'} value={value??''} min={schema.minimum} max={schema.maximum} step={schema.type==='integer'?1:'any'} maxLength={schema.maxLength??2000} onChange={event=>onChange(path,schema.type==='string'?event.target.value:event.target.value===''?undefined:Number(event.target.value))}/>}
 </label>;
}
function TypeDataEditor({definition,data,project,onSave}){
 const [draft,setDraft]=useState(()=>structuredClone(data)),[dirty,setDirty]=useState(false),[error,setError]=useState(''),base=useRef(project);
 useEffect(()=>{if(!dirty){setDraft(structuredClone(data));base.current=project;}},[data,project,dirty]);
 const change=(path,value)=>{if(!dirty)base.current=project;setDirty(true);setDraft(previous=>{const next=structuredClone(previous);let node=next;for(let index=0;index<path.length-1;index++){const key=path[index];node[key]??=typeof path[index+1]==='number'?[]:{};node=node[key];}if(value===undefined)delete node[path.at(-1)];else node[path.at(-1)]=value;return next;});};
 return <div className="custom-data-editor"><DataNode schema={definition.schema} value={draft} path={[]} label={definition.name} labels={definition.labels} onChange={change}/>{dirty&&<div className="settings-actions"><button type="button" className="btn btn-sm btn-primary" data-custom-apply onClick={()=>{try{onSave(draft,base.current);setDirty(false);setError('');}catch(error){setError(error.message);}}}>{t('plugins.custom_apply')}</button><button type="button" className="btn btn-sm" onClick={()=>{setDraft(structuredClone(data));base.current=project;setDirty(false);setError('');}}>{t('app.cancel')}</button></div>}{error&&<p role="alert" className="error-text small">{error}</p>}</div>;
}
function NumberField({label,value,min,max,onSet,disabled,project}){
 const [draft,setDraft]=useState(String(value)),base=useRef(null);useEffect(()=>setDraft(String(value)),[value]);
 return <label className="field"><span>{label}</span><input type="number" aria-label={label} disabled={disabled} min={min} max={max} step="any" value={draft} onFocus={()=>base.current=project} onChange={event=>setDraft(event.target.value)} onBlur={()=>{if(draft.trim()&&Number(draft)!==value)onSet(Number(draft),base.current);else setDraft(String(value));}}/></label>;
}
export default function CustomTypeProperties({project,selection,dispatch,time=0}){
 const [error,setError]=useState('');const isTrack=selection?.track==='custom-track',row=(isTrack?project.customTracks:project.customClips)?.find(row=>row.id===selection?.id),track=isTrack?row:project.customTracks?.find(track=>track.id===row?.trackId),definition=row&&(isTrack?customTrackType(row.typeId):customClipType(row.typeId));
 if(!row)return null;
 const apply=(operations,base=project)=>{if(base!==project)throw Error('Custom timeline changed; reload these properties');const next=customTimelineEdit(base,operations);if(next!==base)dispatch({type:'customTimeline',base,catalogRevision:customTypesRevision(),operations});},attempt=(operations,base=project)=>{try{apply(operations,base);setError('');}catch(error){setError(error.message);}},patch=(value,base=project)=>attempt([{type:isTrack?'update-track':'update-clip',id:row.id,patch:value}],base);
 return <div className="custom-type-properties" data-custom-properties={row.id}>
  <h4>{row.name}</h4><p className="muted small">{definition?.name??t('plugins.custom_missing_type')}</p>
  {!definition&&<p className="error-text" role="alert">{t('plugins.custom_missing_type')}</p>}
  {isTrack&&<label className="field"><span>{t('plugins.custom_name')}</span><input key={row.id+row.name} defaultValue={row.name} aria-label={t('plugins.custom_name')} disabled={row.locked} onBlur={event=>patch({name:event.target.value})}/></label>}
  {isTrack&&<div className="settings-actions"><button className="btn btn-sm" type="button" disabled={row.locked||project.customTracks[0].id===row.id} data-custom-up onClick={()=>{const index=project.customTracks.findIndex(track=>track.id===row.id);attempt([{type:'move-track',id:row.id,beforeId:project.customTracks[index-1].id}]);}}>{t('plugins.custom_move_up')}</button><button className="btn btn-sm" type="button" disabled={row.locked||project.customTracks.at(-1).id===row.id} data-custom-down onClick={()=>{const index=project.customTracks.findIndex(track=>track.id===row.id);attempt([{type:'move-track',id:row.id,beforeId:project.customTracks[index+2]?.id??null}]);}}>{t('plugins.custom_move_down')}</button></div>}
  {!isTrack&&<>
   <NumberField project={project} label={t('plugins.custom_start')} value={row.start} min={0} disabled={track.locked} onSet={(value,base)=>patch({start_sec:value},base)}/>
   <NumberField project={project} label={t('plugins.custom_duration')} value={row.duration} min={.02} disabled={track.locked} onSet={(value,base)=>patch({duration_sec:value},base)}/>
   <NumberField project={project} label={t('plugins.custom_source')} value={row.sourceIn} min={0} disabled={track.locked} onSet={(value,base)=>patch({sourceIn_sec:value},base)}/>
   <NumberField project={project} label={t('plugins.custom_speed')} value={row.speed} min={.25} max={4} disabled={track.locked} onSet={(value,base)=>patch({speed:value},base)}/>
   <NumberField project={project} label={t('plugins.custom_opacity')} value={row.opacity} min={0} max={1} disabled={track.locked} onSet={(value,base)=>patch({opacity:value},base)}/>
   {[['scale',1,.05,4],['x',0,-2,2],['y',0,-2,2],['rot',0,-180,180]].map(([key,fallback,min,max])=><NumberField key={key} project={project} label={t('plugins.custom_transform_'+key)} value={row.transform?.[key]??fallback} min={min} max={max} disabled={track.locked} onSet={(value,base)=>patch({transform:{...row.transform,[key]:value}},base)}/>)}
   <label className="field row"><span>{t('plugins.custom_disabled')}</span><input type="checkbox" data-custom-disabled disabled={track.locked} checked={row.disabled} onChange={event=>patch({disabled:event.target.checked})}/></label>
   <div className="settings-actions"><button className="btn btn-sm" disabled={track.locked} type="button" data-custom-duplicate onClick={()=>attempt([{type:'duplicate-clip',id:row.id,newId:'xc-'+crypto.randomUUID()}])}>{t('timeline.duplicate')}</button><button className="btn btn-sm" disabled={track.locked||time<row.start+.02||time>row.start+row.duration-.02} type="button" data-custom-split onClick={()=>attempt([{type:'split-clip',id:row.id,newId:'xc-'+crypto.randomUUID(),at_sec:time}])}>{t('plugins.custom_split')}</button><button className="btn btn-sm" disabled={track.locked} type="button" data-custom-delete onClick={()=>attempt([{type:'delete-clip',id:row.id}])}>{t('app.remove')}</button></div>
  </>}
  {definition&&!track.locked&&<TypeDataEditor key={row.id+row.typeId} definition={definition} data={row.data} project={project} onSave={(data,base)=>apply([{type:isTrack?'update-track':'update-clip',id:row.id,patch:{data,replaceData:true}}],base)}/>}
  {error&&<p className="error-text small" role="alert">{error}</p>}
 </div>;
}
