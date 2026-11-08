const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {preparePreview}=require('../../../electron/media/preparePreview.cjs');
const ff=require('../../../electron/media/ffmpeg.cjs');
(async()=>{
 const item={path:'/source.mov',type:'video',width:3840,height:2160,pixFmt:'yuv422p10le',hdr:false,proxies:{}};
 const calls=[],patches=[];
 const services={exists:()=>true,probe:async()=>{throw Error('known metadata should not probe');},needsProxy:()=>true,
  makeQualityProxy:async(_i,_c,q)=>{calls.push('quality:'+q);return '/'+q+'.mp4';},
  makeProxy:async()=>{calls.push('compatibility');return '/high.mp4';},
  makeVisuals:async()=>{calls.push('visuals');},
 };
 const low=await preparePreview(item,'low','/cache',p=>patches.push(p),services);
 assert.deepEqual(calls,['quality:low','visuals']);assert.equal(low.proxyRequired,true);assert.equal(low.proxy,undefined);assert.equal(low.proxies.low,'/low.mp4');
 assert.ok(patches.some(p=>p.proxies?.low==='/low.mp4'&&p.optimizing===false),'selected footage is ready before visuals');
 calls.length=0;const full=await preparePreview(low,'full','/cache',()=>{},services);
 assert.deepEqual(calls,['compatibility','visuals']);assert.equal(full.proxyRequired,false);assert.equal(full.proxy,'/high.mp4');assert.equal(full.proxies.low,'/low.mp4');
 calls.length=0;const high=await preparePreview(item,'high','/cache',()=>{},services);
 assert.deepEqual(calls,['quality:high','visuals']);assert.equal(high.proxy,'/high.mp4');
 calls.length=0;await preparePreview(high,'full','/cache',()=>{},services);assert.deepEqual(calls,['visuals'],'cached High also satisfies compatibility');
 const failed=await preparePreview(item,'full','/cache',()=>{},{...services,makeProxy:async()=>{throw Error('failed');}});assert.equal(failed.proxyFailed,true);assert.equal(failed.optimizing,false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-proxy-contract-')),source=path.join(dir,'source.mp4');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=1','-c:v','libx264',source]);
 const media={...(await ff.probe(source)),path:source};
 const results=await Promise.all([ff.makeProxy(media,dir),ff.makeQualityProxy(media,dir,'high',{force:true}),ff.makeProxy(media,dir)]);
 assert.equal(new Set(results).size,1);assert.ok(fs.existsSync(results[0]));const info=await ff.probe(results[0]);assert.equal(info.width,160);assert.equal(info.height,90);
 assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith('-qhigh.mp4')).length,1);
 console.log('preview preparation passed: selected copy first, deferred Full, shared High/compatibility, failure completion, concurrent encoding and no upscaling');
})().catch(error=>{console.error(error);process.exitCode=1;});
