// Real-app filters proof (tests/smoke/smoke-filters.cjs): the Filters tab renders every look, a tile sets the
// clip's filter and the player shows it, the intensity slider scales it, and the export applies it the same
// way. Isolated Vite server and Electron profile; the project is a generated colour-bar clip.
// Usage: ELECTRON_BIN=<electron> node tests/unit/effects/test-filters-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),net=require('node:net');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-filters-ui-'));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const ff=require(path.join(root,'electron/media/ffmpeg.cjs'));
 const src=path.join(dir,'source.mp4');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=1280x720:r=30:d=6','-f','lavfi','-i','sine=frequency=440:duration=6','-shortest','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','aac',src]);
 const media={...await ff.probe(src),id:'m',path:src,name:'source.mp4'};
 const project={id:'filters-smoke',name:'Filters',width:1280,height:720,fps:30,ratio:'16:9',background:'#000000',media:[media],
   videoClips:[{id:'v',mediaId:'m',in:0,out:6,speed:1,volume:1,muted:false,filter:'none',adjust:{},effects:[],transition:null}],overlayClips:[],audioClips:[],textClips:[],stickerClips:[],effectClips:[]};
 fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(project));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  const bin=process.env.ELECTRON_BIN||require('electron');
  const launcher=path.join(dir,'launcher'),userData=path.join(dir,'user-data');fs.mkdirSync(launcher);fs.mkdirSync(userData);fs.writeFileSync(path.join(launcher,'package.json'),JSON.stringify({name:'clipcraft-filter-test',version:require('../../../package.json').version,main:'main.cjs'}));fs.writeFileSync(path.join(launcher,'main.cjs'),`const {app}=require('electron');app.setPath('userData',${JSON.stringify(userData)});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);electron=spawn(bin,[launcher],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'filters',VITE_DEV_SERVER_URL:url}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},300000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(!result.error,result.error);assert.equal(result.userData,userData);assert.equal(result.noSandbox,false);
  console.log(`Real-app filters passed (${result.checks.length} checks: player chroma ${result.before.chroma} -> ${result.bw.chroma}, export ${result.sourceChroma} -> ${result.export.chroma}); evidence: ${dir}`);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
