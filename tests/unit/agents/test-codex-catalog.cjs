const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CodexNative}=require('../../../electron/agents/codexNative.cjs');
const workdirs=[];class Catalog extends CodexNative{constructor(opts){workdirs.push(opts.cwd);super(opts);}}
const {createLocalAgents}=require('../../../electron/agents/localAgents.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-catalog-')),log=path.join(dir,'protocol.jsonl');
 const agents=createLocalAgents({CodexCatalog:Catalog,home:dir,resolveExecutable:()=>path.resolve(__dirname,'../../fixtures/codex-native-stub.cjs'),env:{...process.env,FVE_NATIVE_FIXTURE_LOG:log}});
 const cfg={provider:'codex-sdk'};
 const [a,b]=await Promise.all([agents.listModels(cfg),agents.listModels(cfg)]);assert.deepEqual(a,b);
 assert.deepEqual(a.models,['gpt-6.1-sol','gpt-6-luna']);assert.equal(a.modelLabels['gpt-6.1-sol'],'GPT-6.1 Sol');
 assert.deepEqual(a.modelCapabilities['gpt-6.1-sol'].reasoningEfforts,['low','high','ultra']);assert.deepEqual(a.modelCapabilities['gpt-6-luna'].reasoningEfforts,['high','max']);
 assert.equal(a.modelCapabilities['gpt-6.1-sol'].defaultReasoningEffort,'low');assert.deepEqual(a.modelCapabilities['gpt-6.1-sol'].inputModalities,['text','image']);
 let protocol=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(protocol.filter(x=>x.method==='initialize').length,1,'concurrent model and capability loads share a connection');
 assert.equal(protocol.filter(x=>x.method==='model/list').length,2,'all catalog pages are read');assert.equal(protocol.some(x=>x.method==='thread/start'),false,'discovery never starts a conversation or inference');
 await agents.listModels(cfg);await agents.listModels(cfg,{refresh:true});protocol=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(protocol.filter(x=>x.method==='initialize').length,2,'manual refresh retrieves a new catalog');
 const stop=new AbortController();stop.abort();await assert.rejects(agents.listModels(cfg,{signal:stop.signal}),{name:'AbortError'});
 fs.mkdirSync(path.join(dir,'.codex'));fs.writeFileSync(path.join(dir,'.codex/models_cache.json'),JSON.stringify({models:[{slug:'offline-visible',supported_reasoning_levels:[{effort:'low'}]},{slug:'offline-hidden',visibility:'hide'}]}));
 const offline=createLocalAgents({home:dir,resolveExecutable:()=>'/missing/codex',env:{PATH:''}});
 const fallback=await offline.listModels(cfg);assert.equal(fallback.fromCache,true);assert.deepEqual(fallback.models,['offline-visible']);
 assert.ok(workdirs.every(dir=>!fs.existsSync(dir)),'catalog sessions release their temporary working directories');
 console.log('Codex live catalog: pagination, latest models, effort metadata, coalescing, refresh, hidden entries, offline fallback and cancellation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
