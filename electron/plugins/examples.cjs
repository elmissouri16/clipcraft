// Development-only bootstrap. Examples still pass through normal package validation.
const fs = require('node:fs/promises');
const path = require('node:path');
const {readFolder, validateFiles} = require('./package.cjs');
async function loadExamplePlugins(manager, directory, report = message => console.warn(message)) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') report(`[plugins] Could not read examples: ${error.message}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try {
      const folder = path.join(directory, entry.name);
      const {key, manifest} = await validateFiles(await readFolder(folder), manager.appVersion);
      if (manifest.legacyExecutable) {
        report(`[plugins] Example ${entry.name}: retired executable; use its Node source under examples/extensions.`);
        continue;
      }
      const rows = await manager.list();
      const existing = rows.find(row => row.key === key && !row.removing && !row.error);
      if (existing) {
        if (!existing.enabled && !existing.recovered) await manager.setEnabled(key, true);
        continue;
      }
      // A developer can have a customized copy of the same example release installed.
      if (rows.some(row => row.manifest?.id === manifest.id && row.manifest.publisher === manifest.publisher &&
          row.manifest.version === manifest.version && !!row.manifest.main === !!manifest.main)) continue;
      await manager.install(folder, true, {bootstrap:true});
    }
    catch (error) { report(`[plugins] Example ${entry.name}: ${error.message}`); }
  }
}
module.exports = { loadExamplePlugins };
