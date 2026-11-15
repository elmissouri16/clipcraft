const {contextBridge,ipcRenderer}=require('electron');
const editorListeners=new Set(),projectListeners=new Set(),themeListeners=new Set(),progressListeners=new Set();
let gesture=0;
window.addEventListener('click',event=>{if(event.isTrusted)gesture=performance.now()+1500;},true);
const boot=ipcRenderer.invoke('pluginPanel:boot',process.sandboxed===true);
boot.catch(()=>{});
const invoke=(method,args=null)=>boot.then(job=>ipcRenderer.invoke('pluginPanel:call',job.token,method,args));
const storageCall=(method,args={})=>invoke('storage.'+method,args).then(result=>{if(!result.ok)throw Error(result.error);return result.value;});
const applyTheme=theme=>{for(const [key,value] of Object.entries(theme))document.documentElement?.style.setProperty(`--cc-${key}`,value);};
const subscribe=(listeners,callback)=>{if(typeof callback!=='function'||listeners.size>=16)throw Error('Panel subscription limit exceeded.');listeners.add(callback);return()=>listeners.delete(callback);};
ipcRenderer.on('pluginPanel:pulse',(_event,sequence)=>{boot.then(job=>ipcRenderer.invoke('pluginPanel:beat',job.token,sequence)).catch(()=>{});});
ipcRenderer.on('pluginPanel:update',(_event,value)=>{
 if(value.theme){applyTheme(value.theme);for(const fn of themeListeners){try{fn(value.theme);}catch{}}}
 if(value.editor)for(const fn of editorListeners){try{fn(structuredClone(value.editor));}catch{}}
 if(value.summary)for(const fn of projectListeners){try{fn(value.summary);}catch{}}
});
ipcRenderer.on('pluginPanel:progress',(_event,value)=>{for(const fn of progressListeners){try{fn(value);}catch{}}});
window.addEventListener('DOMContentLoaded',()=>boot.then(job=>applyTheme(job.info.theme)).catch(()=>{}),{once:true});
window.addEventListener('error',event=>invoke('failure',String(event.message||'Panel failed.').slice(0,1000)).catch(()=>{}));
window.addEventListener('unhandledrejection',()=>invoke('failure','Panel operation failed.').catch(()=>{}));
window.addEventListener('keydown',event=>{
 if(!event.isTrusted)return;
 if(event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();invoke('escape').catch(()=>{});return;}
 if(event.key==='Tab'){
  const elements=[...document.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
  const at=document.activeElement;
  if(!elements.length||(event.shiftKey?at===elements[0]||at===document.body:at===elements.at(-1))){event.preventDefault();event.stopImmediatePropagation();invoke('focus.exit',event.shiftKey?'backward':'forward').catch(()=>{});}
 }
},true);
contextBridge.exposeInMainWorld('clipcraftPanel',{
 commands:{run:(commandId,input={})=>{const allowed=gesture>performance.now();gesture=0;if(!allowed)return Promise.reject(Error('Click a panel control to run a command.'));return invoke('commands.run',{commandId,input});},cancel:()=>invoke('commands.cancel'),onProgress:callback=>subscribe(progressListeners,callback)},
 storage:{get:key=>storageCall('get',{key}),set:(key,value)=>storageCall('set',{key,value}),remove:key=>storageCall('remove',{key}),keys:()=>storageCall('keys'),clear:()=>storageCall('clear')},
 getInfo:()=>boot.then(job=>job.info),
 editor:{read:()=>invoke('editor.read'),onChanged:callback=>subscribe(editorListeners,callback)},
 project:{read:()=>invoke('project.read'),onChanged:callback=>subscribe(projectListeners,callback)},
 theme:{onChanged:callback=>subscribe(themeListeners,callback)},
});
