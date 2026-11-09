// Bridge for the motion graphics sandbox (sandbox.html). The page gets three calls and nothing else:
// fetch its job (once, with a token), hand back a frame's pixels (null: same as the last frame) and
// report the end with its timings. Everything after the job needs the token.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graphicsHost', {
  job: () => ipcRenderer.invoke('graphics:job'),
  frame: (token, index, pixels) => ipcRenderer.invoke('graphics:frame', token, index, pixels),
  done: (token, error, stats) => ipcRenderer.invoke('graphics:done', token, error ? String(error).slice(0, 2000) : null, stats || null),
  liveReady: (token, error) => ipcRenderer.invoke('graphics:liveReady', token, error ? String(error).slice(0, 2000) : null),
  liveResult: (token, index, result) => ipcRenderer.invoke('graphics:liveResult', token, index, result),
  onLiveRequest: (callback) => ipcRenderer.on('graphics:liveRequest', (_event, request) => callback(request)),
});
