// Declarative UI metadata only. No scripts, HTML, CSS, keybindings or dynamic conditions.
export const ACTION_LOCATIONS=Object.freeze(['plugins-menu','clip-menu']);
export const ACTION_ICONS=Object.freeze(['command','sparkles','scissors','export','text','audio','layers','info']);
export const ACTION_CATALOG_LIMIT=256;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Invalid plugin action fields.');};
const local=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v);
export function validateAction(value){
 keys(value,['id','commandId','label','icon','locations','when']);
 if(!local(value.id)||!local(value.commandId)||typeof value.label!=='string'||!value.label.trim()||value.label.length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.label))throw Error('Invalid plugin action identity or label.');
 if(value.icon!==undefined&&!ACTION_ICONS.includes(value.icon))throw Error('Unsupported plugin action icon.');
 if(!Array.isArray(value.locations)||!value.locations.length||value.locations.length>2||new Set(value.locations).size!==value.locations.length||value.locations.some(x=>!ACTION_LOCATIONS.includes(x)))throw Error('Invalid plugin action locations.');
 let when;
 if(value.when!==undefined){
  keys(value.when,['selection','lanes']);
  if(value.when.selection!==undefined&&!['any','none','single','multiple'].includes(value.when.selection))throw Error('Invalid action selection condition.');
  const lanes=value.when.lanes;
  if(lanes!==undefined&&(!Array.isArray(lanes)||!lanes.length||lanes.length>5||new Set(lanes).size!==lanes.length||lanes.some(x=>!['video','overlay','audio','text','effect'].includes(x))))throw Error('Invalid action lane condition.');
  if(value.when.selection==='none'&&lanes)throw Error('Lane conditions require a selection.');
  when={...(value.when.selection?{selection:value.when.selection}:{}),...(lanes?{lanes:[...lanes]}:{})};
 }
 return {id:value.id,commandId:value.commandId,label:value.label,...(value.icon?{icon:value.icon}:{}),locations:[...value.locations],...(when?{when}:{})};
}
export function actionCatalog(rows){
 const items=rows.filter(row=>row.enabled&&row.manifest).flatMap(row=>{
  const m=row.manifest;
  return (m.contributes.actions||[]).map(action=>({...action,key:row.key,pluginId:m.id,pluginName:m.name,publisher:m.publisher,version:m.version,permissions:[...m.permissions],command:m.contributes.commands.find(c=>c.id===action.commandId),...(row.development?{development:true,sessionId:row.sessionId}:{})}));
 }).sort((a,b)=>`${a.pluginId}/${a.id}/${a.key}`.localeCompare(`${b.pluginId}/${b.id}/${b.key}`));
 return {items:items.slice(0,ACTION_CATALOG_LIMIT),total:items.length,truncated:items.length>ACTION_CATALOG_LIMIT};
}
// Selection entries are private host projections, never returned to plugin code.
export function actionState(action,location,{selection=[],hasProject=false,busy=false}={}){
 if(!action.locations.includes(location))return {visible:false};
 const condition=action.when?.selection||'any',count=selection.length,lanes=action.when?.lanes;
 if(location==='clip-menu'&&!count||condition==='none'&&count||condition==='single'&&count!==1||condition==='multiple'&&count<2||lanes&&(!count||selection.some(c=>!lanes.includes(c.lane))))return {visible:false};
 if(!hasProject)return {visible:true,enabled:false,reason:'project'};
 if(busy)return {visible:true,enabled:false,reason:'busy'};
 if(location==='clip-menu'&&selection.some(c=>c.gap||c.attached))return {visible:false};
 if(selection.some(c=>c.missing))return {visible:true,enabled:false,reason:'selection'};
 const targeted=location==='clip-menu'||['single','multiple'].includes(condition)||!!lanes;
 if(targeted&&action.permissions.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p))){
  if(!count)return {visible:true,enabled:false,reason:'selection'};
  if(selection.some(c=>c.gap||(c.linked?(!action.permissions.includes('clips.linked')||!c.linkedSupported):(c.lane==='video'?!action.permissions.some(p=>['timeline.reorder','timeline.edit'].includes(p)):!action.permissions.includes('clips.write')||!['overlay','audio','text','effect'].includes(c.lane)))))return {visible:true,enabled:false,reason:'unsupported'};
  if(selection.some(c=>c.locked))return {visible:true,enabled:false,reason:'locked'};
 }
 return {visible:true,enabled:true};
}
