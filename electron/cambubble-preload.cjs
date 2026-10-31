// Bridge for the camera bubble (electron/cambubble.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cambubble', {
  set: (patch) => ipcRenderer.send('cambubble:set', patch),
  onConfig: (fn) => ipcRenderer.on('cambubble:config', (_e, c) => fn(c)),
});
