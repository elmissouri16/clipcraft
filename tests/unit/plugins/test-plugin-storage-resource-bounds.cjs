// Observe real quota bypasses and bounded iteration; no oversized repository fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PreviewCache}=require('../../../electron/plugins/previewCache.cjs'),{PanelStorage,LIMITS}=require('../../../electron/plugins/panelStorage.cjs'),{BrowserPreferences}=require('../../../electron/plugins/browserPreferences.cjs');
let directory;const checks=[],failures=[],observations={};
const check=async(name,run)=>{try{await run();checks.push(name);console.log('PASS',name);}catch(error){failures.push({name,error:error.stack});console.error('FAIL',name,error.message);}};
async function virtualDirectory(label,target,count,run){
 const readdir=fs.readdir,opendir=fs.opendir,lstat=fs.lstat,stats=observations[label]={eager:0,opened:0,closed:0,yielded:0};
 const name=i=>'unknown-'+String(i).padStart(6,'0');
 fs.readdir=async(file,...args)=>{if(file!==target)return readdir(file,...args);stats.eager++;stats.yielded+=count;return Array.from({length:count},(_,i)=>name(i));};
 fs.opendir=async(file,...args)=>{if(file!==target)return opendir(file,...args);stats.opened++;return (async function*(){try{for(let i=0;i<count;i++){stats.yielded++;yield {name:name(i)};}}finally{stats.closed++;}})();};
 fs.lstat=async(file,...args)=>path.dirname(file)===target&&/^unknown-\d+$/.test(path.basename(file))?{isSymbolicLink:()=>false,isFile:()=>true,size:1}:lstat(file,...args);
 try{await run(stats);assert.equal(stats.opened,stats.closed);assert.equal(stats.eager,0);}finally{fs.readdir=readdir;fs.opendir=opendir;fs.lstat=lstat;}
}
async function growth(label,file,limit,run){
 const open=fs.open,stats=observations[label]={readBytes:0,eagerReadBytes:0,closed:0};
 fs.open=async(target,...args)=>{const handle=await open(target,...args);if(target!==file)return handle;const stat=handle.stat.bind(handle),read=handle.read.bind(handle),readFile=handle.readFile.bind(handle),close=handle.close.bind(handle);let appended=false;
  handle.stat=async()=>{const before=await stat();if(!appended){appended=true;sync.appendFileSync(file,' '.repeat(limit));}return before;};
  handle.read=async(...values)=>{const result=await read(...values);stats.readBytes+=result.bytesRead;return result;};handle.readFile=async(...values)=>{const result=await readFile(...values);stats.eagerReadBytes+=Buffer.byteLength(result);return result;};handle.close=async()=>{stats.closed++;return close();};return handle;
 };
 try{await run(stats);}finally{fs.open=open;stats.bytesOnDisk=(await fs.stat(file)).size;}
}
(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-storage-resource-bounds-'));const manager={root:path.join(directory,'plugins'),mutate:run=>run(),inventory:async()=>[]},cache=new PreviewCache(manager),panel=new PanelStorage(manager),favorites=new BrowserPreferences(manager);await fs.mkdir(cache.root,{recursive:true});await fs.writeFile(path.join(cache.root,'keep.txt'),'Unrelated data');
 await check('preview review stops at entry 5001 before retaining the full directory',()=>virtualDirectory('previewOverflow',cache.root,5010,async stats=>{await assert.rejects(cache.report(),/too many entries/);assert.equal(stats.yielded,5001);assert.equal(cache.review,null);}));
 await check('the exact 5000 preview-entry boundary remains accepted',()=>virtualDirectory('previewExact',cache.root,5000,async stats=>{assert.deepEqual(await cache.entries(),[]);assert.equal(stats.yielded,5000);}));
 const storage=path.join(directory,'storage');await fs.mkdir(storage);
 await check('storage accounting stops at directory entry 10001',()=>virtualDirectory('storageOverflow',storage,10020,async stats=>{await assert.rejects(cache.bytesIn(storage),/too large/);assert.equal(stats.yielded,10001);}));
 await check('the exact 10000 storage-entry boundary and existing depth policy remain accepted',()=>virtualDirectory('storageExact',storage,10000,async stats=>{assert.equal(await cache.bytesIn(storage),10000);assert.equal(stats.yielded,10000);assert.equal(await cache.bytesIn(storage,5),0);}));
 const values={note:'Retained 🪄 and literal �'},panelFile=path.join(directory,'panel.json');await fs.writeFile(panelFile,JSON.stringify({version:1,values}));
 await check('saved panel data that grows after stat refuses at 64 KiB plus one byte',()=>growth('panelGrowth',panelFile,LIMITS.total,async stats=>{await assert.rejects(panel.read(panelFile),/Saved storage cannot be read/);assert.equal(stats.readBytes,LIMITS.total+1);assert.equal(stats.eagerReadBytes,0);assert.equal(stats.closed,1);}));
 await fs.mkdir(manager.root,{recursive:true});await fs.writeFile(favorites.file,JSON.stringify(['studio.keep/sounds/tone']));
 await check('favorites that grow after stat refuse at 512 KiB plus one byte',()=>growth('favoritesGrowth',favorites.file,512*1024,async stats=>{await assert.rejects(favorites.read());assert.equal(stats.readBytes,512*1024+1);assert.equal(stats.eagerReadBytes,0);assert.equal(stats.closed,1);}));
 await check('valid UTF-8 panel data at the exact file quota remains readable without rewriting bytes',async()=>{const data=Buffer.from(JSON.stringify({version:1,values})),bytes=Buffer.concat([data,Buffer.alloc(LIMITS.total-data.length,32)]);await fs.writeFile(panelFile,bytes);assert.deepEqual(await panel.read(panelFile),values);assert.deepEqual(await fs.readFile(panelFile),bytes);});
 await check('valid favorites at the exact file quota remain readable without rewriting bytes',async()=>{const data=Buffer.from(JSON.stringify(['studio.keep/sounds/tone'])),bytes=Buffer.concat([data,Buffer.alloc(512*1024-data.length,32)]);await fs.writeFile(favorites.file,bytes);assert.deepEqual(await favorites.read(),['studio.keep/sounds/tone']);assert.deepEqual(await fs.readFile(favorites.file),bytes);});
 await check('malformed saved UTF-8 refuses while preserving its original bytes',async()=>{const bytes=Buffer.concat([Buffer.from('{"version":1,"values":{"note":"'),Buffer.from([0xff]),Buffer.from('"}}')]);await fs.writeFile(panelFile,bytes);await assert.rejects(panel.read(panelFile),/Saved storage cannot be read/);assert.deepEqual(await fs.readFile(panelFile),bytes);});
 assert.equal(await fs.readFile(path.join(cache.root,'keep.txt'),'utf8'),'Unrelated data');await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:!failures.length,checks,failures,observations},null,2));console.log('Storage resource evidence: '+directory);if(failures.length)process.exitCode=1;
})().catch(async error=>{if(directory)await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:false,error:error.stack,checks,failures,observations},null,2));console.error(error);process.exitCode=1;});
