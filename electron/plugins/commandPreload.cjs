// Only the trusted command page sees this bridge. Plugin code executes in a Worker.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('commandHost',{
 log:(token,value)=>ipcRenderer.invoke('pluginRuntime:log',token,value),
 job:()=>ipcRenderer.invoke('pluginRuntime:job',process.sandboxed===true),
 call:(token,method,args)=>ipcRenderer.invoke('pluginRuntime:call',token,method,args),
 finish:(token,result)=>ipcRenderer.invoke('pluginRuntime:finish',token,result),
});
