// Install only packages shipped inside this application. User-installed packages use normal trust.
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {readFolder, validateFiles} = require('./package.cjs');

async function installBundledMedia(manager, directory, report = message => console.warn(message)) {
  const receipt = path.join(manager.root, '.bundled-media.json');
  let installed = {};
  try { installed = JSON.parse(await fs.readFile(receipt, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') { report('[plugins] Cannot read bundled media receipts: ' + error.message); return; }
  }
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) { report('[plugins] Invalid bundled media receipts.'); return; }
  manager.bundledMediaKeys = new Map();
  for (const vendor of ['openverse', 'pixabay', 'soundza', 'myinstants']) {
    try { await install(vendor); }
    catch (error) { report('[plugins] Bundled source ' + vendor + ': ' + error.message); }
  }

  async function install(vendor) {
    const folder = path.join(directory, vendor);
    const {key, manifest} = await validateFiles(await readFolder(folder), manager.appVersion);
    if (manifest.id !== 'clipcraft.' + vendor || manifest.publisher !== 'ClipCraft') throw Error('Invalid bundled media package.');
    manager.bundledMediaKeys.set(key, vendor);
    if (installed[vendor] === key) return;
    const rows = await manager.list();
    const previous = rows.find(row => row.key === installed[vendor]);
    const existing = rows.find(row => row.key === key);
    // Keep a user's removal, recovery, or replacement across application updates.
    const other = rows.some(row => row.manifest?.id === manifest.id && row.key !== key && row.key !== previous?.key && row.enabled);
    if ((!installed[vendor] || previous && !previous.recovered && !previous.removing) && !other && !existing?.recovered && !existing?.removing) {
      if (!existing) await manager.install(folder, true, {requiredKey:key});
      if (!existing || existing.enabled) await manager.extensions.trust(key);
      if (!existing && previous && !previous.enabled) await manager.setEnabled(key, false);
    }
    installed[vendor] = key;
    const tmp = receipt + '.' + randomUUID();
    await fs.writeFile(tmp, JSON.stringify(installed), {mode:0o600});
    await fs.rename(tmp, receipt);
  }
}
async function prepareBundledKey(manager, {key, manifest, storage}) {
  const vendor = manager.bundledMediaKeys?.get(key);
  if (!vendor) return;
  await require('../system/settings.cjs').transferMediaKey(vendor, async encrypted => {
    const ownerFile = path.join(storage, 'owner.json');
    try {
      if (JSON.parse(await fs.readFile(ownerFile, 'utf8')).publisher !== manifest.publisher) return false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.writeFile(ownerFile, JSON.stringify({publisher:manifest.publisher}), {flag:'wx',mode:0o600});
    }
    const file = path.join(storage, 'secrets.json');
    let secrets = {};
    try { secrets = JSON.parse(await fs.readFile(file,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!secrets.apiKey) {
      const temp = file + '.' + randomUUID();
      await fs.writeFile(temp, JSON.stringify({...secrets, apiKey:encrypted}), {mode:0o600});
      await fs.rename(temp, file);
    }
    return true;
  });
}
module.exports = {installBundledMedia, prepareBundledKey};
