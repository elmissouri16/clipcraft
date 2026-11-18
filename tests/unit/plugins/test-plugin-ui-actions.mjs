// Native edit planning and read-only historical metadata regression.
import assert from 'node:assert/strict';
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
import {validateAction,actionState,actionCatalog} from '../../../shared/pluginActions.mjs';
import {actionSelection,actionSelectionKey} from '../../fixtures/plugins/legacySelection.mjs';
import {emptyProject} from '../../../src/state/store.js';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const action={id:'shift',commandId:'run',label:'Shift clips',icon:'layers',locations:['plugins-menu','clip-menu'],when:{selection:'single',lanes:['text','overlay']}};
const manifest={id:'studio.ui',name:'Studio UI',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:['editor.read','clips.write'],contributes:{commands:[{id:'run',name:'Run',parameters:[]}],actions:[action]}};
check('schema accepts data-only registrations referring to an existing command',()=>assert.deepEqual(validateManifest(manifest).contributes.actions,[action]));
for(const edit of [a=>a.id='../ui',a=>a.commandId='missing',a=>a.label='bad\nlabel',a=>a.label='x'.repeat(81),a=>a.label='Spoof\u202eaction',a=>a.icon='data:image/svg+xml,bad',a=>a.locations=['untrusted-html'],a=>a.locations=['clip-menu','clip-menu'],a=>a.when='selection == 1',a=>a.when={selection:'one'},a=>a.when={lanes:['shell']},a=>a.when={selection:'none',lanes:['text']},a=>a.html='<script/>']){
 const m=structuredClone(manifest);edit(m.contributes.actions[0]);check('unsafe or unsupported action metadata is rejected',()=>assert.throws(()=>validateManifest(m)));
}
check('package-local action IDs must be unique',()=>assert.throws(()=>validateManifest({...manifest,contributes:{...manifest.contributes,actions:[action,action]}})));
check('registration count is bounded independently of command count',()=>assert.throws(()=>validateManifest({...manifest,contributes:{...manifest.contributes,actions:Array.from({length:33},(_,i)=>({...action,id:'a-'+i}))}})));
const noUi=structuredClone(manifest);delete noUi.contributes.actions;
check('legacy manifests retain their optional-field shape',()=>assert.equal(Object.hasOwn(validateManifest(noUi).contributes,'actions'),false));
const catalog=actionCatalog([{key:'a'.repeat(64),enabled:true,manifest:validateManifest(manifest)}]),entry=catalog.items[0];
check('catalog is inert metadata with scoped identities and command bounds',()=>{assert.equal(catalog.total,1);assert.equal(entry.command.id,'run');assert.equal(entry.key,'a'.repeat(64));assert.deepEqual(entry.permissions,['editor.read','clips.write']);assert.equal(entry.code,undefined);});
check('disabled and unavailable packages register nothing',()=>assert.deepEqual(actionCatalog([{key:'a',enabled:false,manifest},{key:'b',enabled:true,error:'unavailable'}]),{items:[],total:0,truncated:false}));
const many=actionCatalog(Array.from({length:300},(_,i)=>({key:String(i).padStart(64,'0'),enabled:true,manifest:{...validateManifest(manifest),id:'studio.p-'+i}})));
check('catalog truncation has an explicit total',()=>{assert.equal(many.items.length,256);assert.equal(many.total,300);assert.equal(many.truncated,true);});
const env={hasProject:true,busy:false,selection:[{lane:'text',id:'one',locked:false}]};
check('selection/lane predicates control visibility without plugin execution',()=>{assert.deepEqual(actionState(entry,'clip-menu',env),{visible:true,enabled:true});assert.equal(actionState(entry,'clip-menu',{...env,selection:[]}).visible,false);assert.equal(actionState(entry,'clip-menu',{...env,selection:[{lane:'audio'}]}).visible,false);assert.equal(actionState(entry,'clip-menu',{...env,selection:[...env.selection,...env.selection]}).visible,false);});
for(const [reason,override] of [['busy',{busy:true}],['project',{hasProject:false}],['locked',{selection:[{lane:'text',locked:true}]}],['selection',{selection:[{lane:'text',missing:true}]}],['unsupported',{selection:[{lane:'text',linked:true}]}]])check('host owns disabled state: '+reason,()=>assert.deepEqual(actionState(entry,'clip-menu',{...env,...override}),{visible:true,enabled:false,reason}));
check('general actions can operate without a selection',()=>assert.deepEqual(actionState({...entry,when:undefined},'plugins-menu',{...env,selection:[]}),{visible:true,enabled:true}));
check('none/multiple conditions and mixed lane selections are deterministic',()=>{assert.equal(actionState({...entry,when:{selection:'none'}},'plugins-menu',{...env,selection:[]}).enabled,true);assert.equal(actionState({...entry,when:{selection:'multiple',lanes:['text','overlay']}},'clip-menu',{...env,selection:[{lane:'text'},{lane:'overlay'}]}).enabled,true);assert.equal(actionState({...entry,when:{lanes:['text']}},'clip-menu',{...env,selection:[{lane:'text'},{lane:'overlay'}]}).visible,false);});
const project={...emptyProject(),textClips:[{id:'one',start:0,duration:1,layer:0}],layerState:{'text:0':{locked:true}}};
check('selection projection reads actual locks and missing references privately',()=>{const p=actionSelection(project,{items:[{track:'text',id:'one'},{track:'text',id:'missing'}]});assert.equal(p[0].locked,true);assert.equal(p[1].missing,true);assert.equal(p[0].text,undefined);});
check('selection scope ignores ordering while retaining exact identities',()=>assert.equal(actionSelectionKey({items:[{track:'text',id:'a'},{track:'audio',id:'b'}]}),actionSelectionKey({items:[{track:'audio',id:'b'},{track:'text',id:'a'}]})));
console.log(JSON.stringify({ok:true,checks}));
