// Install before other IPC registrations. All legacy IPC remains inaccessible to command windows.
const panelSenders=new WeakSet(),commandSenders=new WeakSet(),installed=new WeakSet();
const PANEL_CHANNELS=new Set(['pluginPanel:boot','pluginPanel:call','pluginPanel:beat']);
const RUNTIME_CHANNELS=new Set(['pluginRuntime:job','pluginRuntime:call','pluginRuntime:finish','pluginRuntime:log']);
const isCommandSender=sender=>!!sender&&typeof sender==='object'&&commandSenders.has(sender);
function installCommandIpcGuard(ipcMain){
 if(installed.has(ipcMain))return;installed.add(ipcMain);
 for(const method of ['handle','handleOnce'])if(typeof ipcMain[method]==='function'){
  const original=ipcMain[method];ipcMain[method]=function(channel,handler){return original.call(this,channel,function(event,...args){
   if(isCommandSender(event?.sender)&&!RUNTIME_CHANNELS.has(channel))throw Error('Command sandbox cannot access application IPC.');
   if(panelSenders.has(event?.sender)&&!PANEL_CHANNELS.has(channel))throw Error('Panel sandbox cannot access application IPC.');
   return handler(event,...args);
  });};
 }
 // Event IPC uses the emitter; intercepting dispatch preserves existing listener removal/once behavior.
 const emit=ipcMain.emit;ipcMain.emit=function(channel,event,...args){
  if(isCommandSender(event?.sender)||panelSenders.has(event?.sender))return false; // runtime protocol uses invoke only
  return emit.call(this,channel,event,...args);
 };
}
module.exports={markPanelSender:sender=>panelSenders.add(sender),installCommandIpcGuard,markCommandSender:sender=>commandSenders.add(sender),isCommandSender};
