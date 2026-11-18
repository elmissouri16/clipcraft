const {contextBridge,ipcRenderer}=require('electron');
const listeners=new Set(),themeListeners=new Set();
let shortcuts=new Set();
const boot=ipcRenderer.invoke('extensionView:boot',process.sandboxed===true);boot.catch(()=>{});
const apply=theme=>{for(const [key,value] of Object.entries(theme))document.documentElement?.style.setProperty('--cc-'+key,value);};
const invoke=(method,input)=>boot.then(info=>ipcRenderer.invoke('extensionView:call',info.token,method,input));
const tabControls=backward=>{
 const controls=[...document.querySelectorAll('button,input,select,textarea,a[href],[contenteditable],[tabindex]')]
  .filter(el=>(el.tabIndex>=0||!el.hasAttribute('tabindex')&&el.isContentEditable&&!el.parentElement?.isContentEditable)&&!el.matches(':disabled')&&!el.closest('[inert]')&&el.getClientRects().length&&!['hidden','collapse'].includes(getComputedStyle(el).visibility));
 const groups=new Map(),skipped=new Set();
 for(const el of controls)if(el.tagName==='INPUT'&&el.type==='radio'&&el.name){const owner=el.form||el.getRootNode();let names=groups.get(owner);if(!names)groups.set(owner,names=new Map());let group=names.get(el.name);if(!group)names.set(el.name,group=[]);group.push(el);}
 for(const names of groups.values())for(const group of names.values()){
  const selected=group.find(el=>el===document.activeElement)||group.find(el=>el.checked)||(backward?group.at(-1):group[0]);
  for(const el of group)if(el!==selected)skipped.add(el);
 }
 // Positive indices precede ordinary controls; equal indices retain DOM order.
 const index=el=>el.tabIndex>0?el.tabIndex:Infinity;
 return controls.filter(el=>!skipped.has(el)).sort((a,b)=>index(a)-index(b));
};
ipcRenderer.on('extensionView:pulse',(_event,sequence)=>{invoke('beat',sequence).catch(()=>{});});
ipcRenderer.on('extensionView:message',(_event,message)=>{for(const callback of listeners)try{callback(structuredClone(message.value));}catch{}invoke('delivered',message.id).catch(()=>{});});
ipcRenderer.on('extensionView:theme',(_event,value)=>{apply(value);for(const callback of themeListeners)try{callback(value);}catch{}});
ipcRenderer.on('extensionView:shortcuts',(_event,value)=>{shortcuts=new Set(value);});
window.addEventListener('DOMContentLoaded',()=>boot.then(info=>apply(info.theme)).catch(()=>{}),{once:true});
window.addEventListener('keydown',event=>{
 if(!event.isTrusted)return;
 const typing=event.composedPath().some(node=>['INPUT','TEXTAREA','SELECT'].includes(node?.tagName)||node?.isContentEditable);
 const key=event.key===' '?'Space':event.key.length===1?event.key.toUpperCase():event.key;
 const combo=[(event.ctrlKey||process.platform==='darwin'&&event.metaKey)&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',key].filter(Boolean).join('+');
 if(!typing&&!event.repeat&&!event.isComposing&&shortcuts.has(combo)){event.preventDefault();event.stopImmediatePropagation();invoke('shortcut',combo).catch(()=>{});return;}
 if(event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();invoke('focus','backward').catch(()=>{});}
 if(event.key==='Tab'){const controls=tabControls(event.shiftKey);if(!controls.length||(event.shiftKey?document.activeElement===controls[0]||document.activeElement===document.body:document.activeElement===controls.at(-1))){event.preventDefault();invoke('focus',event.shiftKey?'backward':'forward').catch(()=>{});}}
},true);
const subscribe=(set,callback)=>{if(typeof callback!=='function'||set.size>=32)throw Error('View listener limit reached');set.add(callback);return ()=>set.delete(callback);};
contextBridge.exposeInMainWorld('clipcraftView',{
 getInfo:()=>boot.then(({token,...info})=>info),
 postMessage:value=>invoke('message',value),
 onMessage:callback=>subscribe(listeners,callback),
 onThemeChanged:callback=>subscribe(themeListeners,callback)
});
