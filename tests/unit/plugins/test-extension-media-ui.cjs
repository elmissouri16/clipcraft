const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-media-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');await fs.mkdir(path.join(source,'src'),{recursive:true});
 await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'studio.media',name:'Generated media proof',publisher:'ClipCraft tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[{id:'make',name:'Create media'}]}}));
 await fs.writeFile(path.join(source,'src/extension.ts'),`const fs=require('node:fs/promises');export async function activate(c:any){
 await c.commands.register('make',async(input:any)=>{const artifact=await c.media.import({path:input.path,name:input.name});await fs.unlink(input.path);return artifact;});
 await c.commands.register('place',(input:any)=>c.media.insert(input));
 await c.commands.register('preview',(input:any)=>c.media.preview(input));
 await c.commands.register('release',(input:any)=>c.media.release(input));
 await c.commands.register('read-captions',(input:any)=>c.captions.read(input));
 await c.commands.register('write-captions',(input:any)=>c.captions.write(input));
 }`);
 const archive=path.join(dir,'media.tgz'),built=await sdk.buildPlugin(source);await sdk.packPlugin(built.directory,archive);
 const tone=path.join(dir,'original.wav');await fs.writeFile(tone,require('../../fixtures/extensionAudio.cjs').wav());
 const png=path.join(dir,'image.png'),video=path.join(dir,'clip.mp4'),ff=require('../../../electron/media/ffmpeg.cjs');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=0x325266:s=64x36','-frames:v','1',png]);
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=0x5b4b71:s=64x36:r=24:d=0.5','-c:v','libx264','-pix_fmt','yuv420p',video]);
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive,tone,png,video}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 for(const reopen of [false,true]){const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-media',FVE_EXTENSION_MEDIA_REOPEN:reopen?'1':'0',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>child.kill('SIGKILL'),90000);const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);await fs.writeFile(path.join(dir,reopen?'reopen-runtime.log':'runtime.log'),log);const result=JSON.parse(await fs.readFile(path.join(dir,reopen?'reopen-result.json':'result.json')));assert.equal(code,0,result.error||log);assert.ok(result.ok);}console.log('Native generated media verified: '+dir);
})().catch(e=>{console.error(e);process.exitCode=1;});
