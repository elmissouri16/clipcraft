// Real-app proof of the public extension context: one fixture extension calls every namespace in
// the actual editor (tests/smoke/smoke-extension-api.cjs) and this suite checks what came back,
// including the editor tool bridge, edits surviving playhead/selection changes, media placement,
// view script errors reaching the log and extensions returning after a catalog change.
// Usage: node tests/unit/plugins/test-extension-api-ui.cjs
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-api-ui-')),source=path.join(dir,'source');
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs');
 await fs.cp(path.join(root,'tests/fixtures/extensions/api-probe'),source,{recursive:true});
 await fs.mkdir(path.join(source,'node_modules/@clipcraft'),{recursive:true});await fs.symlink(path.join(root,'packages/plugin-sdk'),path.join(source,'node_modules/@clipcraft/plugin-sdk'),'dir');
 const built=await sdk.buildPlugin(source),archive=path.join(dir,'api-probe.tgz');await sdk.packPlugin(built.directory,archive);
 const ff=require('../../../electron/media/ffmpeg.cjs'),clip=path.join(dir,'source.mp4');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',clip]);
 const project={id:'api-probe',name:'API probe',width:640,height:360,fps:30,ratio:'16:9',background:'#000000',media:[{...await ff.probe(clip),id:'m',path:clip,name:'source.mp4'}],
  videoClips:[{id:'v',mediaId:'m',in:0,out:4,speed:1,volume:1,muted:false,filter:'none',adjust:{},effects:[],transition:null}],overlayClips:[],audioClips:[],textClips:[],stickerClips:[],effectClips:[],markers:[]};
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive,id:'fixture.api-probe',project}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-api',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',value=>log+=value);child.stderr.on('data',value=>log+=value);
 const timer=setTimeout(()=>child.kill('SIGKILL'),240000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);
 const result=await fs.readFile(path.join(dir,'result.json')).then(JSON.parse).catch(()=>({ok:false,error:log||'App exited before producing evidence'}));
 assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error);
 const checks=[],check=(name,value,detail)=>{assert.ok(value,name+(detail===undefined?'':': '+JSON.stringify(detail)));checks.push(name);},value=label=>{const run=result.runs[label];assert.ok(run&&!run.error,label+': '+run?.error);return run.value;};

 const basics=value('basics');
 for(const [name,step] of Object.entries(basics))check('basics.'+name+' succeeds',step.ok,step);
 check('the host advertises editor tools',basics.capabilities.value.features['editor.tools']===1);
 check('declared setting defaults are readable before any edit',basics.defaults.value.label==='hello'&&basics.defaults.value.amount===3,basics.defaults.value);
 check('configuration and secrets round-trip',basics.configGet.value==='changed'&&basics.secret.value.value==='s3cret'&&basics.secret.value.after===undefined);
 check('typed service call and stream',basics.service.value.out==='ABC'&&basics.service.value.items.join()==='0,1,2');
 check('a custom topic is published under the package ID',basics.emit.value.name==='fixture.api-probe.custom');
 check('a managed process returns its output',basics.process.value.code===0&&basics.process.value.stdout==='42');

 const hardened=value('hardening');
 check('unknown hooks and integration points reject in the actual extension host',!hardened.hook.ok&&/Unsupported document hook/.test(hardened.hook.error)&&!hardened.integration.ok&&/Unsupported UI integration/.test(hardened.integration.error),hardened);
 check('invalid JSON rejects and the select default is readable in the real app',!hardened.invalid.ok&&/finite JSON/.test(hardened.invalid.error)&&hardened.mode==='one',hardened);

 const edits=value('edits');
 check('editor.apply edits a clip',edits.opacity.ok&&edits.createText.ok,edits);
 check('a revision from before a document change is stale',!edits.stale.ok&&/stale/.test(edits.stale.error),edits.stale);
 check('markers and a new caption track are written',edits.marker.ok&&edits.captions.value.written===2&&edits.captionsTrack.value.total===2,edits);
 check('a cue over an existing clip is refused',!edits.overlap.ok&&/overlaps a clip already on this track/.test(edits.overlap.error),edits.overlap);

 const captured=value('applyCaptured');
 check('an edit captured before the playhead and selection moved still applies',captured.current>captured.captured&&captured.applied.ok,captured);

 const media=value('media');
 check('a damaged picture is refused at import',!media.damaged.ok&&/damaged or is not a readable image/.test(media.damaged.error),media.damaged);
 check('media.insert places the clip on the named track and returns a usable handle',media.insert.ok&&media.insert.value.lane==='overlay'&&/^c-\d+$/.test(media.insert.value.handle)&&media.useHandle.ok,media);
 check('an occupied track refuses a second clip at the same time',!media.occupied.ok&&/track is occupied/.test(media.occupied.error),media.occupied);
 check('files.publish publishes once and refuses to overwrite',media.publish.ok&&media.published.value==='published'&&!media.publishAgain.ok);
 const exported=value('export');
 check('exports.render produces a verified file with the inserted picture in the project',exported.ok&&exported.value.metadata.duration_sec===1&&exported.value.size>1000,exported);

 const view=value('view');
 check('a view exchanges messages with its extension, including one posted before it finished loading',view.revealed&&view.got.some(m=>m.info==='fixture.api-probe.panel')&&view.got.some(m=>m.echo?.hello==='early'),view);
 const initial=view.got.find(message=>message.info==='fixture.api-probe.panel');
 check('view assets accept cache query strings and sandboxed WebAssembly compiles',initial?.asset&&initial.wasm,initial);
 check('the first getInfo returns the actual editor theme',JSON.stringify(initial?.initialTheme)===JSON.stringify(result.expectedTheme),{initial,expected:result.expectedTheme});
 const same=value('sameTheme').filter(message=>message.inspected).at(-1);
 const changed=value('changedTheme'),last=changed.filter(message=>message.inspected).at(-1),notification=changed.filter(message=>message.themeChange).at(-1);
 check('layout without a colour change does not notify theme listeners',same.changes===0,same);
 check('a changed theme is delivered once and getInfo stays current',last.changes===1&&last.theme.accent==='#123456'&&notification.theme.accent===notification.infoTheme.accent,{last,notification});
 const logs=result.viewStatus.find(row=>row.id==='fixture.api-probe').logs.map(line=>JSON.stringify(line)).join('\n');
 check('a blocked inline view script is reported in the extension log',view.inlineGot.length===0&&/View fixture\.api-probe\.inline: .*inline script/i.test(logs),logs.slice(0,600));

 const tools=value('toolsList');
 check('the editor tool list is offered without agent bookkeeping or project management',tools.length>=50&&['add_text','add_transition','set_filter','set_color','add_keyframes','set_project'].every(name=>tools.includes(name))&&!['complete_edit','run_plugin_command','open_project','undo'].some(name=>tools.includes(name)),tools);
 const batch=value('toolsBatch');
 check('a tool batch applies as one Undo step',batch.ok&&batch.value.changed&&batch.value.results.length===4&&result.runs.toolsBatch.history===result.toolsBefore+1,{batch,before:result.toolsBefore,after:result.runs.toolsBatch.history});
 check('the batch changed text, filter and project settings',result.afterBatch.texts.includes('From an extension')&&result.afterBatch.filter==='bw'&&result.afterBatch.background==='#102030',result.afterBatch);
 const rolled=value('toolsRolledBack');
 check('a failing call rolls an atomic batch back completely',!rolled.ok&&/Nothing from this run was kept/.test(rolled.error)&&result.runs.toolsRolledBack.history===result.runs.toolsBatch.history&&!result.afterRollback.texts.includes('Rolled back')&&result.afterRollback.future===0,{rolled,after:result.afterRollback});
 const partial=value('toolsPartial');
 check('a non-atomic batch reports each result and keeps what succeeded',partial.ok&&!!partial.value.results[0].error&&!partial.value.results[1].error&&result.runs.toolsPartial.history===result.runs.toolsBatch.history+1,partial);
 check('excluded and invalid calls are refused before anything is written',/Unknown editor tool/.test(value('toolsRefused').error)&&/add_text \(call 1\)/.test(value('toolsInvalid').error)&&result.runs.toolsInvalid.history===result.runs.toolsPartial.history);
 check('Undo removes each batch as one step',!result.afterUndo.texts.includes('Kept')&&!result.afterUndo.texts.includes('From an extension')&&result.afterUndo.filter==='none'&&result.afterUndo.background==='#000000'&&result.afterUndo.history===result.toolsBefore-0,result.afterUndo);

 check('a canceled install leaves the extension running with its toolbar action',result.canceledInstall===null&&result.afterCatalogChange.toolbar.includes('fixture.api-probe.act-toolbar')&&result.afterCatalogChange.hello.value?.message==='Hello from probe.',result.afterCatalogChange);
 check('both canceled install pickers preserve the live activation and running job',result.pickers.length===2&&result.pickers.every(row=>row?.generation===result.beforePicker.generation&&row.state==='running'&&row.jobs.length>0),result.pickers);
 check('the managed job completes after both pickers are canceled',value('pickerJob')==='completed');
 check('actual disable removes the activation before re-enable restores its actions',!result.disabledStatus.some(row=>row.id==='fixture.api-probe'));
 for(const location of ['toolbar','inspector','context','export','settings.plugins'])check('an action is registered at '+location,result.ui[location].length===1,result.ui[location]);
 check('the extension observed document, selection and playback events',['project.changed','selection.changed','playback.changed','configuration.changed'].every(name=>value('seen').includes(name)),[...new Set(value('seen'))]);
 check('the rendered settings select agrees with configuration.get',result.renderedSelect.visible&&result.renderedSelect.value==='one',result.renderedSelect);
 check('native settings reject an off-step number and retain the saved value',/step/.test(result.offStep.error)&&result.amountAfterRefusal.amount===3,{refusal:result.offStep,settings:result.amountAfterRefusal});
 check('the renderer logged no error',result.errors.length===0,result.errors);
 console.log(`Extension API verified in the real app (${checks.length} checks): ${dir}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
