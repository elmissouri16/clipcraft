const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-native-controls-ui-')),source=path.join(dir,'source');console.log('Native controls evidence: '+dir);
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();await fs.cp(path.join(root,'examples/extensions/native-properties'),source,{recursive:true});
 const entry=path.join(source,'src/extension.ts');let body=await fs.readFile(entry,'utf8');body=body.slice(0,body.lastIndexOf('}'))+`
 await context.ui.registerAction({id:'last',title:'Last action',location:'toolbar',command:'reset-opacity',order:300});
 await context.ui.registerAction({id:'middle',title:'Middle action',location:'toolbar',command:'reset-opacity',order:200});
 await context.ui.registerAction({id:'context-reset',title:'Context reset',location:'context',command:'reset-opacity',enabled:false,disabledReason:'Fixture context disabled',icon:{paths:['M4 4 L20 20 M20 4 L4 20']}});
 for(const location of ['export','inspector','settings.plugins','settings.voice'] as const)await context.ui.registerAction({id:'disabled-'+location.replace('.','-'),title:'Disabled '+location+(location==='settings.plugins'?' '+ 'x'.repeat(120):''),location,command:'reset-opacity',enabled:false,disabledReason:'Fixture action disabled',icon:{paths:['M3 12 L12 3 L21 12 L12 21 Z']}});
 await context.commands.register('state',(input:any)=>action.update(input));
 await context.commands.register('remove-picture',()=>picture.dispose());
 await context.commands.register('replace-picture',async()=>{await picture.dispose();await context.ui.registerInspector({id:'picture',title:'Replacement properties',lanes:['video'],fields:[{key:'opacity',label:'Opacity',property:'opacity',type:'number'}]});});
}\n`;await fs.writeFile(entry,body);
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),built=await sdk.buildPlugin(source),archive=path.join(dir,'controls.tgz');await sdk.packPlugin(built.directory,archive);
 const ff=require('../../../electron/media/ffmpeg.cjs'),file=path.join(dir,'source.mp4');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=0x6398ba:s=320x180:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);
 const project={id:'native-controls',name:'Native controls',width:320,height:180,fps:24,media:[{...await ff.probe(file),id:'media',path:file,name:'Source'}],videoClips:[{id:'v1',mediaId:'media',in:0,out:4,speed:1,opacity:.8,transform:{x:.1},transition:null},{id:'v2',mediaId:'media',in:0,out:4,speed:1,opacity:.6,transition:null}],overlayClips:[],audioClips:[],textClips:[{id:'title',text:'Original title',start:0,duration:2,font:'montserrat',size:64,color:'#ffffff'}],effectClips:[],stickerClips:[],markers:[]};
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive,project,key:built.key}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 for(const phase of [0,1]){
  const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-native-controls',FVE_NATIVE_CONTROLS_REOPEN:String(phase),FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,phase?'reopen-runtime.log':'runtime.log'),log);
  const file=path.join(dir,phase?'reopen-result.json':'result.json'),result=await fs.readFile(file).then(JSON.parse).catch(()=>({ok:false,error:log||'No native result'}));assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error);
 }
 console.log('Native controls verified in two app processes: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
