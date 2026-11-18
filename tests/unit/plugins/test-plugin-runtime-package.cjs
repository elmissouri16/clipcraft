const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runtimeDependencyProblems}=require('../../../scripts/check-runtime-dependencies.cjs');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-runtime-package-'));let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 try{
  const fixture=path.join(dir,'guard');fs.mkdirSync(path.join(fixture,'electron'),{recursive:true});fs.mkdirSync(path.join(fixture,'shared'));fs.mkdirSync(path.join(fixture,'src'));
  const manifest={build:{files:['electron/**/*','shared/**/*','package.json']}},pkg=path.join(fixture,'package.json');fs.writeFileSync(pkg,JSON.stringify(manifest));
  fs.writeFileSync(path.join(fixture,'shared/model.mjs'),'export const duration=1;');fs.writeFileSync(path.join(fixture,'src/store.js'),'export const duration=1;');
  const entry=path.join(fixture,'electron/main.cjs'),scan=code=>{fs.writeFileSync(entry,code);return runtimeDependencyProblems(fixture);};
  // Construct fixture source separately from this file's real dependencies.
  const call=(method,file)=>method+'('+JSON.stringify(file)+');',unshipped='../src/store.js',shared='../shared/model.mjs',dispatcher='../tests/smoke/index.cjs';
  const reexport=file=>'export {duration} from '+JSON.stringify(file)+';';
  check('guard accepts shipped static imports and ignores import-like comments',()=>assert.deepEqual(scan('// '+call('import',unshipped)+'\nasync function run(){return '+call('import',shared)+'}'),[]));
  for(const code of [call('import',unshipped),call('require',unshipped),call('require.resolve',unshipped),reexport(unshipped),'import('+String.fromCharCode(96)+unshipped+String.fromCharCode(96)+');'])check('guard rejects unshipped literal host dependencies',()=>assert.match(scan(code)[0],/excluded from build.files/));
  check('guard checks shared transitive dependencies',()=>{scan(call('require',shared));fs.writeFileSync(path.join(fixture,'shared/model.mjs'),reexport(unshipped));assert.match(runtimeDependencyProblems(fixture)[0],/^shared\/model.mjs/);fs.writeFileSync(path.join(fixture,'shared/model.mjs'),'export const duration=1;');});
  check('guard respects explicit exclusions and missing files',()=>{fs.writeFileSync(pkg,JSON.stringify({build:{files:[...manifest.build.files,'!shared/model.mjs']}}));assert.match(scan(call('import',shared))[0],/excluded/);fs.writeFileSync(pkg,JSON.stringify(manifest));assert.match(scan(call('require','./missing.cjs'))[0],/does not resolve/);});
  fs.mkdirSync(path.join(fixture,'tests/smoke'),{recursive:true});fs.writeFileSync(path.join(fixture,'tests/smoke/index.cjs'),'module.exports=()=>{};');
  check('only the exact positive smoke guard exempts the external test dispatcher',()=>{assert.deepEqual(scan('if(process.env.FVE_SMOKE){'+call('require',dispatcher)+'}'),[]);assert.ok(scan(call('require',dispatcher)).length);assert.ok(scan('if(process.env.FVE_SMOKE){'+call('require',unshipped)+'}').length);});
  check('current host and shared source imports belong to the declared payload',()=>assert.deepEqual(runtimeDependencyProblems(root),[]));
  console.log(JSON.stringify({ok:true,checks}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 })().catch(error=>{console.error(error);process.exitCode=1;});
