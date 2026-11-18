import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setPluginEffects,pluginEffectDefinition,pluginEffectInstance,refreshPluginEffects,assertPluginEffects} from '../../../src/features/plugins/effectRegistry.js';
import {setPluginTransitions,pluginTransitionInstance,pluginTransitionDefinition} from '../../../src/features/plugins/transitionRegistry.js';
const {PluginManager}=createRequire(import.meta.url)('../../../electron/plugins/manager.cjs');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-recovery-project-'));
try{
 const manager=new PluginManager(root,'2.0.0');await manager.install(path.resolve('examples/plugins/color-pulse'),true);await manager.install(path.resolve('examples/plugins/diagonal-reveal'),true);
 const effects=await manager.effects(),transitions=await manager.transitions();setPluginEffects(effects);setPluginTransitions(transitions);
 const effect=effects[0],transition=transitions[0],fx=`plugin:${effect.contributionId}@${effect.digest}`;
 // Use the canonical ID helper for the transition prefix.
 const {transitionId}=await import('../../../shared/pluginTransitions.mjs'),transitionKey=transitionId(transition);
 const project={effectClips:[{id:'fx',fx,strength:1,pluginEffect:pluginEffectInstance(fx)}],videoClips:[{id:'a'},{id:'b',transition:{type:transitionKey,duration:1,pluginTransition:pluginTransitionInstance(transitionKey)}}]};
 const before=JSON.stringify(project);assert.doesNotThrow(()=>assertPluginEffects(project));
 globalThis.window={api:{pluginEffects:()=>manager.effects(),pluginTransitions:()=>manager.transitions()}};
 await fs.writeFile(path.join(root,'inventory.json'),'truncated');await assert.rejects(refreshPluginEffects(),{code:'PLUGIN_INVENTORY_RECOVERY'});
 assert.equal(pluginEffectDefinition(fx),undefined);assert.equal(pluginTransitionDefinition(transitionKey),undefined);assert.throws(()=>assertPluginEffects(project),/review recovery/);assert.equal(JSON.stringify(project),before);
 await manager.recover((await manager.prepareRecovery()).token);await refreshPluginEffects();assert.throws(()=>assertPluginEffects(project),/unavailable/);assert.equal(JSON.stringify(project),before);
 await manager.setEnabled(effect.digest,true);await manager.setEnabled(transition.digest,true);await refreshPluginEffects();assert.doesNotThrow(()=>assertPluginEffects(project));assert.equal(JSON.stringify(project),before);
 console.log(JSON.stringify({ok:true,checks:4,claims:['failed refresh clears stale catalogs','dependency errors explain recovery','disabled recovery preserves references','explicit activation restores exact dependencies']}));
}finally{delete globalThis.window;await fs.rm(root,{recursive:true,force:true});}
