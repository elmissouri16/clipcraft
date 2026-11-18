const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fsp.mkdtemp(path.join(os.tmpdir(),'clipcraft-authoring-ui-')),source=path.join(dir,'source');await fsp.mkdir(source);
 const settings={mode:'crf',crf:29,bitrateMbps:2,encoderPreset:'ultrafast',audioKbps:96,resCap:480,fps:24,codec:'h264'};
 await fsp.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'test.service-author',name:'Creative preset author',publisher:'ClipCraft tests',version:'1.0.0',apiVersion:1,contributes:{exportPresets:[{id:'draft',name:'Draft export',settings}]}}));
 const media=path.join(dir,'source.mp4');execFileSync(require('../../../electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-f','lavfi','-i','color=c=0x335577:s=640x360:r=24:d=3','-c:v','libx264','-preset','ultrafast',media]);
 await fsp.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({source,media}));await fsp.mkdir(path.join(dir,'settings-test'));await fsp.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const log=fs.openSync(path.join(dir,'runtime.log'),'w');let electron;
 try{electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',log,log],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'plugin-authoring',FVE_SMOKE_QUIET:'1',CLIPCRAFT_DEV_EXAMPLES:'0',VITE_DEV_SERVER_URL:''}});const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},120000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});const result=JSON.parse(await fsp.readFile(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.equal(result.ok,true,result.error);console.log('Real authoring UI verified: '+dir);console.log(JSON.stringify(result,null,2));}
 finally{electron?.kill();fs.closeSync(log);}
})().catch(error=>{console.error(error);process.exitCode=1;});
