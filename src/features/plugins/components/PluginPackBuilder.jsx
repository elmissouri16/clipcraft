import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {packCandidates} from '../packCandidates.js';
import {loadPresets} from '../../effects/presets.js';
import {fontById,allFonts,onFontsChanged,getFontRevision} from '../../text/fonts.js';
import {FONT_LIST} from '../../../../shared/fontCatalog.mjs';
import {t} from '../../../i18n/index.js';
const builtinFonts=new Set(FONT_LIST.map(f=>f.id));
const candidateName=c=>c.savedName||t(c.type==='text'?'plugins.builder_text_name':c.type==='color'?'plugins.builder_color_name':'plugins.builder_motion_name',{index:c.index});
function Field({label,value,onChange,...props}){return <label className="field"><span>{label}</span><input value={value??''} onChange={e=>onChange(e.target.value)} {...props}/></label>;}
export default function PluginPackBuilder({project,onClose}){
 useSyncExternalStore(onFontsChanged,getFontRevision,getFontRevision);
 const candidates=useMemo(()=>packCandidates(project,loadPresets()),[project]);
 const [draft,setDraft]=useState(null),[selected,setSelected]=useState([]),[assets,setAssets]=useState([]),[licenses,setLicenses]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
 const root=useRef(null),receipt=useRef(null);
 const [metadata,setMetadata]=useState({id:'',name:'',publisher:'',version:'0.1.0',description:''});
 const live=useRef(true),draftId=useRef(null);
 useEffect(()=>{live.current=true;window.api.pluginsBeginPackDraft().then(value=>{if(live.current){draftId.current=value.id;setDraft(value.id);}else window.api.pluginsDiscardPackDraft(value.id).catch(()=>{});}).catch(e=>{if(live.current)setError(String(e.message||e).replace(/^Error invoking remote method 'plugins:[^']+': (?:Error: )?/,''));});return()=>{live.current=false;if(draftId.current)window.api.pluginsDiscardPackDraft(draftId.current).catch(()=>{});};},[]);
 useEffect(()=>{if(draft){root.current?.scrollIntoView({block:'start'});root.current?.querySelector('input')?.focus({preventScroll:true});}},[draft]);
 useEffect(()=>{if(result)receipt.current?.scrollIntoView({block:'nearest'});},[result]);
 const perform=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){if(live.current)setError(String(e.message||e).replace(/^Error invoking remote method 'plugins:[^']+': (?:Error: )?/,''));}finally{if(live.current)setBusy(false);}};
 const toggle=source=>setSelected(values=>{const key=`${project?.id||'none'}:${source.key}`;if(values.some(v=>v.key===key))return values.filter(v=>v.key!==key);let n=1;while(values.some(v=>v.entry.id===`${source.type}-${n}`))n++;return [...values,{key,type:source.type,original:structuredClone(source.preset),entry:{id:`${source.type}-${n}`,name:candidateName(source),...structuredClone(source.preset),...(source.type==='text'?{sampleText:t('plugins.builder_sample_default')}:{})}}];});
 const changeEntry=(key,patch)=>setSelected(values=>values.map(v=>v.key===key?{...v,entry:{...v.entry,...patch}}:v));
 const changeAsset=(token,patch)=>setAssets(values=>values.map(v=>v.token===token?{...v,...patch}:v));
 const pick=kind=>perform(async()=>{const batch=await window.api.pluginsPickPackAssets(draft,kind);if(!live.current)return;setAssets(values=>{let n=values.length;return [...values,...batch.map(v=>({...v,id:`${kind}-${++n}`,license:'',soundKind:'sfx',weight:400,style:'normal'}))];});});
 const requiredFonts=[...new Set(selected.filter(v=>v.type==='text').map(v=>v.entry.style.font).filter(f=>f&&!builtinFonts.has(f)&&!f.startsWith('draft-font:')))];
 const exportPack=()=>perform(async()=>{
  setResult(null);const input={metadata,assets:assets.map(({token,kind,id,name,license,soundKind,weight,style})=>({token,kind,id,name,license,...(kind==='sound'?{soundKind}:kind==='font'?{weight:Number(weight),style}:{})})),textStyles:selected.filter(v=>v.type==='text').map(v=>v.entry),colorPresets:selected.filter(v=>v.type==='color').map(v=>v.entry),motionPresets:selected.filter(v=>v.type==='motion').map(v=>v.entry),fontLicenses:licenses};
  const receipt=await window.api.pluginsExportPackDraft(draft,input);if(live.current&&receipt)setResult(receipt);
 });
 return <section ref={root} className="plugin-pack-builder" data-pack-builder>
  <div className="settings-actions"><h3>{t('plugins.builder_title')}</h3><button type="button" className="btn btn-sm" onClick={onClose}>{t('plugins.builder_close')}</button></div>
  <p className="set2-note">{t('plugins.builder_hint')}</p>{error&&<p role="alert" className="error-text">{error}</p>}
  <fieldset disabled={busy||!draft}>
   <div className="settings-grid">
    <Field label={t('plugins.builder_id')} value={metadata.id} placeholder="studio.creative-pack" maxLength={97} onChange={id=>setMetadata(v=>({...v,id}))}/>
    <Field label={t('plugins.builder_name')} value={metadata.name} maxLength={160} onChange={name=>setMetadata(v=>({...v,name}))}/>
    <Field label={t('plugins.builder_publisher')} value={metadata.publisher} maxLength={160} onChange={publisher=>setMetadata(v=>({...v,publisher}))}/>
    <Field label={t('plugins.builder_version')} value={metadata.version} maxLength={20} onChange={version=>setMetadata(v=>({...v,version}))}/>
   </div>
   <Field label={t('plugins.builder_description')} value={metadata.description} maxLength={1000} onChange={description=>setMetadata(v=>({...v,description}))}/>
   <h4>{t('plugins.builder_current_presets')}</h4>
   {!candidates.length&&<p>{t('plugins.builder_no_presets')}</p>}
   <div className="pack-candidates">{candidates.map(c=>{const key=`${project?.id||'none'}:${c.key}`;return <label key={key} className="field row"><input type="checkbox" data-pack-candidate-type={c.type} checked={selected.some(v=>v.key===key)} disabled={!!c.error} onChange={()=>toggle(c)}/><span>{candidateName(c)}{c.error&&` — ${c.error}`}</span></label>;})}</div>
   {selected.map(value=><div key={value.key} className="settings-group" data-pack-preset={value.type}>
    <div className="settings-grid"><Field label={t('plugins.builder_item_id')} value={value.entry.id} maxLength={64} onChange={id=>changeEntry(value.key,{id})}/><Field label={t('plugins.builder_item_name')} value={value.entry.name} maxLength={160} onChange={name=>changeEntry(value.key,{name})}/></div>
    {value.type==='text'&&<><label className="field"><span>{t('plugins.builder_style_font')}</span><select value={value.entry.style.font||'montserrat'} onChange={e=>changeEntry(value.key,{style:{...value.entry.style,font:e.target.value}})}>{allFonts().map(f=><option key={f.id} value={f.id}>{f.name} — {t(`fonts.${f.source}`)}</option>)}{assets.filter(a=>a.kind==='font').map(a=><option key={a.token} value={`draft-font:${a.token}`}>{a.name} — {t('plugins.builder_selected_file')}</option>)}</select></label><p className="set2-note">{t('plugins.builder_font_hint')}</p><label className="field"><span>{t('plugins.builder_text_kind')}</span><select value={value.entry.kind} onChange={e=>changeEntry(value.key,{kind:e.target.value})}><option value="title">{t('plugins.builder_kind_title')}</option><option value="caption">{t('plugins.builder_kind_caption')}</option><option value="lower-third">{t('plugins.builder_kind_lower')}</option></select></label><Field label={t('plugins.builder_sample_text')} value={value.entry.sampleText} maxLength={200} onChange={sampleText=>changeEntry(value.key,{sampleText})}/><Field label={t('plugins.builder_duration')} value={value.entry.duration} type="number" min="0.1" max="60" step="0.1" onChange={duration=>changeEntry(value.key,{duration:Number(duration)})}/></>}
    {value.type==='color'&&['sourceLut','sourceFilterLut'].map(key=><label className="field" key={'choose-'+key}><span>{t(key==='sourceLut'?'plugins.builder_grade_lut':'plugins.builder_filter_lut')}</span><select value={value.entry[key]?.draftAsset|| (value.entry[key]?'current':'')} onChange={e=>changeEntry(value.key,{[key]:e.target.value==='current'?structuredClone(value.original[key]):e.target.value?{draftAsset:e.target.value}:undefined,...(key==='sourceFilterLut'?{settings:{...value.entry.settings,filter:e.target.value?'none':value.original.settings.filter}}:{})})}><option value="">{t('grade.none')}</option>{value.original[key]&&<option value="current">{t('plugins.builder_current_lut')}</option>}{assets.filter(a=>a.kind==='lut').map(a=><option key={a.token} value={a.token}>{a.name}</option>)}</select></label>)}
    {value.type==='color'&&['sourceLut','sourceFilterLut'].map(key=>value.entry[key]&&<div key={key} data-pack-look-asset><p>{t('plugins.builder_included_lut')} · {value.entry[key].assetId||value.entry[key].bundled||value.entry[key].path||assets.find(a=>a.token===value.entry[key].draftAsset)?.name}</p>{value.entry[key].path&&<label className="field"><span>{t('plugins.asset_license')}</span><textarea maxLength={8000} value={value.entry[key+'License']||''} onChange={e=>changeEntry(value.key,{[key+'License']:e.target.value})}/></label>}</div>)}
   </div>)}
   {!!requiredFonts.length&&<><h4>{t('plugins.builder_included_fonts')}</h4>{requiredFonts.map(id=>{const font=fontById(id),packed=id.startsWith('pack-font:');return <label key={id} className="field" data-pack-font-license><span>{font.id===id?font.name:id} · {t('plugins.asset_license')}</span><textarea readOnly={packed} maxLength={8000} value={packed?font.license||t('plugins.builder_original_license'):licenses[id]||''} onChange={e=>setLicenses(v=>({...v,[id]:e.target.value}))}/></label>;})}</>}
   <h4>{t('plugins.builder_assets')}</h4><div className="settings-actions">{['sound','font','lut'].map(kind=><button type="button" className="btn btn-sm" key={kind} data-pack-pick={kind} onClick={()=>pick(kind)}>{t(`plugins.builder_add_${kind}`)}</button>)}</div>
   {assets.map(asset=><div key={asset.token} className="settings-group" data-pack-asset={asset.kind}>
    <p>{asset.filename}</p><div className="settings-grid"><Field label={asset.kind==='font'?t('plugins.builder_family_id'):t('plugins.builder_item_id')} value={asset.id} maxLength={64} onChange={id=>changeAsset(asset.token,{id})}/><Field label={t('plugins.builder_item_name')} value={asset.name} maxLength={160} onChange={name=>changeAsset(asset.token,{name})}/></div>
    <label className="field"><span>{t('plugins.asset_license')}</span><textarea maxLength={8000} value={asset.license} onChange={e=>changeAsset(asset.token,{license:e.target.value})}/></label>
    {asset.kind==='sound'&&<label className="field"><span>{t('plugins.builder_sound_kind')}</span><select value={asset.soundKind} onChange={e=>changeAsset(asset.token,{soundKind:e.target.value})}><option value="sfx">{t('library.sound_effects')}</option><option value="music">{t('library.music')}</option></select></label>}
    {asset.kind==='font'&&<div className="settings-grid"><Field label={t('plugins.builder_weight')} type="number" min="100" max="900" step="1" value={asset.weight} onChange={weight=>changeAsset(asset.token,{weight})}/><label className="field"><span>{t('plugins.builder_face_style')}</span><select value={asset.style} onChange={e=>changeAsset(asset.token,{style:e.target.value})}><option value="normal">{t('plugins.builder_regular')}</option><option value="italic">{t('text.italic')}</option></select></label></div>}
    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setAssets(v=>v.filter(a=>a.token!==asset.token))}>{t('plugins.builder_remove_asset')}</button>
   </div>)}
   <p className="set2-note">{t('plugins.builder_license_hint')}</p><button type="button" className="btn" data-pack-export disabled={!selected.length&&!assets.length} onClick={exportPack}>{t('plugins.builder_export')}</button>
  </fieldset>
  {busy&&<p role="status">{t('plugins.working')}</p>}
  {result&&<div ref={receipt} data-created-pack-key={result.key}><h4>{t('plugins.builder_exported')}</h4><p>{result.path}</p><button type="button" className="btn btn-sm" onClick={()=>window.api.showInFolder(result.path)}>{t('plugins.builder_show_archive')}</button><p>{Object.entries(result.manifest.contributes).filter(([,values])=>values.length).map(([kind,values])=>`${t('plugins.builder_summary_'+kind)}: ${values.length}`).join(' · ')}</p><details><summary>{t('plugins.fingerprint')}</summary><code className="plugin-fingerprint">{result.key}</code></details><button type="button" className="btn" data-pack-install disabled={busy||result.installed} onClick={()=>perform(async()=>{await window.api.pluginsInstallCreatedPack(draft,result.token);if(live.current)setResult(v=>({...v,installed:true}));})}>{t(result.installed?'plugins.builder_installed':'plugins.builder_install')}</button></div>}
 </section>;
}
