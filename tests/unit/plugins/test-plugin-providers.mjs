import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {validateManifest} from '../../../shared/pluginManifest.mjs';import {validateProvider,providerEndpoint,pluginProviderId} from '../../../shared/pluginProviders.mjs';
const require=createRequire(import.meta.url),{PluginManager}=require('../../../electron/plugins/manager.cjs'),{createProviderService}=require('../../../electron/plugins/providerService.cjs'),gate=require('../../../electron/plugins/providerGate.cjs'),providers=require('../../../electron/agents/providers.cjs'),ai=require('../../../electron/agents/ai.cjs');
const sample=JSON.parse(await fs.readFile(new URL('../../../examples/plugins/local-ai-provider/plugin.json',import.meta.url))),definition=sample.contributes.aiProviders[0];
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
check('declarative provider example is valid without executable permissions',()=>assert.deepEqual(validateManifest(sample).permissions,[]));
for(const endpoint of ['http://example.com/v1','file:///tmp/secret','https://name:password@example.com/v1','https://example.com/v1?q=secret','https://example.com/v1#frag','https://example.com/v1?','https://example.com/v1#','https://example.com/%2fsecret','http://localhost.example.com/v1'])check('reject unsafe endpoint',()=>assert.throws(()=>providerEndpoint(endpoint)));
for(const edit of [d=>delete d.id,d=>d.protocol='native',d=>d.headers={authorization:'x'},d=>d.defaultModel='unknown',d=>d.models.push(d.models[0]),d=>d.models[0].vision='yes',d=>d.models=[]]){const copy=structuredClone(definition);edit(copy);check('reject unsupported or malformed metadata',()=>assert.throws(()=>validateProvider(copy)));}
check('loopback IPv4 and IPv6 endpoints allowed',()=>{assert.equal(providerEndpoint('http://127.0.0.1:1234/v1/'),'http://127.0.0.1:1234/v1');assert.equal(providerEndpoint('http://[::1]:1234/v1'),'http://[::1]:1234/v1');});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-provider-unit-')),originalFetch=globalThis.fetch;const approved=new Set();let consent=true,prompts=0,requests=[],responseMode='text',pending;
try{
 const manager=new PluginManager(path.join(root,'installed'),'2.0.0'),folder=path.join(root,'source');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(sample));let rows=await manager.install(folder,true),key=rows[0].key;
 const service=createProviderService({manager,settings:{pluginProviderApproved:id=>approved.has(id),approvePluginProvider:id=>approved.add(id)},dialog:{showMessageBox:async()=>{prompts++;return {response:consent?0:1};}},getWindow:()=>null,watchMs:10});gate.configure(service);await service.refresh();
 const id=pluginProviderId(sample.id,definition.id,key),cfg={provider:id,model:definition.defaultModel,baseUrl:definition.baseUrl,apiKey:''};
 globalThis.fetch=async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body),headers:options.headers,redirect:options.redirect});
  if(responseMode==='pending')return new Promise((resolve,reject)=>{pending={resolve,reject};options.signal.addEventListener('abort',()=>reject(Object.assign(Error('stopped'),{name:'AbortError'})),{once:true});});
  if(responseMode==='redirect')return new Response('',{status:307,headers:{location:'https://other.example/v1'}});
  if(responseMode==='oversize')return new Response('x'.repeat(4*1024*1024+1));
  if(responseMode==='key-error')return new Response(JSON.stringify({error:{message:cfg.apiKey}}),{status:401});
  return Response.json({choices:[{message:responseMode==='tools'?{tool_calls:[{id:'call_1',type:'function',function:{name:'get_project',arguments:'{}'}}],content:null}:{content:'Fixture OK'}}]});
 };
 check('installation does not make requests or read model catalogs',()=>assert.equal(requests.length,0));
 await assert.rejects(ai.chat(cfg,{messages:[{role:'user',content:'hello'}]}),/Approve/);checks++;
 consent=false;await assert.rejects(service.ensure(id),/declined/);check('denial persists no approval or network access',()=>{assert.equal(approved.size,0);assert.equal(requests.length,0);});
 consent=true;await service.ensure(id);await service.ensure(id);check('consent is scoped once to this exact provider version',()=>assert.equal(prompts,2));
 const reply=await ai.chat(cfg,{messages:[{role:'user',content:'hello'}]});check('host chat uses exact endpoint without empty credentials or redirects',()=>{assert.equal(reply,'Fixture OK');assert.equal(requests.at(-1).url,definition.baseUrl+'/chat/completions');assert.equal(requests.at(-1).headers.authorization,undefined);assert.equal(requests.at(-1).redirect,'manual');});
 const before=requests.length;const catalog=await ai.listModels(cfg),capability=await ai.modelCapabilities(cfg);check('catalog and capabilities use declared metadata with no probes',()=>{assert.deepEqual(catalog.models,[definition.defaultModel]);assert.equal(capability.vision,false);assert.equal(requests.length,before);});
 await assert.rejects(ai.chat({...cfg,baseUrl:'https://other.example/v1'},{messages:[]}),/endpoint/);await assert.rejects(ai.chat({...cfg,model:'other'},{messages:[]}),/model/);checks+=2;
 responseMode='tools';const tool=await ai.agentStep(cfg,{system:'Fixture',contents:[{role:'user',parts:[{text:'Get project'}]}],tools:[{name:'get_project',description:'Read project',parameters:{type:'OBJECT',properties:{}}}]});check('tool calls retain existing schema validation',()=>assert.equal(tool.calls[0].name,'get_project'));
 const beforeImage=requests.length;await assert.rejects(ai.agentStep(cfg,{system:'Fixture',contents:[{role:'user',parts:[{inlineData:{mimeType:'image/png',data:'AA=='}}]}],tools:[]}),/image support/);check('non-vision model blocks image payload before network',()=>assert.equal(requests.length,beforeImage));
 responseMode='redirect';await assert.rejects(ai.chat(cfg,{messages:[]}),/Redirects/);checks++;
 responseMode='oversize';await assert.rejects(ai.chat(cfg,{messages:[]}),/4 MiB/);checks++;
 responseMode='pending';const inFlight=ai.chat(cfg,{messages:[]});for(let i=0;i<100&&!pending;i++)await new Promise(r=>setTimeout(r,5));assert.ok(pending);service.revoke();await assert.rejects(inFlight);check('revocation aborts pending host requests',()=>assert.ok(true));
 pending=null;const connection=ai.testConnection(cfg);for(let i=0;i<100&&!pending;i++)await new Promise(r=>setTimeout(r,5));service.revoke();await assert.rejects(connection);check('connection tests inherit the host cancellation signal',()=>assert.ok(true));
 pending=null;const changed=ai.chat(cfg,{messages:[]});for(let i=0;i<100&&!pending;i++)await new Promise(r=>setTimeout(r,5));await fs.appendFile(path.join(manager.root,key,'plugin.json'),' ');await assert.rejects(changed);check('disk tampering aborts a pending response',()=>assert.ok(true));
 await service.refresh();assert.equal(providers.byId(id),null);checks++;
 // Repair through the normal immutable-package path; upgrading never inherits approval.
 await manager.remove(key);await manager.install(folder,true);await service.refresh();sample.version='1.1.0';await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify(sample));rows=await manager.install(folder,true);await service.refresh();const newer=rows.find(r=>r.enabled),newId=pluginProviderId(sample.id,definition.id,newer.key);
 check('upgraded provider has a separate identity and no inherited consent',()=>{assert.notEqual(newId,id);assert.equal(approved.has(newId),false);assert.equal(providers.byId(id),null);});
 check('plugin providers are excluded from built-in fallback lists',()=>assert.ok(!providers.toolProviders().some(p=>p.startsWith('plugin-provider:'))));
 console.log(JSON.stringify({ok:true,checks}));
}finally{globalThis.fetch=originalFetch;providers.setPluginProviders([]);gate.configure(null);await fs.rm(root,{recursive:true,force:true});}
