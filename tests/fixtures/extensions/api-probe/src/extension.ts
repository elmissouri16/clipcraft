// Test fixture: one extension that calls the whole public context and returns what each call
// produced (tests/unit/plugins/test-extension-api-ui.cjs asserts on the record).
import type {ExtensionContext,EditorSnapshot,ClipTransaction,EditorToolCall} from '@clipcraft/plugin-sdk/extension';
import {defineServiceContract} from '@clipcraft/plugin-sdk/extension';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';

const contract=defineServiceContract({version:1,methods:{
  shout:{input:{type:'string',maxLength:100},output:{type:'string'}},
  count:{input:{type:'integer',minimum:0,maximum:5},output:{type:'integer'},stream:true},
}});

export async function activate(context:ExtensionContext){
  const seen:string[]=[];let captured:EditorSnapshot|undefined;
  const step=async<T>(work:()=>Promise<T>)=>{try{return {ok:true,value:await work()};}catch(error){return {ok:false,error:(error as Error).message};}};
  for(const name of ['project.changed','selection.changed','playback.changed','configuration.changed'] as const){
    const sub=context.events.on(name,()=>{seen.push(name);});await sub.ready;context.subscriptions.push(sub);
  }
  await context.services.registerTyped('text',contract,{shout:text=>text.toUpperCase(),async *count(n){for(let i=0;i<n;i++)yield i;}});
  await context.ui.registerSettings({id:'main',title:'Probe',location:'settings.plugins',fields:[
    {key:'label',label:'Label',type:'string',default:'hello'},
    {key:'amount',label:'Amount',type:'number',default:3,min:0,max:10,step:1},
    {key:'token',label:'Token',type:'secret'},
    {key:'mode',label:'Mode',type:'select',options:[{label:'One',value:'one'},{label:'Two',value:'two'}]},
  ]});
  for(const location of ['toolbar','inspector','context','export','settings.plugins'] as const)
    await context.ui.registerAction({id:'act-'+location.replace('.','-'),title:'Probe '+location,location,command:'hello'});
  await context.ui.registerShortcut({id:'hello-key',title:'Probe hello',command:'hello',keys:['Alt+Shift+P']});
  await context.commands.register('hello',async()=>({message:'Hello from probe.'}));
  await context.commands.register('seen',async()=>seen.slice());
  await context.commands.register('picker-job',()=>context.jobs.run('Picker survival',async({signal})=>{
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,2500);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Picker canceled job'));},{once:true});});return 'completed';
  }));
  await context.commands.register('hardening',async()=>({
    hook:await step(()=>context.hooks.register('project.typo' as never,()=>{})),
    integration:await step(()=>context.ui.registerIntegration({id:'typo',title:'Typo',point:'voice.typo' as never,service:'speech'})),
    invalid:await step(()=>context.configuration.update({key:'invalid',value:{number:NaN}})),
    mode:await context.configuration.get('mode'),
  }));

  await context.commands.register('basics',async()=>({
    host:await step(()=>context.host.read()),
    capabilities:await step(()=>context.host.capabilities()),
    workspace:await step(()=>context.workspace.read()),
    editor:await step(()=>context.editor.read()),
    tracks:await step(()=>context.workspace.inspect({section:'tracks'})),
    clips:await step(()=>context.workspace.inspect({section:'clips',limit:50})),
    media:await step(()=>context.workspace.inspect({section:'media'})),
    defaults:await step(async()=>({label:await context.configuration.get('label'),amount:await context.configuration.get('amount')})),
    configSet:await step(()=>context.configuration.update({key:'label',value:'changed'})),
    configGet:await step(()=>context.configuration.get('label')),
    secret:await step(async()=>{await context.secrets.store({key:'token',value:'s3cret'});const value=await context.secrets.get('token');await context.secrets.delete('token');return {value,after:await context.secrets.get('token')};}),
    service:await step(async()=>{const client=await context.services.connect('fixture.api-probe.text',contract);const out:string=await client.call('shout','abc');const items:number[]=[];for await(const n of client.stream('count',3))items.push(n);return {out,items};}),
    command:await step(()=>context.commands.execute('fixture.api-probe.hello')),
    emit:await step(()=>context.events.emit('custom',{a:1})),
    job:await step(()=>context.jobs.run('Probe job',async job=>{await job.progress(0.5,'half');return 'done';})),
    process:await step(async()=>{const p=await context.processes.spawn({file:process.execPath,args:['-e','console.log(6*7)'],timeoutMs:20000,env:{ELECTRON_RUN_AS_NODE:'1'}});const r=await p.result;return {code:r.code,stdout:r.stdout.trim()};}),
  }));

  await context.commands.register('edits',async()=>{
    const out:Record<string,unknown>={};
    let snap=await context.editor.read();
    const clip=snap.timeline.clips.find(c=>!c.gap&&c.main)!;
    out.opacity=await step(()=>context.editor.apply({documentId:snap.documentId,revision:snap.revision,operations:[{type:'set-opacity',clipId:clip.id,partnerClipId:null,opacity:0.5}]}));
    out.stale=await step(()=>context.editor.apply({documentId:snap.documentId,revision:snap.revision,operations:[{type:'set-opacity',clipId:clip.id,partnerClipId:null,opacity:1}]}));
    snap=await context.editor.read();
    const text=snap.timeline.tracks.find(t=>t.lane==='text')!;
    out.createText=await step(()=>context.editor.apply({documentId:snap.documentId,revision:snap.revision,operations:[{type:'create-text',trackId:text.id,start_sec:0.5,duration_sec:1.5,text:'Probe title'}]}));
    const scope=await context.workspace.inspect({section:'markers'});
    out.marker=await step(()=>context.markers.apply({documentId:scope.documentId,projectRevision:scope.projectRevision,operations:[{type:'add',time_sec:1,label:'Probe'}]}));
    const caps=await context.captions.read();
    out.captions=await step(()=>context.captions.write({documentId:caps.documentId,revision:caps.revision,mode:'create-track',newTrack:{name:'Probe captions'},cues:[{text:'Hello',start_sec:0,end_sec:1},{text:'World',start_sec:1,end_sec:2}]}));
    out.captionsTrack=await step(()=>context.captions.read({trackId:(out.captions as {value?:{trackId?:string}}).value?.trackId}));
    const again=await context.captions.read();
    out.overlap=await step(()=>context.captions.write({documentId:again.documentId,revision:again.revision,mode:'append',cues:[{text:'Clash',start_sec:0.6,end_sec:1}]}));
    return out;
  });

  // The launcher moves the playhead and the selection between these two commands.
  await context.commands.register('capture',async()=>{captured=await context.editor.read();return captured.revision;});
  await context.commands.register('apply-captured',async()=>{
    const snap=captured!,clip=snap.timeline.clips.find(c=>!c.gap&&c.main)!,transaction:ClipTransaction={documentId:snap.documentId,revision:snap.revision,operations:[{type:'set-opacity',clipId:clip.id,partnerClipId:null,opacity:0.8}]};
    return {captured:snap.revision,current:(await context.editor.read()).revision,applied:await step(()=>context.editor.apply(transaction))};
  });

  await context.commands.register('media',async(input:{dir:string})=>{
    const out:Record<string,unknown>={},host=await context.host.read(),png=join(input.dir,'probe.png'),damaged=join(input.dir,'damaged.png');
    const made=await context.processes.spawn({file:host.tools.ffmpeg,args:['-v','error','-y','-f','lavfi','-i','color=red:s=64x64','-frames:v','1',png],timeoutMs:30000});
    out.made=(await made.result).code;
    await writeFile(damaged,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNBgAAEnHB/kK8pQ3AAAAAElFTkSuQmCC','base64'));
    out.damaged=await step(()=>context.media.import({path:damaged}));
    const item=await step(()=>context.media.import({path:png,name:'Probe still'}));out.import=item;
    if(item.ok&&item.value){
      const inserted=await step(()=>context.media.insert({id:item.value!.id,trackId:'overlay:0',start_sec:0}));out.insert=inserted;
      const handle=(inserted.value as {handle?:string}|undefined)?.handle;
      if(handle){const snap=await context.editor.read({clipIds:[handle]});out.useHandle=await step(()=>context.editor.apply({documentId:snap.documentId,revision:snap.revision,operations:[{type:'set-opacity',clipId:handle,partnerClipId:null,opacity:0.5}]}));}
      out.occupied=await step(()=>context.media.insert({id:item.value!.id,trackId:'overlay:0',start_sec:0}));
    }
    const note=join(context.extension.storagePath,'note.txt');await writeFile(note,'published');
    out.publish=await step(()=>context.files.publish({path:note,destination:join(input.dir,'published.txt')}));
    out.publishAgain=await step(()=>context.files.publish({path:note,destination:join(input.dir,'published.txt')}));
    out.published=await step(()=>readFile(join(input.dir,'published.txt'),'utf8'));
    return out;
  });

  await context.commands.register('export',async(input:{dir:string})=>step(()=>context.exports.render({file_path:join(input.dir,'probe-export.mp4'),quality:'low',range:{start_sec:0,end_sec:1},showCompletion:false})));

  await context.commands.register('view',async()=>{
    const view=await context.ui.registerView({id:'panel',title:'Probe panel',entry:'assets/panel.html'});
    const got:unknown[]=[];view.onMessage(value=>{got.push(value);});
    const revealed=await view.reveal(),early=await view.postMessage({hello:'early'});
    await new Promise(resolve=>setTimeout(resolve,2500));
    await context.commands.register('view-inspect',async()=>{await view.postMessage({inspect:true});await new Promise(resolve=>setTimeout(resolve,100));return got.slice();});
    const inline=await context.ui.registerView({id:'inline',title:'Inline script',entry:'assets/inline.html'});
    const inlineGot:unknown[]=[];inline.onMessage(value=>{inlineGot.push(value);});await inline.reveal();
    await new Promise(resolve=>setTimeout(resolve,2000));
    return {revealed,early,got,inlineGot};
  });

  await context.commands.register('tools-list',async()=>(await context.editor.tools.list()).map(tool=>tool.name));
  await context.commands.register('tools-run',async(input:{calls:EditorToolCall[];atomic?:boolean})=>step(()=>context.editor.tools.run(input.calls,{atomic:input.atomic})));
}
