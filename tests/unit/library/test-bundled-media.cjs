const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {PluginManager} = require('../../../electron/plugins/manager.cjs');
const {installBundledMedia} = require('../../../electron/plugins/bundledMedia.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-bundled-source-upgrades-'));
  const packages = path.join(root,'packages');
  await fs.cp(path.resolve(__dirname,'../../../electron/bundled-media'),packages,{recursive:true});
  const manager = new PluginManager(path.join(root,'plugins'),'2.0.0');
  const trusted = new Set(), warnings = [];
  manager.extensions = {trust:async key => {await manager.commandBundle(key); trusted.add(key);}};
  const refresh = () => installBundledMedia(manager, packages, message => warnings.push(message));
  const row = async name => (await manager.list()).find(entry => entry.manifest.name === name && entry.enabled);
  const bump = async name => {
    const file = path.join(packages,name,'plugin.json'), manifest = JSON.parse(await fs.readFile(file));
    manifest.version = '1.1.0';await fs.writeFile(file,JSON.stringify(manifest));
  };
  await refresh();
  assert.equal(trusted.size,4);
  const pixabay = await row('Pixabay'), openverse = await row('Openverse'), myinstants = await row('MyInstants');
  await manager.setEnabled(pixabay.key,false);
  await manager.remove(myinstants.key);
  await fs.appendFile(path.join(packages,'openverse','dist/extension.cjs'),'\n// Changed without a version bump\n');
  await bump('pixabay');await bump('soundza');await bump('myinstants');
  await refresh();
  assert.ok(warnings.some(w => w.includes('openverse') && w.includes('different content')));
  assert.equal((await row('Openverse')).key,openverse.key);
  assert.equal((await row('Soundza')).manifest.version,'1.1.0');
  assert.ok((await manager.list()).some(entry => entry.manifest.name === 'Pixabay' && entry.manifest.version === '1.1.0' && !entry.enabled));
  assert.equal(await row('Pixabay'),undefined);
  assert.ok(!(await manager.list()).some(entry => entry.manifest.name === 'MyInstants'));
  assert.ok(Array.isArray(await manager.effects()));
  await bump('openverse');await refresh();
  assert.equal((await row('Openverse')).manifest.version,'1.1.0');
  console.log('Bundled media upgrades preserve disabled and removed choices and isolate a conflicting package.');
})().catch(error=>{console.error(error);process.exitCode=1;});
