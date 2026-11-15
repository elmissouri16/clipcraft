import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PluginManager}=require('../../../electron/plugins/manager.cjs'),{DevelopmentSessions}=require('../../../electron/plugins/development.cjs'),{installCommandIpcGuard,markCommandSender,markPanelSender}=require('../../../electron/plugins/ipcGuard.cjs');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-action-catalog-'));
try{
 const folder=path.join(root,'source');await fs.mkdir(folder);
 const manifest={id:'studio.actions',name:'Action package',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',contributes:{commands:[{id:'run',name:'Run',parameters:[]}],actions:[{id:'run-action',commandId:'run',label:'Run from menu',locations:['plugins-menu']}]}};
 const write=()=>fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(manifest));await write();await fs.writeFile(path.join(folder,'commands.js'),'throw Error("Catalog reads must never execute this file");');
 const manager=new PluginManager(path.join(root,'installed'),'2.0.0');let rows=await manager.install(folder,true),key=rows[0].key;
 check('normal install exposes inert canonical registrations',()=>assert.equal(rows[0].manifest.contributes.actions[0].id,'run-action'));
 let catalog=await manager.actions();check('catalog identities include the exact enabled package and command',()=>{assert.equal(catalog.items[0].key,key);assert.equal(catalog.items[0].command.id,'run');assert.equal(catalog.items[0].code,undefined);});
 await manager.setEnabled(key,false);catalog=await manager.actions();check('disabled versions leave no registration',()=>assert.equal(catalog.total,0));
 await manager.setEnabled(key,true);manifest.version='1.1.0';manifest.contributes.actions[0].label='New registration';await write();rows=await manager.install(folder,true);const next=rows.find(r=>r.enabled).key;
 catalog=await manager.actions();check('upgrades register only the current version once',()=>{assert.equal(catalog.total,1);assert.equal(catalog.items[0].key,next);assert.equal(catalog.items[0].label,'New registration');});
 let events=0;const development=new DevelopmentSessions(manager,{onCatalog:()=>events++});manager.development=development;
 await development.start(folder);catalog=await manager.actions();check('development registration is separate and explicitly marked',()=>{assert.equal(catalog.total,2);assert.equal(catalog.items.filter(a=>a.development).length,1);assert.notEqual(catalog.items.find(a=>a.development).key,next);});
 const previous=catalog.items.find(a=>a.development).key;manifest.contributes.actions[0].label='Reloaded action';await write();assert.equal((await manager.actions()).items.find(a=>a.development).label,'New registration');checks++;
 await development.reload();catalog=await manager.actions();check('reload replaces its registration generation without duplicating installed entries',()=>{assert.notEqual(catalog.items.find(a=>a.development).key,previous);assert.equal(catalog.items.find(a=>a.development).label,'Reloaded action');assert.equal(catalog.items.filter(a=>!a.development).length,1);});
 manifest.contributes.actions[0].commandId='missing';await write();await development.reload();check('failed development output has no live actions',()=>assert.equal((development.snapshot().session.status),'failed'));assert.equal((await manager.actions()).items.some(a=>a.development),false);checks++;
 manifest.contributes.actions[0].commandId='run';await write();await development.reload();await development.end();catalog=await manager.actions();check('End removes development registrations and leaves installed registrations intact',()=>{assert.equal(catalog.total,1);assert.equal(catalog.items[0].key,next);});
 await fs.appendFile(path.join(manager.root,next,'commands.js'),'// tampered');catalog=await manager.actions();check('tampered packages disappear from the verified catalog',()=>{assert.ok(events>=4);assert.equal(catalog.total,0);});
 await manager.remove(next);assert.equal((await manager.actions()).total,0);checks++;
 development.dispose();
 for(const mark of [markCommandSender,markPanelSender]){
  const handlers=new Map(),ipc={handle:(name,fn)=>handlers.set(name,fn),emit(){}};installCommandIpcGuard(ipc);const sender={};mark(sender);ipc.handle('plugins:actions',()=>{throw Error('Privileged registry must not run');});check('sandboxed workers/panels cannot access the UI registry',()=>assert.throws(()=>handlers.get('plugins:actions')({sender}),/sandbox/i));
 }
 console.log(JSON.stringify({ok:true,checks}));
}finally{await fs.rm(root,{recursive:true,force:true});}
