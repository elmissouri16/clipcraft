import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import agentsModule from '../electron/localAgents.cjs';
import {webSourceUrl} from '../shared/webSource.mjs';
import {runAgent} from '../src/agent/runAgent.js';
import {emptyProject} from '../src/store.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-web-search-'));
const searches=[],captured=[];let mode='success';
const sdk={Codex:class{
  startThread(options){captured.push(options);return {runStreamed:async(input,opts)=>({events:(async function*(){
    assert.match(typeof input==='string'?input:input[0].text,/Native live web search is enabled/);
    yield {type:'item.started',item:{id:'search1',type:'web_search',query:''}};
    yield {type:'item.updated',item:{id:'search1',type:'web_search',action:{queries:['official example domains']}}};
    if(mode==='stop')await new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    if(mode==='failure'){yield {type:'turn.failed',error:{message:'Search failed private-test-key'}};return;}
    if(mode==='incomplete')return;
    yield {type:'item.completed',item:{id:'search1',type:'web_search',query:'official example domains'}};
    yield {type:'item.completed',item:{id:'answer',type:'agent_message',text:JSON.stringify({text:'Reserved example domains. [IANA](https://www.iana.org/help/example-domains)',calls:[]})}};
    yield {type:'turn.completed',usage:{}};
  })()})};}
}};
const agents=agentsModule.createLocalAgents({loadSdk:async()=>sdk,resolveExecutable:()=>'/installed/codex',home:dir,env:{PATH:'/usr/bin',OPENAI_API_KEY:'private-test-key'}});
const cfg={provider:'codex-sdk'},req={contents:[],tools:[],onSearch:s=>searches.push(s)};
try{
  const result=await agents.agentStep(cfg,req);
  assert.equal(captured[0].webSearchMode,'live');assert.equal(captured[0].sandboxMode,'read-only');
  assert.deepEqual(searches.map(s=>s.status),['running','running','done']);
  assert.equal(searches[1].query,'official example domains');assert.match(result.text,/https:\/\/www.iana.org/);
  mode='failure';searches.length=0;
  await assert.rejects(agents.agentStep(cfg,req),/Search failed \*\*\*/);assert.equal(searches.at(-1).status,'error');
  mode='incomplete';searches.length=0;
  await assert.rejects(agents.agentStep(cfg,req),/completed response/);assert.equal(searches.at(-1).status,'error');
  mode='stop';searches.length=0;
  const controller=new AbortController(),pending=agents.agentStep(cfg,{...req,signal:controller.signal});
  await new Promise(r=>setTimeout(r,10));controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(searches.at(-1).detail,'Stopped.');
  assert.equal(webSourceUrl('https://www.iana.org/help/example-domains'),'https://www.iana.org/help/example-domains');
  for(const url of ['file:///tmp/file','javascript:alert(1)','data:text/html,test','https://user:password@example.com','https://example.com\nfile'])assert.equal(webSourceUrl(url),null);

  let callback,removed=0;const events=[];
  const ctx={provider:'codex-sdk',getProject:()=>emptyProject(),dispatch:()=>assert.fail('search cannot edit the project'),api:{
    onAgentSearch:cb=>{callback=cb;return()=>{removed++;};},
    agentStep:async()=>{
      callback({requestId:'unrelated',id:'search',query:'wrong',status:'running'});
      callback({requestId:'mine',id:'search',query:'current facts',status:'running'});
      callback({requestId:'mine',id:'search',query:'current facts',status:'done'});
      return {ok:true,provider:'codex-sdk',calls:[],text:'Searched.',content:{role:'model',parts:[{text:'Searched.'}]}};
    },
  }};
  const run=await runAgent({ctx,contents:[],requestId:'mine',onEvent:e=>events.push(e),isCanceled:()=>false});
  assert.equal(run.changed,false);assert.equal(removed,1);
  assert.deepEqual(events.filter(e=>e.name==='web_search').map(e=>e.status),['running','done']);
  console.log('Codex web search ok (live mode, stream activity, source links, failures, cancellation, request isolation, read-only history)');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
