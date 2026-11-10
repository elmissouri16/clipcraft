const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),tar=require('tar');
const {createAgentRuntimes,distribution,runtimePath}=require('../../../electron/agents/agentRuntime.cjs');
const {findExecutable,unwrapShim,createLocalAgents}=require('../../../electron/agents/localAgents.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-agent-runtime-test-'));
(async()=>{try{
 const d=distribution('codex-sdk','darwin','arm64');assert.equal(d.executable,'vendor/aarch64-apple-darwin/bin/codex');
 assert.equal(distribution('claude-agent-sdk','linux','x64',true).key,'linux-x64-musl');assert.equal(distribution('codex-sdk','linux','x64',true).key,'linux-x64-musl');assert.equal(distribution('claude-agent-sdk','win32','arm64').executable,'claude.exe');assert.equal(distribution('codex-sdk','unknown','x64'),null);
 for(const [provider,base] of Object.entries(require('../../../electron/agents/runtimeManifest.json'))){
  const version=require('../../../package.json').dependencies[{'codex-sdk':'@openai/codex-sdk','claude-agent-sdk':'@anthropic-ai/claude-agent-sdk','opencode-sdk':'@opencode/client'}[provider]];assert.equal(base.version,version,'SDK and pinned runtime stay aligned');
  for(const a of Object.values(base.platforms)){assert.equal(new URL(a.url).hostname,'registry.npmjs.org');assert.match(a.integrity,/^sha512-/);}
 }
 const fixture=path.join(root,'fixture'),exe=path.join(fixture,'package',d.executable);fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'native test executable');
 const archive=path.join(root,'fixture.tgz');await tar.c({file:archive,gzip:true,cwd:fixture},['package']);const bytes=fs.readFileSync(archive),integrity='sha512-'+crypto.createHash('sha512').update(bytes).digest('base64');
 const artifact={...d,integrity,url:'https://registry.npmjs.org/official-native-fixture.tgz'};
 const response=()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}});
 let fetches=0,validations=0;const progress=[];
 const manager=createAgentRuntimes({root:path.join(root,'cache'),artifacts:{'codex-sdk':artifact},fetchImpl:async()=>{fetches++;return response();},validateExecutable:async file=>{validations++;assert.equal(fs.readFileSync(file,'utf8'),'native test executable');},onProgress:p=>progress.push(p.stage)});
 const first=manager.install('codex-sdk',1),second=manager.install('codex-sdk',1);assert.equal(first,second,'duplicate requests share one download');const success=await first;assert.equal(success.ok,true,success.error);assert.equal(fetches,1);assert.ok(progress.includes('verify')&&progress.includes('extract'));assert.ok(fs.existsSync(success.executablePath));assert.ok(!fs.readdirSync(manager.root).some(n=>n.startsWith('.install-')));
 assert.equal((await manager.install('codex-sdk',1)).ok,true);assert.equal(fetches,1,'valid cache is reused');
 fs.writeFileSync(success.executablePath,'broken');assert.equal((await manager.install('codex-sdk',1)).ok,true,'bad managed cache is repaired');assert.equal(fetches,2);
 let resumed=0;const half=Math.floor(bytes.length/2);
 const resume=createAgentRuntimes({root:path.join(root,'resume'),artifacts:{'codex-sdk':artifact},fetchImpl:async(url,opts)=>{
  if(!resumed++){return new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,half));setTimeout(()=>c.error(Error('temporary network failure')),20);}}),{headers:{'content-length':String(bytes.length)}});}
  assert.equal(opts.headers.Range,`bytes=${half}-`);return new Response(bytes.subarray(half),{status:206,headers:{'content-range':`bytes ${half}-${bytes.length-1}/${bytes.length}`,'content-length':String(bytes.length-half)}});
 },validateExecutable:async file=>assert.equal(fs.readFileSync(file,'utf8'),'native test executable')});
 assert.equal((await resume.install('codex-sdk',1)).ok,true,'interrupted downloads resume and verify the complete archive');assert.equal(resumed,2);
 const wrong=createAgentRuntimes({root:path.join(root,'bad'),artifacts:{'codex-sdk':artifact},fetchImpl:async()=>new Response(Buffer.from('corrupt')),validateExecutable:async()=>assert.fail('unverified data must never execute')});
 assert.match((await wrong.install('codex-sdk',1)).error,/checksum/);assert.deepEqual(fs.readdirSync(wrong.root),[]);
 const forbidden=createAgentRuntimes({root:path.join(root,'forbidden'),artifacts:{'codex-sdk':{...artifact,url:'https://untrusted.example/native.tgz'}},fetchImpl:()=>assert.fail('untrusted host must not be fetched')});assert.match((await forbidden.install('codex-sdk',1)).error,/host/);
 let canceled=false;const stalled=createAgentRuntimes({root:path.join(root,'cancel'),artifacts:{'codex-sdk':artifact},fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,10));},cancel(){canceled=true;}}))});
 const pending=stalled.install('codex-sdk',7);await new Promise(r=>setTimeout(r,20));stalled.cancel('codex-sdk',8);assert.ok(stalled.describe('codex-sdk').progress,'other owners cannot cancel');stalled.cancel('codex-sdk',7);assert.equal((await pending).canceled,true);assert.equal(canceled,true);assert.deepEqual(fs.readdirSync(stalled.root),[]);
 const link=path.join(fixture,'package','escape');fs.symlinkSync('/tmp',link);await tar.c({file:archive,gzip:true,cwd:fixture},['package']);const linked=fs.readFileSync(archive);const unsafe=createAgentRuntimes({root:path.join(root,'unsafe'),artifacts:{'codex-sdk':{...artifact,integrity:'sha512-'+crypto.createHash('sha512').update(linked).digest('base64')}},fetchImpl:async()=>new Response(linked),validateExecutable:async()=>assert.fail('archive links must not execute')});assert.match((await unsafe.install('codex-sdk',1)).error,/unsupported entries/);
 // Native CLI discovery works with an empty PATH and no Node/npm executable.
 const cache=path.join(root,'discovery'),native=runtimePath(cache,'claude-agent-sdk',{platform:'win32',arch:'x64'});fs.mkdirSync(path.dirname(native),{recursive:true});fs.writeFileSync(native,'native');assert.equal(findExecutable('claude-agent-sdk','',{env:{PATH:''},home:path.join(root,'home'),platform:'win32',arch:'x64',runtimeRoot:cache}),native);
 // A POSIX npm launcher is resolved to its native payload without running Node.
 const npm=path.join(root,'npm'),launcher=path.join(npm,'bin','codex.js'),vendor=path.join(npm,'vendor','aarch64-apple-darwin','bin','codex');fs.mkdirSync(path.dirname(launcher),{recursive:true});fs.mkdirSync(path.dirname(vendor),{recursive:true});fs.writeFileSync(launcher,'never execute');fs.writeFileSync(vendor,'native');assert.equal(unwrapShim(launcher,'codex-sdk','darwin','arm64'),fs.realpathSync(vendor));
 const oldAgent=createLocalAgents({resolveExecutable:()=>'/native/codex',loadSdk:async()=>({}),execFileImpl:(file,args,options,done)=>done(null,'codex-cli 0.100.0')});
 const oldStatus=await oldAgent.status({provider:'codex-sdk'});assert.equal(oldStatus.ok,false);assert.equal(oldStatus.installed,true);assert.match(oldStatus.error,/too old/);
 console.log('Native runtime download, integrity, cancellation, cache repair, archive safety and discovery passed');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
