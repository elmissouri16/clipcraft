// Install before other IPC registrations. Sandboxed extension views have only their message bridge.
const extensionViewSenders=new WeakSet(),installed=new WeakSet();
function installExtensionViewIpcGuard(ipcMain){
 if(installed.has(ipcMain))return;installed.add(ipcMain);
 for(const method of ['handle','handleOnce'])if(typeof ipcMain[method]==='function'){
  const original=ipcMain[method];ipcMain[method]=function(channel,handler){return original.call(this,channel,function(event,...args){
   if(extensionViewSenders.has(event?.sender)&&!['extensionView:boot','extensionView:call'].includes(channel))throw Error('Extension view cannot access application IPC');
   return handler(event,...args);
  });};
 }
 // Event IPC uses the emitter; intercepting dispatch preserves existing listener removal/once behavior.
 const emit=ipcMain.emit;ipcMain.emit=function(channel,event,...args){
  if(extensionViewSenders.has(event?.sender))return false; // runtime protocol uses invoke only
  return emit.call(this,channel,event,...args);
 };
}
module.exports={markExtensionViewSender:sender=>extensionViewSenders.add(sender),installExtensionViewIpcGuard};
