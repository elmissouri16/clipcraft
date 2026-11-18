import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectorField,inspectorRead,inspectorValue,inspectorOperation,INSPECTOR_PROPERTIES} from '../../../shared/extensionInspector.mjs';
import {resolveStyle} from '../../../src/features/text/style.js';
import {propertyOperation} from '../../../shared/pluginProperties.mjs';
const require=createRequire(import.meta.url),{createHost}=require('../../fixtures/extensionRuntimeHarness.cjs');
const checks=[],check=name=>checks.push(name);
for(const [property,rule] of Object.entries(INSPECTOR_PROPERTIES)){
 const field=inspectorField({key:'field',label:'Field',property}),lane=rule.lanes[0],clip={text:'Title'},value=inspectorRead(field,clip,resolveStyle(clip));
 inspectorValue(field,value);
 const operation=inspectorOperation(field,value,'c-1',null),clips=new Map([['c-1',{id:'c-1',trackId:lane+':0',start_sec:0,end_sec:10,gap:false}]]),tracks=new Map([[lane+':0',{locked:false}]]);
 assert.doesNotThrow(()=>propertyOperation(operation,clips,tracks,['clips.properties']));
}
check('every declared property resolves its renderer default and produces a canonical typed operation');
for(const input of [{property:'__proto__'},{property:'constructor'},{property:'opacity',type:'string'},{property:'opacity',min:-1},{property:'opacity',step:0},{property:'text.style.align',options:[{value:'bad',label:'Bad'}]}])assert.throws(()=>inspectorField({key:'field',label:'Field',...input}));
const opacity=inspectorField({key:'opacity',label:'Opacity',property:'opacity',type:'range',min:0,max:1,step:.05});
for(const value of [.31,NaN,Infinity,'0.5',-1,2])assert.throws(()=>inspectorValue(opacity,value));assert.equal(inspectorValue(opacity,.35),.35);
assert.throws(()=>inspectorValue(inspectorField({key:'r',label:'R',property:'opacity',readOnly:true}),.2),/read-only/);
check('property compatibility, bounds, steps, enum choices and read-only declarations reject invalid writes');
let t=createHost({a:{manifest:{id:'fixture.controls'},code:`exports.activate=async c=>{
 const action=await c.ui.registerAction({id:'first',title:'First',location:'toolbar',command:'run',order:5,icon:{paths:['M4 12 L10 18 L20 6']}});
 await c.ui.registerAction({id:'second',title:'Second',location:'toolbar',command:'run',order:-5});
 await c.commands.register('run',()=>({message:'Ran'}));
 await c.commands.register('disable',()=>action.update({enabled:false,disabledReason:'Choose a clip',order:-10}));
 await c.commands.register('undefined-patch',()=>action.update({enabled:undefined,icon:undefined,order:undefined,disabledReason:undefined}));
 await c.commands.register('enable',()=>action.update({enabled:true,title:'Ready',icon:null}));
 let inspector=await c.ui.registerInspector({id:'picture',title:'Picture',fields:[{key:'opacity',label:'Opacity',property:'opacity',type:'range'}]});
 await c.commands.register('replace',async()=>{await inspector.dispose();inspector=await c.ui.registerInspector({id:'picture',title:'Replacement',fields:[{key:'opacity',label:'Opacity',property:'opacity'}]});});
 await c.commands.register('replace-action',async()=>{await action.dispose();await c.ui.registerAction({id:'first',title:'Replacement action',location:'toolbar',command:'run',enabled:false});});
 await c.commands.register('old-update',()=>action.update({enabled:true,title:'Old handle'}));
 await c.commands.register('bad-icon',()=>c.ui.registerAction({id:'bad',title:'Bad',location:'toolbar',command:'run',icon:{paths:['<script>alert(1)</script>']}}));
};`}});
try{
 await t.host.start('a');
 assert.deepEqual(t.host.ui.list().filter(row=>row.kind==='action').map(row=>row.title),['Second','First']);
 assert.equal((await t.host.ui.execute('fixture.controls.first')).message,'Ran');
 await t.host.execute('fixture.controls.disable');await assert.rejects(t.host.ui.execute('fixture.controls.first'),/Choose a clip/);assert.equal(t.host.ui.list()[0].disabledReason,'Choose a clip');await t.host.execute('fixture.controls.undefined-patch');assert.equal(t.host.ui.list()[0].enabled,false);assert.equal(t.host.ui.list()[0].disabledReason,'Choose a clip');assert.ok(t.host.ui.list()[0].icon);
 await t.host.execute('fixture.controls.enable');assert.equal((await t.host.ui.execute('fixture.controls.first')).message,'Ran');assert.equal(t.host.ui.list()[0].icon,null);
 check('real worker registrations expose live action state, icon clearing and ordering; the host enforces disabled state');
 await assert.rejects(t.host.execute('fixture.controls.bad-icon'),/SVG paths/);check('icons accept path data and reject executable markup');
 const group=t.host.ui.list().find(row=>row.kind==='inspector'),guard={id:group.id,instance:group.instance},job=t.host.active.get('a');assert.equal(t.host.ui.verifyInspector(job,guard),true);
 await t.host.execute('fixture.controls.replace');assert.equal(t.host.ui.verifyInspector(job,guard),false);
 const current=t.host.ui.list().find(row=>row.kind==='inspector');assert.notEqual(current.instance,group.instance);
 await assert.rejects(t.host.ui.inspectorSet(current.id,{field:'opacity',value:1.2,token:'00000000-0000-0000-0000-000000000000'}),/range/);
 check('registration replacement revokes old native commit guards and invalid values reject before editor dispatch');
 const oldAction=t.host.ui.list().find(row=>row.id==='fixture.controls.first');await t.host.execute('fixture.controls.replace-action');await assert.rejects(t.host.ui.execute('fixture.controls.first',{},oldAction.instance),/registration changed/);await assert.rejects(t.host.execute('fixture.controls.old-update'),/registration changed/);assert.equal(t.host.ui.list().find(row=>row.id==='fixture.controls.first').title,'Replacement action');check('a disposed action handle cannot mutate a replacement under the same ID');
 await t.host.stop('a');assert.equal(t.host.ui.list().length,0);check('Stop removes action and inspector registrations');
}finally{await t.close();}
console.log(JSON.stringify({ok:true,properties:Object.keys(INSPECTOR_PROPERTIES).length,checks},null,2));
