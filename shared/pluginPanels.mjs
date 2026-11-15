// First panel slice: one fixed, local UTF-8 document bundle per package.
export const PANEL_FILES=Object.freeze({'panel.html':64*1024,'panel.js':64*1024,'panel.css':32*1024});
export const PANEL_THEME_KEYS=['background','surface','text','muted','accent','border'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Invalid panel fields.');};
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export function validatePanel(value){
 keys(value,['id','name','entry','script','style','permissions','commands']);
 if(typeof value.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)||!text(value.name,160)||!value.name.trim()||value.entry!=='panel.html'||(value.script!==undefined&&value.script!=='panel.js')||(value.style!==undefined&&value.style!=='panel.css'))throw Error('Invalid panel identity or fixed entry files.');
 const permissions=value.permissions??[];
 if(!Array.isArray(permissions)||permissions.length>3||new Set(permissions).size!==permissions.length||permissions.some(p=>!['project.read','storage.local','editor.read'].includes(p)))throw Error('Panels support project.read, editor.read and storage.local permissions.');
 const commands=value.commands;
 if(commands!==undefined&&(!Array.isArray(commands)||commands.length>8||new Set(commands).size!==commands.length||commands.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(id))))throw Error('Invalid panel command allowlist.');
 return {...(commands?.length?{commands:[...commands]}:{}),id:value.id,name:value.name,entry:'panel.html',...(value.script?{script:value.script}:{}),...(value.style?{style:value.style}:{}),permissions:[...permissions]};
}
export function panelSummary(value){
 keys(value,['name','duration_sec','fps','width','height','counts','markers']);
 if(!text(value.name,160)||!Number.isFinite(value.duration_sec)||value.duration_sec<0||value.duration_sec>1e9||!Number.isFinite(value.fps)||value.fps<=0||value.fps>1000||!['width','height'].every(k=>Number.isInteger(value[k])&&value[k]>0&&value[k]<=16384))throw Error('Invalid panel project summary.');
 const names=['video','overlay','audio','text','effect','media','markers'];keys(value.counts,names);
 if(!names.every(k=>Number.isInteger(value.counts[k])&&value.counts[k]>=0&&value.counts[k]<=1e6)||!Array.isArray(value.markers)||value.markers.length>1000||value.markers.length>value.counts.markers)throw Error('Invalid panel counts or markers.');
 const markers=value.markers.map(m=>{keys(m,['time','label']);if(!Number.isFinite(m.time)||m.time<0||m.time>value.duration_sec||!text(m.label,80))throw Error('Invalid panel marker.');return {time:m.time,label:m.label};});
 return {name:value.name,duration_sec:value.duration_sec,fps:value.fps,width:value.width,height:value.height,counts:{...value.counts},markers};
}
export function panelTheme(value){
 keys(value,PANEL_THEME_KEYS);
 if(!PANEL_THEME_KEYS.every(k=>typeof value[k]==='string'&&value[k].length<=80&&/^(#[a-fA-F0-9]{3,8}|rgba?\([0-9.,% /]+\))$/.test(value[k])))throw Error('Invalid panel theme.');
 return {...value};
}
