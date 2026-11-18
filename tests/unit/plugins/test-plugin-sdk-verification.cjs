// Exercise refusal paths with real child programs in tiny disposable roots.
// These roots cannot produce a candidate: each fails before packaging.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {validate,SUITES}=require('../../../scripts/verify-plugin-sdk.cjs');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-verification-')),results=[];
 for(const mode of ['suite-failure','source-change']){
  const root=path.join(directory,mode,'source'),output=path.join(directory,mode,'evidence');await fs.mkdir(path.join(root,'tests/unit/plugins'),{recursive:true});await fs.mkdir(path.join(root,'src/styles'),{recursive:true});await fs.mkdir(path.join(root,'packages/plugin-sdk'),{recursive:true});
  for(const name of ['package.json','package-lock.json','packages/plugin-sdk/package.json','packages/plugin-sdk/package-lock.json'])await fs.writeFile(path.join(root,name),'{}');for(const name of ['README.md','LICENSE'])await fs.writeFile(path.join(root,'packages/plugin-sdk',name),'Original verifier fixture');await fs.writeFile(path.join(root,'src/styles/marker.css'),'/* before */');
  for(const [index,name] of SUITES.entries()){let code='';if(index===0)code=mode==='suite-failure'?'process.exitCode=1;':`(await import('node:fs')).appendFileSync(${JSON.stringify(path.join(root,'src/styles/marker.css'))},'/* changed during check */');`;await fs.writeFile(path.join(root,'tests/unit/plugins',name),code);}
  const {report}=await validate({root,output});assert.equal(report.ok,false);assert.equal(report.releaseReady,false);assert.equal(report.suites.length,SUITES.length);assert.equal(report.artifact,undefined);await assert.rejects(fs.stat(path.join(output,'artifacts')),{code:'ENOENT'});
  if(mode==='suite-failure'){assert.equal(report.suites.filter(row=>row.status==='FAIL').length,1);assert.match(report.error,/failed suites/);}else{assert.ok(report.suites.every(row=>row.status==='PASS'));assert.deepEqual(report.sourceChanges,['src/styles/marker.css']);assert.match(report.error,/Source changed/);}
  const saved=await fs.readFile(path.join(output,'result.json'));await assert.rejects(validate({root,output}),{code:'EEXIST'});assert.deepEqual(await fs.readFile(path.join(output,'result.json')),saved);await assert.rejects(validate({root,output:path.join(root,'unsafe-output')}),/outside the checkout/);results.push(mode);
 }
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks:results},null,2));console.log('SDK verification failure/source fencing and output ownership passed: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
