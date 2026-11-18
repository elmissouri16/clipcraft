const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('frameInspection',{
  load:()=>ipcRenderer.invoke('agent:frameJob'),
  ready:error=>ipcRenderer.invoke('agent:frameReady',error),
});
// Only the read capabilities needed by the shared preview renderer.
contextBridge.exposeInMainWorld('api',{
  fontsList:()=>ipcRenderer.invoke('fonts:list'),
  fontData:(id,face)=>ipcRenderer.invoke('fonts:data',id,face),
  readLut:ref=>ipcRenderer.invoke('lut:read',ref),
});
