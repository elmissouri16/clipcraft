// Development-only bootstrap. Examples still pass through normal package validation.
const fs = require('node:fs/promises');
const path = require('node:path');
async function loadExamplePlugins(manager, directory, report = message => console.warn(message)) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') report(`[plugins] Could not read examples: ${error.message}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try { const folder=path.join(directory,entry.name),{readFolder,validateFiles}=require('./package.cjs'),bundle=await validateFiles(await readFolder(folder),manager.appVersion);if(bundle.manifest.legacyExecutable){report(`[plugins] Example ${entry.name}: retired executable; use its Node source under examples/extensions.`);continue;}const existing=(await manager.list()).find(row=>row.key===bundle.key&&!row.removing&&!row.error);if(existing){if(!existing.enabled&&!existing.recovered)await manager.setEnabled(existing.key,true);continue;}await manager.install(folder,true,{bootstrap:true}); }
    catch (error) { report(`[plugins] Example ${entry.name}: ${error.message}`); }
  }
}
module.exports = { loadExamplePlugins };
