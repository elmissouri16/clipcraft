import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
import {validateEffectDefinition,validateEffectExpression,effectExpression} from '../../../shared/pluginEffects.mjs';
import {compile} from '../../../shared/effectExpression.mjs';
import {setPluginEffects,pluginEffectInstance,pluginEffectSource,projectPluginProblems,assertPluginEffects} from '../../../src/features/plugins/effectRegistry.js';
import {emptyProject,historyReducer,normalizeProject} from '../../../src/state/store.js';
import {pixelPasses,pixelEffectRanges} from '../../../src/features/effects/apply.js';
const {PluginManager}=createRequire(import.meta.url)('../../../electron/plugins/manager.cjs');
const sample=JSON.parse(await fs.readFile(new URL('../../../examples/plugins/color-pulse/plugin.json',import.meta.url)));
const definition=validateManifest(sample).contributes.effects[0];
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
check('effect-only manifest accepted',()=>assert.equal(definition.id,'color-pulse'));
for(const source of ['constructor(0)','1e999','ld(9)','st(X,1);S(X,Y)','A(X,Y)','P+S(X,Y)', '('.repeat(600)+'1'+')'.repeat(600), 'sin('.repeat(40)+'1'+')'.repeat(40),Array(18).fill('S(X,Y)').join('+')]) {
 check('reject expression '+source.slice(0,30),()=>assert.throws(()=>validateEffectExpression(source)));
}
for(const edit of [d=>d.expression='S(X,Y)+{{unknown}}',d=>d.expression='st({{amount}},1);S(X,Y)',d=>d.parameters[0].min=NaN,d=>d.parameters[0].default=100,d=>d.parameters.push(d.parameters[0])]) {
 const d=structuredClone(definition);edit(d);check('reject invalid declaration',()=>assert.throws(()=>validateEffectDefinition(d)));
}
check('parameter substitution is numeric',()=>assert.ok(!effectExpression(definition).includes('{{')));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-effects-unit-'));
try {
 const source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify(sample));
 const manager=new PluginManager(path.join(root,'plugins'),'2.0.0');await manager.install(source,true);
 let rows=await manager.effects();setPluginEffects(rows);const fx=`plugin:${rows[0].contributionId}@${rows[0].digest}`;
 let h={past:[],present:{...emptyProject(),videoClips:[{id:'v',mediaId:'m',in:0,out:1,speed:1,effects:[]}],media:[{id:'m',type:'image',path:'/fixture.png',width:320,height:180}]},future:[]};
 h=historyReducer(h,{type:'update',track:'video',id:'v',patch:{effects:[fx]}});
 check('reducer pins exact installed dependency',()=>assert.equal(h.present.videoClips[0].pluginEffects[fx].digest,rows[0].digest));
 check('effect edit creates Undo entry',()=>assert.equal(h.past.length,1));
 const added=h;h=historyReducer(h,{type:'undo'});
 check('Undo removes effect and metadata together',()=>assert.equal(h.present.videoClips[0].pluginEffects,undefined));
 h=historyReducer(h,{type:'redo'});check('Redo restores effect',()=>assert.equal(h.present.videoClips[0].effects[0],fx));
 const project=normalizeProject(JSON.parse(JSON.stringify(h.present))),clip=project.videoClips[0],instance=clip.pluginEffects[fx];
 check('project round trip preserves dependency',()=>assert.deepEqual(instance,pluginEffectInstance(fx)));
 check('effect schedules full clip shader rendering',()=>assert.deepEqual(pixelEffectRanges(project,clip,0,1,24),[[0,1]]));
 const passes=pixelPasses(project,clip,0,.25);
 check('plugin enters shared preview/export passes',()=>assert.equal(passes[0].expr,pluginEffectSource(fx,instance)));
 const draw=(time,amount)=>compile(validateEffectExpression(effectExpression(definition,{amount,speed:1})))({X:1,Y:1,W:320,H:180,T:time,ch:0,S:()=>100,reg:[]});
 check('parameters and time visibly affect output',()=>{assert.ok(draw(.25,1)>draw(.75,1));assert.equal(draw(.25,0),100);});
 const invalid=structuredClone(project);invalid.videoClips[0].pluginEffects[fx].params.amount='1);evil()';
 check('invalid saved values block export',()=>assert.throws(()=>assertPluginEffects(invalid)));
 const upgraded=structuredClone(sample);upgraded.version='1.1.0';upgraded.contributes.effects[0].name='New color pulse';
 await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify(upgraded));await manager.install(source,true);
 rows=await manager.effects();setPluginEffects(rows);
 check('installed update retains pinned renderer version',()=>{assert.equal(rows.length,2);assert.equal(projectPluginProblems(project).length,0);assert.equal(rows.filter(r=>r.preferred).length,1);});
 await manager.remove(instance.digest);setPluginEffects(await manager.effects());
 check('missing exact version blocks rather than substitutes',()=>assert.throws(()=>assertPluginEffects(project),/unavailable/));
 check('missing version does not rewrite saved settings',()=>assert.deepEqual(project.videoClips[0].pluginEffects[fx],instance));
 const disabled=structuredClone(project);disabled.videoClips[0].pluginEffects[fx].disabled=true;
 check('explicit disable permits export',()=>assert.doesNotThrow(()=>assertPluginEffects(disabled)));
 check('disabled effect contributes no shader',()=>assert.equal(pixelPasses(disabled,disabled.videoClips[0],0,.25).length,0));
 setPluginEffects([]);
 console.log(JSON.stringify({ok:true,checks}));
} finally {await fs.rm(root,{recursive:true,force:true});}
