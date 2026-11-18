import React,{useState} from 'react';
import {t} from '../../../i18n/index.js';
export default function PluginPreferenceMigration({row,rows}){
 const sources=rows.filter(r=>r.key!==row.key&&!r.recovered&&!r.removing&&r.manifest?.id===row.manifest.id&&r.manifest.publisher===row.manifest.publisher);
 const [from,setFrom]=useState(''),[panel,setPanel]=useState(''),[review,setReview]=useState(null),[keys,setKeys]=useState([]),[overwrite,setOverwrite]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const source=sources.find(r=>r.key===from),panels=(row.manifest.legacyPreferences?.panels||[]).filter(p=>source?.manifest.legacyPreferences?.panels?.some(s=>s.id===p.id));
 const act=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setBusy(false);}};
 if(row.recovered||row.removing||!sources.length||!row.manifest.legacyPreferences?.panels?.length)return null;
 return <section data-preference-migration><h5 className="set2-group-label">{t('plugins.migrate_title')}</h5><p className="set2-note">{t('plugins.migrate_hint')}</p>
  <label className="field"><span>{t('plugins.migrate_source')}</span><select disabled={busy} value={from} onChange={e=>{setFrom(e.target.value);setPanel('');setReview(null);setNotice('');}}><option value="">{t('plugins.migrate_choose')}</option>{sources.map(s=><option key={s.key} value={s.key}>{s.manifest.version} · {s.key.slice(0,12)}</option>)}</select></label>
  <label className="field"><span>{t('plugins.migrate_panel')}</span><select disabled={busy} value={panel} onChange={e=>{setPanel(e.target.value);setReview(null);}}><option value="">{t('plugins.migrate_choose')}</option>{panels.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
  <button type="button" className="btn btn-sm" data-review-preferences disabled={busy||!from||!panels.some(p=>p.id===panel)} onClick={()=>act(async()=>{const value=await window.api.pluginsPreparePreferenceMigration({from,to:row.key,panel});setReview(value);setKeys(value.keys.filter(k=>!k.conflict).map(k=>k.key));setOverwrite(false);})}>{t('plugins.migrate_review')}</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status" data-preferences-copied>{notice}</p>}
  {review&&<div data-preference-review><p>{review.sourceVersion} → {review.targetVersion} · {review.panel}</p>{!review.keys.length&&<p>{t('plugins.migrate_empty')}</p>}
   {review.keys.map(item=><label className="field row" key={item.key}><input type="checkbox" data-preference-key={item.key} disabled={busy} checked={keys.includes(item.key)} onChange={e=>setKeys(v=>e.target.checked?[...v,item.key]:v.filter(k=>k!==item.key))}/><span>{item.key} · {item.bytes} B{item.conflict&&` · ${t(item.same?'plugins.migrate_same':'plugins.migrate_conflict')}`}</span></label>)}
   {review.keys.some(k=>k.conflict&&keys.includes(k.key))&&<label className="field row"><input type="checkbox" data-preference-overwrite disabled={busy} checked={overwrite} onChange={e=>setOverwrite(e.target.checked)}/><span>{t('plugins.migrate_overwrite')}</span></label>}
   <div className="settings-actions"><button type="button" className="btn" data-copy-preferences disabled={busy||!keys.length||!overwrite&&review.keys.some(k=>k.conflict&&keys.includes(k.key))} onClick={()=>act(async()=>{const result=await window.api.pluginsMigratePreferences({token:review.token,keys,overwrite});setReview(null);setNotice(t('plugins.migrate_done',{count:result.copied}));})}>{t('plugins.migrate_copy')}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>setReview(null)}>{t('plugins.cancel')}</button></div>
  </div>}
 </section>;
}
