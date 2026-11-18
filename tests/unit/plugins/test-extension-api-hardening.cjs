// Pre-alpha SDK defects: exercise the real worker and host, including transport
// serialization and queued per-listener replay rather than mocked callbacks.
const assert=require('node:assert/strict');
const {createHost,sleep}=require('../../fixtures/extensionRuntimeHarness.cjs');
(async()=>{
 const t=createHost({a:{manifest:{id:'test.hardening'},code:`exports.activate=async c=>{
  let failures=0;c.events.on('test.hardening.failure',()=>{throw null;});c.events.on('test.hardening.failure',()=>{failures++;});await c.commands.register('failures',()=>failures);
  const counts={first:0,second:0,third:0,fourth:0};let second;
  const first=c.events.on('playback.changed',()=>counts.first++);await first.ready;
  await c.commands.register('second',async()=>{second=c.events.on('playback.changed',()=>counts.second++,{replay:true});await second.ready;});
  await c.commands.register('third',async()=>{await c.events.on('playback.changed',()=>counts.third++,{replay:true}).ready;});
  await c.commands.register('fourth',async()=>{await c.events.on('playback.changed',()=>counts.fourth++,{replay:true}).ready;});
  await c.commands.register('dispose',()=>second.dispose());
  await c.commands.register('counts',()=>counts);
  await c.commands.register('invalid-hook',()=>c.hooks.register('project.willSav',()=>{}));
  await c.commands.register('invalid-integration',()=>c.ui.registerIntegration({id:'typo',title:'Typo',point:'voice.engine',service:'speech'}));
  await c.commands.register('valid-hook',async()=>{const d=await c.hooks.register('project.willSave',()=>{});await d.dispose();return true;});
  await c.ui.registerSettings({id:'settings',title:'Settings',location:'settings.plugins',fields:[{key:'mode',label:'Mode',type:'select',options:[{label:'One',value:'one'},{label:'Two',value:'two'}]},{key:'amount',label:'Amount',type:'number',min:0.1,max:2,step:0.1,default:0.3}]});
  await c.commands.register('read',()=>c.configuration.get('value'));
  await c.commands.register('mode',()=>c.configuration.get('mode'));
  await c.commands.register('write',input=>c.configuration.update({key:'value',value:input}));
  await c.commands.register('invalid-data',async input=>{const values=[NaN,Infinity,new Date(),new Map(),new Uint8Array([1]),{x:undefined},[undefined],Array(2),{x:Symbol('bad')}];return c.configuration.update({key:'value',value:values[input]});});
 };`}}),checks=[];
 const check=name=>checks.push(name),execute=(name,input)=>t.host.execute('test.hardening.'+name,input),until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await sleep(10);}throw Error('Event condition timed out');};
 try{
  await t.host.start('a');
  await assert.rejects(execute('invalid-hook'),/Unsupported document hook/);assert.equal(t.host.hooks.size,0);
  await assert.rejects(execute('invalid-integration'),/Unsupported UI integration/);
  assert.equal(await execute('valid-hook'),true);check('registration typos fail immediately while supported hooks remain usable');
  assert.equal(await execute('mode'),'one');assert.equal((await t.host.ui.settings('test.hardening.settings')).mode,'one');check('implicit select default agrees in the settings form and configuration.get');
  await t.host.ui.update('test.hardening.settings','amount',0.7);
  for(const number of [0.15,0.31,1.99999999])await assert.rejects(t.host.ui.update('test.hardening.settings','amount',number),/step/);
  assert.equal((await t.host.ui.settings('test.hardening.settings')).amount,0.7);check('fractional steps accept rounding noise and reject off-step writes without changing storage');
  const value={nested:[null,true,3,'hello'],object:{ok:false}};await execute('write',value);assert.deepEqual(await execute('read'),value);
  for(let i=0;i<9;i++){await assert.rejects(execute('invalid-data',i),/Configuration|clone|cloned/i);assert.deepEqual(await execute('read'),value);}
  await execute('write',undefined);assert.equal(await execute('read'),undefined);check('non-JSON configuration is rejected before serialization without replacing saved values; deletion still works');
  await t.host.emit('playback.changed',{time:1});await until(async()=>(await execute('counts')).first===1);
  const release=t.host.events.hold();await execute('second');await execute('third');release();
  await until(async()=>(await execute('counts')).third===1);assert.deepEqual(await execute('counts'),{first:1,second:1,third:1,fourth:0});check('queued replay reaches each new listener once without re-delivering to existing listeners');
  await execute('dispose');await t.host.emit('playback.changed',{time:2});await until(async()=>(await execute('counts')).third===2);assert.deepEqual(await execute('counts'),{first:2,second:1,third:2,fourth:0});check('disposing one listener preserves normal live delivery to the others');
  await t.host.emit('test.hardening.failure',true);await until(async()=>(await execute('failures'))===1);assert.equal(t.host.active.get('a').state,'running');check('a null listener exception is logged without stopping the activation or later listeners');
  const unhold=t.host.events.hold();await t.host.emit('playback.changed',{time:3});await execute('fourth');unhold();await until(async()=>(await execute('counts')).first===3);await sleep(30);assert.deepEqual(await execute('counts'),{first:3,second:1,third:3,fourth:1});check('a retained publication pending live delivery is observed once per listener, including the newly subscribed listener');
  console.log(JSON.stringify({ok:true,checks},null,2));
 }finally{await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
