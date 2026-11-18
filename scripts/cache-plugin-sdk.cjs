// Explicit online preparation for the separate offline clean-consumer check.
// Lockfile installs cache archives but need not fetch registry packuments.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {npmCommand}=require('./npm-command.cjs'),runFile=promisify(execFile);
(async()=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-cache-')),report={ok:false,scope:'Online disposable SDK consumer to prepare npm metadata/archive cache; no publication'};
 console.log('SDK cache preparation evidence: '+output);
 const run=async(name,args,cwd)=>{const command=npmCommand(args);try{const result=await runFile(command.command,command.args,{cwd,timeout:300000,maxBuffer:4*1024*1024});await fs.writeFile(path.join(output,name+'.stdout.log'),result.stdout);await fs.writeFile(path.join(output,name+'.stderr.log'),result.stderr);return result.stdout;}catch(error){await fs.writeFile(path.join(output,name+'.stdout.log'),error.stdout||'');await fs.writeFile(path.join(output,name+'.stderr.log'),error.stderr||'');throw error;}};
 try{
  await require('./build-plugin-sdk.cjs').buildSdk();
  const [packed]=JSON.parse(await run('pack',['pack','--ignore-scripts','--json','--pack-destination',output],path.resolve(__dirname,'../packages/plugin-sdk')));
  const consumer=path.join(output,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),'{"private":true}');
  await run('install',['install','--ignore-scripts','--no-audit','--no-fund',path.join(output,packed.filename)],consumer);
  report.ok=true;report.node=process.version;report.consumer=consumer;
 }catch(error){report.error=error.stack||error.message;process.exitCode=1;}
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
 console.log('SDK cache preparation '+(report.ok?'passed':'failed')+'.');
})().catch(error=>{console.error(error);process.exitCode=1;});
