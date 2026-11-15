const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('frameInspection',{
 load:()=>ipcRenderer.invoke('pluginGif:frameJob'),
 ready:(error,sequence)=>ipcRenderer.invoke('pluginGif:frameReady',error,sequence),
 onFrame:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('pluginGif:frame',listener);return()=>ipcRenderer.removeListener('pluginGif:frame',listener);},
});
contextBridge.exposeInMainWorld('api',{
 fontsList:()=>ipcRenderer.invoke('fonts:list'),fontData:id=>ipcRenderer.invoke('fonts:data',id),readLut:file=>ipcRenderer.invoke('lut:read',file),
});
