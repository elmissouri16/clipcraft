// Run the standalone test suites without adding a second test framework.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const args = process.argv.slice(2), filters = args.filter(arg=>arg!=='--list');
const tests = walk(path.join(root,'tests','unit')).filter(file=>/test-.*\.(?:cjs|mjs)$/.test(file)).map(file=>path.relative(root,file)).sort().filter(file=>!filters.length||filters.some(filter=>file.includes(filter)));
if (!tests.length) { console.error('No matching tests. Use npm test -- --list to see available suites.');process.exit(1); }
if (args.includes('--list')) { console.log(tests.join('\n'));process.exit(0); }
const output = fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-tests-'));
let next=0;
const results=[];
function run(file) {
  return new Promise(resolve=>{
    const log=path.join(output,path.basename(file)+'.log'),fd=fs.openSync(log,'w');
    const child=spawn(process.execPath,[file],{cwd:root,stdio:['ignore',fd,fd],detached:process.platform!=='win32'});
    let timedOut=false, error;
    const timer=setTimeout(()=>{
      timedOut=true;
      if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true}).on('error',()=>child.kill());
      else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}
    },120000);
    child.on('error',value=>{error=value.message;});
    child.on('close',code=>{
      clearTimeout(timer);fs.closeSync(fd);
      const status=timedOut?'TIMEOUT':code===0&&!error?'PASS':'FAIL';
      console.log(`${status} ${file}${status==='PASS'?'':` (${error||log})`}`);
      resolve({file,status,code,log,...(error?{error}:{})});
    });
  });
}
(async()=>{
  await Promise.all(Array.from({length:Math.min(2,tests.length)},async()=>{while(next<tests.length)results.push(await run(tests[next++]));}));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  const failed=results.filter(result=>result.status!=='PASS').length;
  console.log(`${results.length-failed} passed, ${failed} failed. Logs: ${output}`);
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
