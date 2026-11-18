// Managed child processes for trusted extensions. Raw Node access remains
// available; only processes started here can be reliably tracked by the host.
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const MINIMAL_ENV = ['PATH','HOME','USER','TMPDIR','TEMP','TMP','SystemRoot','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
class ExtensionProcesses {
 constructor({isActive}) {this.isActive=isActive;this.records=new Map();}
 owner(job,id) {const record=this.records.get(id);if(!record||record.job!==job||!this.isActive(job))throw Error('Managed process is unavailable');return record;}
 async start(job,input) {
  if(!this.isActive(job))throw Error('Extension is no longer active');
  if(!input||typeof input.file!=='string'||!input.file||input.file.length>4096||input.file.includes('\0')||!Array.isArray(input.args)||input.args.length>256||input.args.some(a=>typeof a!=='string'||a.length>32768||a.includes('\0')))throw Error('Provide an executable and an argument array');
  if(this.records.size>=64)throw Error('Too many managed processes');
  const timeout=input.timeoutMs??300000,limit=input.maxOutputBytes??1024*1024;
  if(!Number.isInteger(timeout)||timeout<1||timeout>1800000||!Number.isInteger(limit)||limit<1||limit>8*1024*1024)throw Error('Invalid managed process limits');
  if(input.cwd!==undefined&&(typeof input.cwd!=='string'||!require('node:path').isAbsolute(input.cwd)))throw Error('Process working directory must be absolute');
  if(input.stdin!==undefined&&(typeof input.stdin!=='string'||Buffer.byteLength(input.stdin)>1024*1024))throw Error('Process input exceeds 1 MiB');
  const env={};for(const name of MINIMAL_ENV)if(process.env[name])env[name]=process.env[name];
  if(input.env!==undefined){if(!input.env||typeof input.env!=='object'||Array.isArray(input.env)||Object.keys(input.env).length>256)throw Error('Invalid process environment');for(const [key,value] of Object.entries(input.env)){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof value!=='string'||value.includes('\0')||value.length>32768)throw Error('Invalid process environment');env[key]=value;}}
  const id=crypto.randomUUID(),child=spawn(input.file,input.args,{cwd:input.cwd,env,detached:process.platform!=='win32',windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const record={id,job,child,closed:false,stdout:[],stderr:[],bytes:0,error:null};this.records.set(id,record);
  record.result=new Promise((resolve,reject)=>{
   const collect=stream=>chunk=>{record.bytes+=chunk.length;if(record.bytes>limit){record.error=Error('Managed process output exceeded its limit');this.terminate(record);}else record[stream].push(chunk);};
   child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));child.stdin.on('error',()=>{});
   child.on('error',error=>{record.error=error;});
   // 'close' waits for every holder of the output pipes. A descendant that outlives the program
   // (a daemon it started, a background job) would keep the result pending forever and block Stop,
   // so shortly after the program itself exits its pipes are released.
   child.on('exit',()=>{record.exitTimer=setTimeout(()=>{if(!record.closed){child.stdout.destroy();child.stderr.destroy();}},250);});
   child.on('close',(code,signal)=>{record.closed=true;clearTimeout(record.timer);clearTimeout(record.exitTimer);record.error?reject(record.error):resolve({code,signal,stdout:Buffer.concat(record.stdout).toString('utf8'),stderr:Buffer.concat(record.stderr).toString('utf8')});});
  });record.result.catch(()=>{});
  record.timer=setTimeout(()=>{record.error=Error('Managed process timed out');this.terminate(record);},timeout);
  child.stdin.end(input.stdin??'');
  return {id,pid:child.pid??null};
 }
 terminate(record) {
  if(record.closed)return;
  const pid=record.child.pid;
  if(process.platform==='win32'&&pid){const killer=spawn('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>record.child.kill());killer.on('close',code=>{if(code&&!record.closed)record.child.kill();});}
  else if(pid){try{process.kill(-pid,'SIGKILL');}catch{record.child.kill('SIGKILL');}}
  else record.child.kill('SIGKILL');
 }
 async wait(job,id) {const record=this.owner(job,id);try{return await record.result;}finally{this.records.delete(id);}}
 kill(job,id) {const record=this.records.get(id);if(!record||record.job!==job||record.closed)return false;record.error=Error('Managed process canceled');this.terminate(record);return true;}
 async stopped(job) {
  const records=[...this.records.values()].filter(r=>r.job===job);
  for(const record of records){record.error=Error('Extension stopped');this.terminate(record);}
  await Promise.allSettled(records.map(r=>r.result));for(const record of records)this.records.delete(record.id);
 }
}
module.exports={ExtensionProcesses};
