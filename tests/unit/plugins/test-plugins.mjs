import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
import {pluginPresetPatch,storedExportSettings,resolveExport,settingsPatch} from '../../../src/features/export/exportQuality.js';
const require=createRequire(import.meta.url),{PluginManager}=require('../../../electron/plugins/manager.cjs'),tar=require('tar');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-plugin-unit-'));
const sample=JSON.parse(await fs.readFile(new URL('../../../examples/plugins/review-copy/plugin.json',import.meta.url)));
delete sample.icon; // These minimal admission/render fixtures intentionally contain no artwork.
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};
try {
 await check('manifest permits data-only presets',()=>assert.equal(validateManifest(sample).id,sample.id));
 for(const [name,change] of [
  ['entrypoint',p=>p.main='index.js'],['permissions',p=>p.permissions=['network']],['future API',p=>p.apiVersion=2],
  ['version',p=>p.version='../x'],['minimum version',p=>p.minClipcraftVersion='9.0.0'],['core namespace',p=>p.id='core'],
  ['unknown contribution',p=>p.contributes.widgets=[]],['duplicate ID',p=>p.contributes.exportPresets.push(p.contributes.exportPresets[0])],
  ['raw arguments',p=>p.contributes.exportPresets[0].settings.args='-evil'],['unsupported setting',p=>p.contributes.exportPresets[0].settings.codec='evil'],
  ['nonfinite number',p=>p.contributes.exportPresets[0].settings.bitrateMbps=Infinity],['prototype field',p=>Object.defineProperty(p,'__proto__',{value:{},enumerable:true})],
 ]) {const p=structuredClone(sample);change(p);await check(`rejects ${name}`,()=>assert.throws(()=>validateManifest(p)));}
 const folder=path.join(root,'source');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(sample));
 let manager=new PluginManager(path.join(root,'installed'),'2.0.0');
 let rows=await manager.install(folder,true),key=rows[0].key;
 await check('folder installs immutable snapshot',()=>assert.equal(rows[0].enabled,true));
 const preset=(await manager.presets())[0];
 const project={width:1920,height:1080,fps:24,...pluginPresetPatch({},preset)};
 const effective=resolveExport(project);
 await check('preset resolves through existing settings and cap',()=>assert.equal(effective.outW,720));
 await check('preset keeps project frame rate',()=>assert.equal(effective.outFps,24));
 const archived=JSON.parse(JSON.stringify(project));
 await manager.setEnabled(key,false);
 await check('disabled plugin stops contributing',async()=>assert.equal((await manager.presets()).length,0));
 await check('saved export is independent of registry',()=>assert.deepEqual(resolveExport(archived),effective));
 manager=new PluginManager(path.join(root,'installed'),'2.0.0');
 await check('restart retains inventory',async()=>assert.equal((await manager.list()).length,1));
 const custom=settingsPatch(project,{preset:'custom',custom:{...storedExportSettings(project).custom,crf:25}});
 await check('manual edits detach provenance',()=>assert.equal(custom.exportSettings.pluginPreset,undefined));
 await fs.writeFile(path.join(folder,'evil.js'),'throw Error()');
 await assert.rejects(manager.install(folder,true),/only plugin.json/);checks++;
 await fs.rm(path.join(folder,'evil.js'));
 const archive=path.join(root,'valid.tgz');await tar.c({file:archive,gzip:true,cwd:folder},['plugin.json']);
 await manager.install(archive);checks++;
 const changed=structuredClone(sample);changed.name='Changed';await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(changed));
 await assert.rejects(manager.install(folder,true),/different content/);checks++;
 changed.version='1.1.0';await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(changed));
 rows=await manager.install(folder,true);
 await check('update retains previous version',()=>assert.equal(rows.length,2));
 await check('update activates one version',()=>assert.equal(rows.filter(x=>x.enabled).length,1));
 await manager.setEnabled(key,true);
 await check('rollback activates original',async()=>assert.equal((await manager.presets())[0].digest,key));
 await fs.writeFile(path.join(folder,'evil.js'),'bad');
 const bad=path.join(root,'bad.tgz');await tar.c({file:bad,gzip:true,cwd:folder},['plugin.json','evil.js']);
 await assert.rejects(manager.install(bad),/only one/);checks++;
 const duplicates=path.join(root,'duplicates.tgz');await tar.c({file:duplicates,gzip:true,cwd:folder},['plugin.json','plugin.json']);
 await assert.rejects(manager.install(duplicates),/only one/);checks++;
 const link=path.join(root,'links');await fs.mkdir(link);await fs.symlink(path.join(folder,'plugin.json'),path.join(link,'plugin.json'));
 await assert.rejects(manager.install(link,true),/regular file/);checks++;
 const links=path.join(root,'links.tgz');await tar.c({file:links,gzip:true,cwd:link},['plugin.json']);
 await assert.rejects(manager.install(links),/only one/);checks++;
 for (const prefix of ['../escape','/absolute']) {
  const badPath=path.join(root,prefix.startsWith('/')?'absolute.tgz':'traversal.tgz');
  await tar.c({file:badPath,gzip:true,cwd:folder,prefix},['plugin.json']);
  await assert.rejects(manager.install(badPath),/only one/);checks++;
 }
 const bomb=path.join(root,'bomb.tgz');await fs.writeFile(path.join(folder,'huge'),Buffer.alloc(600*1024));
 await tar.c({file:bomb,gzip:true,cwd:folder},['huge']);await assert.rejects(manager.install(bomb),/larger|length|size/i);checks++;
 await fs.rm(path.join(folder,'huge'));
 const examples=path.join(root,'examples');await fs.mkdir(examples);
 await fs.mkdir(path.join(examples,'valid'));await fs.writeFile(path.join(examples,'valid','plugin.json'),JSON.stringify(sample));
 await fs.mkdir(path.join(examples,'invalid'));await fs.writeFile(path.join(examples,'invalid','plugin.json'),'{}');
 const developer=new PluginManager(path.join(root,'developer'),'2.0.0'),reports=[];
 const {loadExamplePlugins}=require('../../../electron/plugins/examples.cjs');
 await loadExamplePlugins(developer,examples,message=>reports.push(message));
 assert.equal((await developer.presets()).length,1);assert.equal(reports.length,1);checks++;
 const exampleKey=(await developer.list())[0].key;await developer.setEnabled(exampleKey,false);
 await loadExamplePlugins(developer,examples,()=>{});
 assert.equal((await developer.list()).length,1);assert.equal((await developer.presets()).length,1);checks++;
 const ipc={on(){},handlers:new Map(),handle(name,fn){this.handlers.set(name,fn);}};
 const frame={},sender={mainFrame:frame};
 require('../../../electron/plugins/ipc.cjs').registerPlugins({ipcMain:ipc,app:{getVersion:()=> '2.0.0'},dialog:{},getWindow:()=>({webContents:sender}),root:path.join(root,'ipc')});
 await assert.rejects(ipc.handlers.get('plugins:list')({sender:{},senderFrame:frame}),/only available/);checks++;
 await assert.rejects(ipc.handlers.get('plugins:list')({sender,senderFrame:{}}),/only available/);checks++;
 assert.deepEqual(await ipc.handlers.get('plugins:list')({sender,senderFrame:frame}),[]);checks++;
 const malformed=path.join(root,'invalid.tgz');await fs.writeFile(malformed,'invalid archive');
 await assert.rejects(manager.install(malformed));checks++;
 await fs.writeFile(path.join(root,'installed',key,'plugin.json'),'{}');
 assert.ok((await manager.list()).find(x=>x.key===key).error);checks++;
 await manager.remove(key);
 await check('removal keeps project output',()=>assert.deepEqual(resolveExport(archived),effective));
 assert.ok(!(await fs.readdir(path.join(root,'installed'))).some(x=>x.startsWith('.install-')));checks++;
 console.log(JSON.stringify({checks,ok:true}));
} finally {await fs.rm(root,{recursive:true,force:true});}
