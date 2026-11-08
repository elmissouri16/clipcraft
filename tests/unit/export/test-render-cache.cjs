const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {RenderCache,reapRenderCaches}=require('../../../electron/export/renderCache.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-cache-test-')),source=path.join(dir,'source'),render=path.join(dir,'render.mkv');
 fs.writeFileSync(source,'first');fs.writeFileSync(render,'rendered pixels');
 const cache=new RenderCache({maxBytes:40,maxEntries:2});
 try{
  const key=cache.key({effect:'invert'},[source]);assert.equal(cache.get(key),null);
  await cache.put(key,render);assert.equal(fs.readFileSync(cache.get(key),'utf8'),'rendered pixels');
  fs.unlinkSync(render);assert.equal(fs.readFileSync(cache.get(key),'utf8'),'rendered pixels','export cleanup cannot remove a cached render');
  fs.writeFileSync(source,'replacement');assert.notEqual(cache.key({effect:'invert'},[source]),key,'source replacement invalidates the key');
  assert.notEqual(cache.key({effect:'blur'},[source]),key);assert.equal(cache.key({},[path.join(dir,'missing')]),null);
  fs.writeFileSync(render,'other pixels');await cache.put('second',render);cache.get(key);await cache.put('third',render);
  assert.equal(cache.get('second'),null,'least-recently-used renders leave the bounded cache');assert.ok(cache.get(key)&&cache.get('third'));
  fs.writeFileSync(render,Buffer.alloc(41));assert.equal(await cache.put('large',render),null,'oversized jobs are not retained');
  const cachedFile=cache.get('third');fs.truncateSync(cachedFile,1);assert.equal(cache.get('third'),null,'truncated cache files are rerendered');
  const originalCopy=fs.promises.copyFile;
  fs.writeFileSync(render,'pixels');
  fs.promises.copyFile=async(_source,destination)=>{fs.writeFileSync(destination,'partial');throw Error('disk failure');};
  try{await assert.rejects(cache.put('failed',render),/disk failure/);}finally{fs.promises.copyFile=originalCopy;}
  assert.ok(fs.readdirSync(cache.dir).every(file=>!file.endsWith('.part')),'failed copies leave no unbounded partial files');
  fs.writeFileSync(render,'immutable render');await cache.put('shared',render,{immutable:true});
  const shared=cache.get('shared');assert.equal(fs.statSync(shared).ino,fs.statSync(render).ino,'immutable cache hits share the completed media bytes');
  fs.unlinkSync(render);assert.equal(fs.readFileSync(shared,'utf8'),'immutable render');
  const deadPid=Number(require('node:child_process').execFileSync(process.execPath,['-p','process.pid'],{encoding:'utf8'}));
  for(const [name,pid] of [['dead',deadPid],['live',process.pid],['legacy',null]]){
    const folder=path.join(dir,'clipcraft-render-cache-'+name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'render.mkv'),'pixels');
    if(pid)fs.writeFileSync(path.join(folder,'.owner.json'),JSON.stringify({kind:'clipcraft-render-cache',pid}));
  }
  reapRenderCaches(dir);assert.ok(!fs.existsSync(path.join(dir,'clipcraft-render-cache-dead')));
  assert.ok(fs.existsSync(path.join(dir,'clipcraft-render-cache-live'))&&fs.existsSync(path.join(dir,'clipcraft-render-cache-legacy')),'live and unowned legacy sessions stay untouched');
  console.log('Render cache fingerprints sources, isolates completed files, bounds disk use and invalidates changed inputs.');
 }finally{cache.clear();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
