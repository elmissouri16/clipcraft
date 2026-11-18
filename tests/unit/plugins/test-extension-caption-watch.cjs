const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-caption-watch-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs');
 for(const name of ['ai-chapter-markers','caption-translation']){
  const source=path.join(dir,name);await fs.cp(path.resolve(__dirname,'../../../examples/extensions',name),source,{recursive:true,filter:file=>!['dist','.clipcraft-build.json'].includes(path.basename(file))});
  await fs.writeFile(path.join(source,'src/extension.ts'),"export {watch} from './source';export async function activate(){}\n");
  const built=await sdk.buildPlugin(source),{watch}=require(path.join(built.directory,'dist/extension.cjs'));
  const callbacks=new Map();let disposed=0,inspections=0;
  const context={events:{on:(name,handler)=>{callbacks.set(name,handler);return {ready:Promise.resolve().then(()=>{if(name==='project.changed')handler({documentId:'current',projectRevision:3});}),dispose:async()=>{disposed++;}};}},workspace:{inspect:async scope=>{assert.equal(scope.projectRevision,5);inspections++;}}};
  const controller=new AbortController(),subscription=await watch(context,{documentId:'current',projectRevision:5},controller);
  assert.equal(controller.signal.aborted,false,'an event already in transit before capture cannot cancel the current source');
  callbacks.get('project.changed')({documentId:'current',projectRevision:5});assert.equal(controller.signal.aborted,false);
  callbacks.get('project.changed')({documentId:'current',projectRevision:6});assert.equal(controller.signal.aborted,true,'a later revision cancels work');
  await subscription.dispose();await subscription.dispose();assert.equal(disposed,3);assert.equal(inspections,1);
  for(const event of ['project.closed','project.opened','project.changed']){
   const next=new AbortController(),sub=await watch(context,{documentId:'current',projectRevision:5},next);
   callbacks.get(event)({documentId:'different',projectRevision:1});assert.equal(next.signal.aborted,true,event+' invalidates captured document');await sub.dispose();
  }
 }
 console.log('Both caption workflows tolerate delayed older revisions and cancel newer or replaced documents.');
})().catch(error=>{console.error(error);process.exitCode=1;});
