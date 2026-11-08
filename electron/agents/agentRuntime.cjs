// Native agent distributions are downloaded only after a user requests installation.
// These are official platform archives, fetched directly: no shell, npm or Node installation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {execFile}=require('node:child_process');
const tar=require('tar'),manifest=require('./runtimeManifest.json');
const TARGETS={darwin:'apple-darwin',linux:'unknown-linux-musl',win32:'pc-windows-msvc'};
function platformKey(platform=process.platform,arch=process.arch,musl=platform==='linux'&&!process.report?.getReport().header.glibcVersionRuntime){
 return `${platform}-${arch}${platform==='linux'&&musl?'-musl':''}`;
}
function distribution(provider,platform=process.platform,arch=process.arch,musl){
 const record=manifest[provider],key=platformKey(platform,arch,musl);
 if(!record)return null;
 const artifact=record.platforms[provider==='codex-sdk'?key.replace(/-musl$/,''):key];
 if(!artifact)return null;
 const target=`${arch==='arm64'?'aarch64':'x86_64'}-${TARGETS[platform]}`;
 const executable=provider==='codex-sdk'?`vendor/${target}/bin/codex${platform==='win32'?'.exe':''}`:`claude${platform==='win32'?'.exe':''}`;
 return {...artifact,provider,version:record.version,cliVersion:record.cliVersion,key,executable};
}
function runtimePath(root,provider,options={}){
 const d=distribution(provider,options.platform,options.arch,options.musl);
 return root&&d?path.join(root,provider,d.version,d.key,'package',d.executable):null;
}
function createAgentRuntimes({root,fetchImpl=globalThis.fetch,onProgress=()=>{},platform=process.platform,arch=process.arch,musl,artifacts,validateExecutable,stallTimeoutMs=30000}={}){
 if(!root)throw Error('A runtime cache directory is required.');
 const jobs=new Map(),options={platform,arch,musl};
 const descriptor=provider=>artifacts?.[provider]||distribution(provider,platform,arch,musl);
 const describe=provider=>{const d=descriptor(provider);return {supported:!!d,version:d?.cliVersion,progress:jobs.get(provider)?.progress||null};};
 function progress(job,patch){job.progress={provider:job.provider,...patch};try { onProgress(job.progress,job.owner); } catch { /* A closed observer cannot fail an installation. */ }}
 const verify=validateExecutable||((file,d,signal)=>new Promise((resolve,reject)=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  execFile(file,['--version'],{env,signal,timeout:15000,maxBuffer:32768,windowsHide:true},(error,stdout)=>{
   if(error)return reject(Error('The downloaded agent could not start. '+error.message));
   if(!new RegExp(`(?:^|\\s)${d.cliVersion.replace(/\./g,'\\.')}(?:\\s|$)`).test(stdout))return reject(Error('The downloaded agent version does not match the supported runtime.'));
   resolve();
  });
 }));
 async function perform(job,d){
  const signal=job.controller.signal;let staging;
  const timeout=setTimeout(()=>{job.timedOut=true;job.controller.abort();},15*60*1000);
  const check=()=>{if(signal.aborted)throw Object.assign(Error('Download canceled.'),{name:'AbortError'});};
  try{
   const finalDir=path.join(root,job.provider,d.version,d.key),installed=path.join(finalDir,'package',d.executable);
   if(fs.existsSync(installed)){
    try { await verify(installed,d,signal);return {ok:true,executablePath:installed}; }
    catch(error){check();} // Repair an invalid managed cache on retry.
   }
   if(fs.existsSync(finalDir))fs.rmSync(finalDir,{recursive:true,force:true});
   fs.mkdirSync(root,{recursive:true});staging=fs.mkdtempSync(path.join(root,'.install-'));
   const archive=path.join(staging,'runtime.tgz'),payload=path.join(staging,'payload');fs.mkdirSync(payload);
   let total=0,received=0,downloaded=false;
   const limit=768*1024*1024;
   for(let attempt=0;attempt<4&&!downloaded;attempt++){
    check();const request=new AbortController(),stop=()=>request.abort();signal.addEventListener('abort',stop,{once:true});
    let activity=Date.now(),last=0;
    const idle=setInterval(()=>{if(Date.now()-activity>stallTimeoutMs)request.abort();},Math.min(5000,stallTimeoutMs));
    try{
     received=fs.existsSync(archive)?fs.statSync(archive).size:0;
     progress(job,{stage:attempt?'retry':'download',received,total,fraction:total?received/total:null});
     let url=d.url,response;
     for(let i=0;i<4;i++){
      const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='registry.npmjs.org')throw Error('The runtime download host is not allowed.');
      response=await fetchImpl(url,{signal:request.signal,redirect:'manual',headers:received?{Range:`bytes=${received}-`}:{}});
      if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Invalid runtime download redirect.');url=new URL(location,url).href;continue;}
      break;
     }
     if(!response?.ok||!response.body)throw Error(`Runtime download failed (HTTP ${response?.status||'unavailable'}). Check your connection and retry.`);
     if(response.status===206){
      const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
      if(!range||Number(range[1])!==received||(total&&Number(range[3])!==total))throw Error('The resumed download range is invalid.');
      total=Number(range[3]);
     }else{received=0;total=Number(response.headers.get('content-length'))||0;}
     if(total>limit)throw Error('The runtime download is unexpectedly large.');
     activity=Date.now();
     const counter=new Transform({transform(chunk,encoding,done){
      activity=Date.now();received+=chunk.length;if(received>limit)return done(Error('The runtime download is unexpectedly large.'));
      if(Date.now()-last>100){last=Date.now();progress(job,{stage:'download',received,total,fraction:total?Math.min(.99,received/total):null});}
      done(null,chunk);
     }});
     const offset=response.status===206?Number(response.headers.get('content-range').split(' ')[1].split('-')[0]):0;
     await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(archive,{flags:offset?'a':'w'}),{signal:request.signal});check();
     received=fs.statSync(archive).size;
     if(total&&received!==total)throw Error('The runtime download was incomplete.');
     downloaded=true;
    }catch(error){check();if(attempt===3)throw Error(`The runtime download could not finish. Check your connection and retry. ${error.message}`);}
    finally{clearInterval(idle);signal.removeEventListener('abort',stop);request.abort();}
   }
   const expected=/^sha512-([A-Za-z0-9+/=]+)$/.exec(d.integrity);if(!expected)throw Error('The runtime checksum is missing.');
   const hash=crypto.createHash('sha512');
   for await(const chunk of fs.createReadStream(archive)){check();hash.update(chunk);}
   progress(job,{stage:'verify',received,total,fraction:1});
   if(total&&received!==total)throw Error('The runtime download was incomplete. Retry the download.');
   if(hash.digest('base64')!==expected[1])throw Error('The runtime download failed checksum verification. Retry the download.');
   progress(job,{stage:'extract',received,total,fraction:1});
   let rejected=false,unpacked=0;
   const extractor=tar.x({cwd:payload,strict:true,preservePaths:false,chmod:true,maxDepth:20,filter(name,entry){
    if(signal.aborted)return false;
    const parts=name.replace(/\\/g,'/').split('/');
    if(parts[0]!=='package'||parts.some(p=>p==='..'||p.includes(':'))||!['File','Directory'].includes(entry.type)){rejected=true;return false;}
    unpacked+=entry.size||0;if(unpacked>1536*1024*1024){rejected=true;return false;}return true;
   }});
   await pipeline(fs.createReadStream(archive),extractor,{signal});check();
   if(rejected)throw Error('The runtime archive contains unsupported entries.');
   const executable=path.join(payload,'package',d.executable);
   if(!fs.existsSync(executable))throw Error('The runtime archive does not contain its native executable.');
   fs.chmodSync(executable,0o755);await verify(executable,d,signal);check();
   fs.mkdirSync(path.dirname(finalDir),{recursive:true});
   // Only a complete, checksum-verified runtime becomes visible to agent discovery.
   fs.renameSync(payload,finalDir);progress(job,{stage:'ready',received,total,fraction:1});
   return {ok:true,executablePath:installed};
  }catch(error){
   const result=job.timedOut?{ok:false,error:'The runtime download timed out. Check your connection and retry.'}:signal.aborted?{ok:false,canceled:true}:{ok:false,error:error.message};
   progress(job,{stage:result.canceled?'canceled':'error',error:result.error});return result;
  }
  finally{clearTimeout(timeout);if(staging)fs.rmSync(staging,{recursive:true,force:true});jobs.delete(job.provider);}
 }
 function install(provider,owner){
  const d=descriptor(provider);if(!d)return Promise.resolve({ok:false,error:'No native download is available for this platform.'});
  if(jobs.has(provider))return jobs.get(provider).promise;
  const job={provider,owner,controller:new AbortController(),progress:null};jobs.set(provider,job);
  job.promise=perform(job,d);return job.promise;
 }
 function cancel(provider,owner){const job=jobs.get(provider);if(job&&job.owner===owner)job.controller.abort();}
 return {root,describe,install,cancel,cancelOwner:owner=>{for(const job of jobs.values())if(job.owner===owner)job.controller.abort();},close:()=>{for(const job of jobs.values())job.controller.abort();},pathFor:provider=>runtimePath(root,provider,options)};
}
module.exports={createAgentRuntimes,distribution,runtimePath,platformKey};
