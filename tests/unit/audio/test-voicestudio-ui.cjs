// Install the optional Node extension through the actual Plugins UI, then exercise
// native Voice settings, Text to speech, missing packages and legacy preferences.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-voicestudio-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');
 await fs.cp(path.join(root,'examples/extensions/voicestudio'),source,{recursive:true});await fs.rm(path.join(source,'dist'),{recursive:true,force:true});
 const built=await sdk.buildPlugin(source),archive=path.join(dir,'voicestudio.tgz');await sdk.packPlugin(built.directory,archive);
 const live=process.env.CLIPCRAFT_VOICESTUDIO_LIVE==='1'?{address:process.env.CLIPCRAFT_VOICESTUDIO_ADDRESS||'http://127.0.0.1:3900',voiceId:process.env.CLIPCRAFT_VOICESTUDIO_VOICE_ID}:null;if(live)assert.ok(live.voiceId,'Choose an existing clone ID for live verification');
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive,...(live?{live}:{})}));await fs.mkdir(path.join(dir,'settings-test'));
 await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true},voiceDefault:{engine:'voicestudio',voice:live?.voiceId||'demo0001'},voiceStudio:{enabled:true,url:live?.address||'http://127.0.0.1:3900'}}));
 for(const phase of (live?['initial']:['initial','restart'])){
  if(phase==='restart')await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive,restart:true}));
  const child=spawn(process.env.ELECTRON_BIN||require('electron'),['--no-sandbox',root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'tts',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>child.kill('SIGKILL'),180000);
  const code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,phase+'-runtime.log'),log);
  const text=await fs.readFile(path.join(dir,'result.json'),'utf8');await fs.writeFile(path.join(dir,phase+'-result.json'),text);const result=JSON.parse(text);assert.equal(code,0,result.error||log);assert.ok(!result.error,result.error);
 }
 console.log('Optional VoiceStudio native UI passed; evidence: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
