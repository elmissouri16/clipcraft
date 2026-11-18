const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async win=>{
 for(const name of ['commandRuntime.cjs','panelRuntime.cjs','providerGate.cjs','chapterService.cjs','localTools.cjs'])assert.equal(fs.existsSync(path.join(__dirname,'../../electron/plugins',name)),false,'retired runtime module '+name);
 const retired=await win.webContents.executeJavaScript("['pluginsRunCommand','pluginsCancelCommand','pluginPanelOpen','pluginPanelClaimAction','pluginsTestAuthorProvider','pluginsLocalStatus'].every(name=>typeof window.api[name]==='undefined')&&typeof window.api.pluginsExtensionExecute==='function'");assert.ok(retired,'retired preload capabilities are absent and Node execution remains');return true;
};
