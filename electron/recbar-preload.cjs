// Bridge for the floating recording bar (electron/recbar.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recbar', {
  stop: () => ipcRenderer.send('recbar:stop'),
  pause: () => ipcRenderer.send('recbar:pause'),
  collapse: (on) => ipcRenderer.send('recbar:collapse', on),
  onState: (fn) => ipcRenderer.on('recbar:state', (_e, s) => fn(s)),
  onCollapsed: (fn) => ipcRenderer.on('recbar:collapsed', (_e, on) => fn(on)),
});
