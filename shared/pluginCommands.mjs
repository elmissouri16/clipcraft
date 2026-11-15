// Public command schemas and the bounded editor mutation contract. No platform imports.
export const COMMAND_CODE_LIMIT=64*1024;
export const COMMAND_PERMISSIONS=['clips.linked','timeline.edit','timeline.reorder','clips.write','editor.read','project.read','markers.write','captions.read','ai.chapters','captions.write','ai.translateCaptions','export.gif'];
export const COMMAND_PERMISSION_LABELS={'clips.linked':'plugins.permission_clips_linked','timeline.edit':'plugins.permission_timeline_edit','timeline.reorder':'plugins.permission_timeline_reorder','clips.write':'plugins.permission_clips_write','editor.read':'plugins.permission_editor_read','project.read':'plugins.permission_project_read','markers.write':'plugins.permission_markers_write','captions.read':'plugins.permission_captions_read','ai.chapters':'plugins.permission_ai_chapters','captions.write':'plugins.permission_captions_write','ai.translateCaptions':'plugins.permission_ai_translate','export.gif':'plugins.permission_export_gif'};
export const MAX_COMMAND_MARKERS=500;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>{if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('Invalid command fields.');};
const local=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
export function validateCommand(value){
  keys(value,['id','name','description','parameters']);
  if(!local(value.id)||!text(value.name,160)||!value.name.trim()||(value.description!==undefined&&!text(value.description,1000)))throw Error('Invalid command ID, name or description.');
  const parameters=value.parameters??[];
  if(!Array.isArray(parameters)||parameters.length>8)throw Error('Commands support up to eight parameters.');
  const ids=new Set();
  const validated=parameters.map(p=>{
    keys(p,p?.type==='enum'?['id','name','type','options','default']:['id','name','min','max','step','default','integer']);
    if(typeof p.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(p.id)||ids.has(p.id)||!text(p.name,160)||!p.name.trim())throw Error('Invalid command parameter.');ids.add(p.id);
    if(p.type==='enum'){
      if(!Array.isArray(p.options)||!p.options.length||p.options.length>32)throw Error('Enum parameters need 1–32 options.');
      const values=new Set();
      const options=p.options.map(o=>{keys(o,['value','label']);if(!local(o.value)||values.has(o.value)||!text(o.label,160)||!o.label.trim())throw Error('Invalid enum option.');values.add(o.value);return {...o};});
      if(!values.has(p.default))throw Error('Invalid enum default.');
      return {id:p.id,name:p.name,type:'enum',options,default:p.default};
    }
    if(!['min','max','step','default'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1e6)||p.min>=p.max||p.step<=0||p.step>p.max-p.min||p.default<p.min||p.default>p.max)throw Error('Invalid command parameter bounds.');
    if(p.integer!==undefined&&typeof p.integer!=='boolean')throw Error('Invalid integer constraint.');
    if(p.integer&&!['min','max','step','default'].every(k=>Number.isInteger(p[k])))throw Error('Integer parameter bounds must be integers.');
    return {...p};
  });
  return {id:value.id,name:value.name,description:value.description||'',parameters:validated};
}
export function commandInput(command,input={}){
  if(!object(input)||Object.keys(input).some(k=>!command.parameters.some(p=>p.id===k)))throw Error('Unknown command input.');
  const out={};for(const p of command.parameters){const value=Object.hasOwn(input,p.id)?input[p.id]:p.default;
    if(p.type==='enum'){if(typeof value!=='string'||!p.options.some(o=>o.value===value))throw Error(`Invalid parameter ${p.name}.`);out[p.id]=value;continue;}
    if(!Number.isFinite(value)||value<p.min||value>p.max||(p.integer&&!Number.isInteger(value)))throw Error(`Invalid parameter ${p.name}.`);out[p.id]=value;}
  return out;
}
export function commandSnapshot(value){
  keys(value,['duration_sec','fps','markers','markers_total']);
  if(!Number.isFinite(value.duration_sec)||value.duration_sec<=0||value.duration_sec>1e9||!Number.isFinite(value.fps)||value.fps<=0||value.fps>1000||!Array.isArray(value.markers)||value.markers.length>1000||!Number.isInteger(value.markers_total)||value.markers_total<value.markers.length)throw Error('Invalid command project summary.');
  const markers=value.markers.map(m=>{keys(m,['time','label']);if(!Number.isFinite(m.time)||m.time<0||!text(m.label,80))throw Error('Invalid summary marker.');return {time:m.time,label:m.label};});
  return {duration_sec:value.duration_sec,fps:value.fps,markers,markers_total:value.markers_total};
}
export function commandMarkers(value,duration){
  if(!Array.isArray(value)||value.length>MAX_COMMAND_MARKERS)throw Error('Commands may propose at most 500 markers.');
  return value.map(m=>{keys(m,['time','label']);if(!Number.isFinite(m.time)||m.time<0||m.time>duration||!text(m.label,80))throw Error('Invalid proposed marker.');return {time:m.time,label:m.label};});
}
export function uniqueCommandMarkers(project,proposals,duration){
  const validated=commandMarkers(proposals,duration),fps=project.fps||30;
  const seen=new Set((project.markers||[]).map(m=>Math.round(m.time*fps)));
  return validated.filter(m=>{const frame=Math.round(m.time*fps);if(seen.has(frame))return false;seen.add(frame);return true;});
}
