// Managed children for trusted extensions. Output is captured, streamed, or both;
// persistent helper servers belong to the activation rather than a command.
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const MINIMAL_ENV = ['PATH','HOME','USER','TMPDIR','TEMP','TMP','SystemRoot','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class ExtensionProcesses {
 constructor({isActive}) {this.isActive=isActive;this.records=new Map();this.serverStarts=new WeakMap();}
 owner(job,id) {const record=this.records.get(id);if(!record||record.job!==job||!this.isActive(job))throw Error('Managed process is unavailable');return record;}
 async start(job,input,{persistent=false}={}) {
  if(!this.isActive(job))throw Error('Extension is no longer active');
  if(!input||typeof input.file!=='string'||!input.file||input.file.length>4096||input.file.includes('\0')||!Array.isArray(input.args)||input.args.length>256||Array.from(input.args).some(a=>typeof a!=='string'||a.length>32768||a.includes('\0')))throw Error('Provide an executable and an argument array');
  if(Object.keys(input).some(key=>!['file','args','cwd','env','stdin','timeoutMs','maxOutputBytes','output','encoding'].includes(key)))throw Error('Unknown managed process option');
  if(this.records.size>=64)throw Error('Too many managed processes');
  const timeout=input.timeoutMs??(persistent?0:300000),limit=input.maxOutputBytes??1024*1024,mode=input.output??(persistent?'stream':'capture'),encoding=input.encoding??'utf8';
  if(!Number.isInteger(timeout)||timeout<(persistent?0:1)||timeout>1800000||!Number.isInteger(limit)||limit<1||limit>8*1024*1024||!['capture','stream','both'].includes(mode)||!['utf8','bytes'].includes(encoding))throw Error('Invalid managed process limits or output options');
  if(input.cwd!==undefined&&(typeof input.cwd!=='string'||!require('node:path').isAbsolute(input.cwd)))throw Error('Process working directory must be absolute');
  if(input.stdin!==undefined&&(!(typeof input.stdin==='string'||input.stdin instanceof Uint8Array)||Buffer.byteLength(input.stdin)>1024*1024))throw Error('Process input exceeds 1 MiB');
  const env={};for(const name of MINIMAL_ENV)if(process.env[name])env[name]=process.env[name];
  if(input.env!==undefined){if(!input.env||typeof input.env!=='object'||Array.isArray(input.env)||Object.keys(input.env).length>256)throw Error('Invalid process environment');for(const [key,value] of Object.entries(input.env)){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof value!=='string'||value.includes('\0')||value.length>32768)throw Error('Invalid process environment');env[key]=value;}}
  const id=crypto.randomUUID(),child=spawn(input.file,input.args,{cwd:input.cwd,env,detached:process.platform!=='win32',windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const record={id,job,child,closed:false,stdout:[],stderr:[],bytes:0,error:null,mode,encoding,limit,streaming:mode!=='capture',queue:[],queuedBytes:0,outputDone:false,waitFinished:false,persistent};this.records.set(id,record);
  record.result=new Promise((resolve,reject)=>{
   const collect=stream=>chunk=>{
    if(record.error)return;
    if(mode!=='stream'){record.bytes+=chunk.length;if(record.bytes>limit){this.fail(record,Error('Managed process output exceeded its limit'));return;}record[stream].push(chunk);}
    if(record.streaming){
     if(record.queuedBytes+chunk.length>limit){this.fail(record,Error('Managed process output queue exceeded its limit'));return;}
     for(let offset=0;offset<chunk.length;offset+=65536){const data=new Uint8Array(chunk.subarray(offset,offset+65536));record.queue.push({stream,data});record.queuedBytes+=data.byteLength;}
     this.drain(record);
    }
   };
   child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));child.stdin.on('error',()=>{});
   child.on('error',error=>{record.error=error;});
   // Release output pipes held by descendants after the direct child exits.
   child.on('exit',()=>{record.exitTimer=setTimeout(()=>{if(!record.closed){child.stdout.destroy();child.stderr.destroy();}},250);});
   child.on('close',(code,signal)=>{record.closed=true;clearTimeout(record.timer);clearTimeout(record.exitTimer);this.drain(record);const bytes=name=>Buffer.concat(record[name]);record.error?reject(record.error):resolve({code,signal,stdout:encoding==='bytes'?new Uint8Array(bytes('stdout')):bytes('stdout').toString('utf8'),stderr:encoding==='bytes'?new Uint8Array(bytes('stderr')):bytes('stderr').toString('utf8')});});
  });record.result.catch(()=>{});
  if(timeout)record.timer=setTimeout(()=>this.fail(record,Error('Managed process timed out')),timeout);
  child.stdin.end(input.stdin??'');
  return {id,pid:child.pid??null};
 }
 fail(record,error){record.error??=error;record.queue=[];record.queuedBytes=0;record.streaming=false;record.outputDone=true;this.drain(record);this.terminate(record);}
 release(record){if(record.closed&&record.waitFinished&&(!record.streaming||record.outputDone))this.records.delete(record.id);}
 drain(record){
  const waiter=record.reader;if(!waiter)return;
  if(record.error){record.reader=null;waiter.reject(record.error);return;}
  if(record.queue.length){const value=record.queue.shift();record.queuedBytes-=value.data.byteLength;record.reader=null;waiter.resolve({done:false,value});}
  else if(record.closed||!record.streaming){record.reader=null;record.outputDone=true;waiter.resolve({done:true});this.release(record);}
 }
 read(job,id){
  const record=this.owner(job,id);if(record.mode==='capture')return Promise.reject(Error('Enable stream or both output to read chunks'));
  if(record.reader)return Promise.reject(Error('Only one pending process output read is allowed'));
  if(record.outputDone)return Promise.resolve({done:true});
  return new Promise((resolve,reject)=>{record.reader={resolve,reject};this.drain(record);});
 }
 cancelRead(job,id){const record=this.records.get(id);if(!record||record.job!==job||!record.reader)return false;const reader=record.reader;record.reader=null;reader.reject(Object.assign(Error('Process output read canceled'),{name:'AbortError'}));return true;}
 closeOutput(job,id){
  const record=this.records.get(id);if(!record||record.job!==job)return false;
  record.streaming=false;record.queue=[];record.queuedBytes=0;record.outputDone=true;this.drain(record);this.release(record);return true;
 }
 async startServer(job,input){
  const {ready,token=crypto.randomUUID(),...options}=input??{};let endpoint;
  if(typeof token!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(token))throw Error('Invalid helper start token');
  try{endpoint=new URL(ready?.url);}catch{throw Error('A local HTTP readiness URL is required');}
  const timeout=ready?.timeoutMs??10000;
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.href.length>4096||!Number.isInteger(timeout)||timeout<100||timeout>60000||Object.keys(ready).some(key=>!['url','timeoutMs'].includes(key)))throw Error('Provide a loopback HTTP readiness URL and a 100 ms to 60 s deadline');
  let starts=this.serverStarts.get(job);if(!starts)this.serverStarts.set(job,starts=new Map());if(starts.has(token))throw Error('Duplicate helper start');
  const pending={canceled:false,record:null};starts.set(token,pending);let record;
  try{
   const started=await this.start(job,options,{persistent:true});record=this.owner(job,started.id);pending.record=record;const deadline=Date.now()+timeout;
   if(pending.canceled)throw Object.assign(Error('Helper start canceled'),{name:'AbortError'});
   while(Date.now()<deadline){
    if(!this.isActive(job)||record.closed||record.error)throw record.error??Error('Helper server exited before readiness');
    try{const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(500,deadline-Date.now())))});await response.body?.cancel();if(response.ok){if(!this.isActive(job)||record.closed||record.error)throw Error('Helper server stopped during readiness');return {...started,url:endpoint.href};}}catch(error){if(record.closed||record.error)throw record.error??error;}
    await delay(25);
   }
   throw Error('Helper server readiness timed out');
  }catch(error){if(record){this.fail(record,error);await record.result.catch(()=>{});this.records.delete(record.id);}throw error;}finally{starts.delete(token);}
 }
 cancelServerStart(job,token){const pending=this.serverStarts.get(job)?.get(token);if(!pending)return false;pending.canceled=true;if(pending.record)this.fail(pending.record,Object.assign(Error('Helper start canceled'),{name:'AbortError'}));return true;}
 async dispose(){const jobs=new Set([...this.records.values()].map(record=>record.job));await Promise.allSettled([...jobs].map(job=>this.stopped(job)));}
 terminate(record) {
  if(record.closed)return;
  const pid=record.child.pid;
  if(process.platform==='win32'&&pid){const killer=spawn('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>record.child.kill());killer.on('close',code=>{if(code&&!record.closed)record.child.kill();});}
  else if(pid){try{process.kill(-pid,'SIGKILL');}catch{record.child.kill('SIGKILL');}}
  else record.child.kill('SIGKILL');
 }
 async wait(job,id) {const record=this.owner(job,id);try{return await record.result;}finally{record.waitFinished=true;this.release(record);}}
 kill(job,id) {const record=this.records.get(id);if(!record||record.job!==job||record.closed)return false;this.fail(record,Error('Managed process canceled'));return true;}
 async stopped(job) {
  const records=[...this.records.values()].filter(r=>r.job===job);
  for(const record of records){record.error=Error('Extension stopped');this.drain(record);this.terminate(record);}
  await Promise.allSettled(records.map(r=>r.result));for(const record of records)this.records.delete(record.id);
 }
}
module.exports={ExtensionProcesses};
