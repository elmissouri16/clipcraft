// Return one validated contribution to the editor's isolated sample renderer. Never install/register it.
async function contentPreview(manager,{key,kind,id}={}){
 const {PACK_CONTENT_KINDS}=await import('../../shared/pluginBrowser.mjs');
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!PACK_CONTENT_KINDS.includes(kind)||typeof id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('Invalid content preview.');
 const bundle=await manager.commandBundle(key),m=bundle.manifest,item=structuredClone(m.contributes[kind]?.find(v=>v.id===id));if(!item)throw Error('This pack item is unavailable.');
 if(kind==='textStyles'&&item.style.font?.startsWith('pack:'))item.style.font=`pack-font:${key}:${item.style.font.slice(5)}`;
 const ids=kind==='luts'?[id]:kind==='colorPresets'?[item.settings.lut,item.settings.filterLut].filter(Boolean):[],luts={};
 for(const local of new Set(ids)){const def=m.contributes.luts.find(l=>l.id===local);if(!def)throw Error('Required preview LUT is unavailable.');luts[local]=bundle.files.get(def.file).toString('utf8');}
 return {key,kind,item,luts,pluginId:m.id,pluginName:m.name,version:m.version,development:!!bundle.development};
}
module.exports={contentPreview};
