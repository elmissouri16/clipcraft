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
    try { await manager.install(path.join(directory, entry.name), true); }
    catch (error) { report(`[plugins] Example ${entry.name}: ${error.message}`); }
  }
}
module.exports = { loadExamplePlugins };
