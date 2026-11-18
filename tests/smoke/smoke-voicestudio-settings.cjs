// The optional extension against a local protocol fixture. Production core has no vendor transport.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), http = require('node:http');

// `seconds` of a quiet tone as VoiceStudio returns it: WAV, 24 kHz, mono, 16-bit.
function wav(seconds) {
  const rate = 24000, n = Math.round(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 6000), 44 + i * 2);
  return b;
}
function pcm(bytes){for(let at=12;at+8<=bytes.length;){const size=bytes.readUInt32LE(at+4);if(bytes.toString('ascii',at,at+4)==='data')return bytes.subarray(at+8,at+8+size);at+=8+size+(size%2);}throw Error('No WAV data');}
// The stand-in VoiceStudio on a free port of this computer.
function standIn() {
  const requests = [], clones=[];let expectedReference=null;
  const server = http.createServer((req, res) => {
    let body = '';const chunks=[];
    req.on('data', (d) => { body += d;chunks.push(d); });
    req.on('end', async () => {
      requests.push({ method: req.method, path: req.url, body });
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/.well-known/voicestudio-speech') return json(200, { schema: 'voicestudio.speech-capabilities', protocol: 'voicestudio.speech.v1', service: 'VoiceStudio', service_version: '0.5.5', local_first: true });
      if (req.url === '/v1/audio/voices') return json(200, { voices: [{ voice_id: 'alloy', name: 'Alloy', type: 'openai_alias' }, { voice_id: 'nova', name: 'Nova', type: 'openai_alias' }, { voice_id: 'demo0001', name: 'Demo Narrator', type: 'profile', language: 'English' },...clones] });
      if (req.url === '/engines/tts') return json(200, { active: 'omnivoice', backends: [{ id: 'omnivoice', display_name: 'VoiceStudio (OmniVoice)', available: true, supports_cloning: true }, { id: 'kittentts', display_name: 'KittenTTS', available: true }, { id: 'mlx-audio', display_name: 'MLX-Audio', available: true }, { id: 'cosyvoice', display_name: 'CosyVoice 3', available: false }] });
      if (req.url === '/models') return json(200, [{ repo_id: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit', label: 'Qwen3-TTS 1.7B 4bit (voice design, mlx-audio)', engines: ['mlx-audio'], installed: true }]);
      if(req.url==='/profiles'&&req.method==='GET')return json(200,[{id:'demo0001',kind:'clone',ref_text:'Reference speech.'},...clones.map(v=>({id:v.voice_id,kind:'clone',ref_text:v.ref_text}))]);
      if(req.url==='/profiles'&&req.method==='POST'){
        const form=await new Request('http://localhost/profiles',{method:'POST',headers:{'content-type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData(),audio=Buffer.from(await form.get('ref_audio').arrayBuffer());
        requests.at(-1).clone={name:form.get('name'),kind:form.get('kind'),transcript:form.get('ref_text'),language:form.get('language'),bytes:audio.length,exact:expectedReference?pcm(audio).equals(expectedReference):audio.equals(wav(2))};
        if(!form.get('ref_text')?.trim())return json(422,{detail:'Matching ref_text is required'});
        clones.push({ref_text:form.get('ref_text'),voice_id:'clone001',name:form.get('name'),type:'profile',language:form.get('language')});return json(200,{id:'clone001',name:form.get('name'),kind:'clone'});
      }
      if (req.url === '/v1/audio/speech' && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        if(b.model==='tts-1'&&b.instruct)return json(500,{detail:'Unsupported instruct items'});
        if (!b.input) return json(500, { detail: 'omnivoice sidecar synthesize error: missing text' });
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        return res.end(wav(Math.max(1.2, b.input.length / 15)));
      }
      json(404, { detail: 'Not Found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ requests, expectReference:bytes=>{expectedReference=bytes;}, url: `127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

module.exports = async (win, app, dir) => {
  const {dialog}=require('electron'),fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixtures.json'))),result={checks:[],errors:[]};
  const original={open:dialog.showOpenDialog,message:dialog.showMessageBox};let approve=false,trustPrompts=0,filePickers=0,agentApprovals=0;
  dialog.showOpenDialog=async()=>{filePickers++;return {canceled:false,filePaths:[fixture.archive]};};
  dialog.showMessageBox=async(_owner,options)=>{if(options.title===require('../../electron/system/i18n.cjs').t('plugins.extension_trust_title'))trustPrompts++;if(options.title===require('../../electron/system/i18n.cjs').t('plugins.agent_command_title'))agentApprovals++;return {response:approve?1:0};};
  const q=s=>win.webContents.executeJavaScript('(async()=>('+s+'))()'),ui=require('./pluginSettingsUi.cjs')(win),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(code,ms=25000)=>{for(let end=Date.now()+ms;Date.now()<end;){if(await q(code))return;await wait(40);}throw Error('Timed out: '+code);};
  const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
  const shot=async name=>fs.writeFileSync(path.join(dir,name),(await win.webContents.capturePage({},{stayHidden:true,stayAwake:true})).toPNG());
  const set=async(selector,value,kind='HTMLInputElement',event='input')=>{await q(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);};
  const clickText=(selector,text)=>q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
  const engine='extension:clipcraft.voicestudio.speech';
  const openTts=async()=>{await q('window.__fve.tab("audio")');await until(`!!document.querySelector('.audio-browser-actions button[aria-label="Text to speech"]')`);await ui.click('.audio-browser-actions button[aria-label="Text to speech"]');await until('!!document.querySelector(".tts")');};
  win.webContents.on('console-message',(_e,level,text)=>{if(level>=3&&!/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text))result.errors.push(text);});
  const ai=require('../../electron/agents/ai.cjs'),originalStep=ai.agentStep,toolResults=[];let turn=0;
  let calls=[{name:'load_tools',args:{groups:['audio']}},{name:'list_voices',args:{}},{name:'add_voiceover',args:{text:'Speech through the installed extension.',start_sec:8}}];
  ai.agentStep=async(_config,opts={})=>{for(const part of opts.contents?.at(-1)?.parts||[])if(part.functionResponse)toolResults.push({name:part.functionResponse.name,result:part.functionResponse.response?.result});const call=calls[turn++];if(call?.name==='run_plugin_command'){call.args.retry_of='previous-failed-tool-call';const project=toolResults.findLast(row=>row.name==='get_project')?.result;if(!project?.audio_track?.[0]?.id)throw Error('Agent received no timeline audio ID');const args=JSON.parse(call.args.arguments_json);args.reference_clip_id=project.audio_track[0].id;call.args.arguments_json=JSON.stringify(args);}return call?{calls:[call],content:{role:'model',parts:[{functionCall:call}]}}:{calls:[],text:'Added the extension voice.',content:{role:'model',parts:[{text:'Added the extension voice.'}]}};};
  require('../../electron/system/settings.cjs').save({provider:'gemini',apiKey:'isolated-extension-voice-test'});
  let studio;
  try {
    if(fixture.live){
      await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await ui.click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
      await openTts();await until('!!document.querySelector("[data-extension-voice-missing]")');await clickText('.tts [data-extension-voice-missing] button','Manage plugins');await until('!!document.querySelector("[data-install-plugin]")');await ui.click('[data-install-plugin]');await until('document.querySelectorAll(".plugin-row").length===1');await ui.click('.plugin-row');approve=true;await ui.click('[data-trust-extension]');await until('(await window.api.pluginsExtensionStatus()).some(e=>e.state==="running")');
      const state=await q('window.api.ttsStatus()'),voice=state.extensions[0]?.voices.find(v=>v.id===fixture.live.voiceId);check('live VoiceStudio exposes the existing cloned voice through the installed plugin',state.extensions[0]?.available&&voice&&!voice.styleRequired&&!voice.description.includes('transcript missing'));check('live voice descriptions specify the supported style contract',voice.description.includes('not free-form delivery prose'));
      await ui.click('button[aria-label="Close settings"]');await until('!!document.querySelector(".tts select[aria-label=Voice]")');check('live clone selection is retained',await q(`document.querySelector('.tts select[aria-label=Voice]').value===${JSON.stringify(fixture.live.voiceId)}`));
      await set('.tts textarea','Hello. This is a short voice test.','HTMLTextAreaElement');await clickText('.tts button','Add to timeline');await until('window.__fve.rawProject().audioClips.length===1',120000);
      const project=await q('window.__fve.rawProject()'),clip=project.audioClips[0],media=project.media.find(m=>m.id===clip.mediaId),info=await require('../../electron/media/ffmpeg.cjs').probe(media.path);result.liveAudio={duration:info.duration,type:info.type,origin:media.origin};check('live synthesis is verified and inserted by the native host',info.type==='audio'&&info.duration>0&&media.origin==='tts'&&fs.existsSync(media.path));check('live insertion is undoable',await q('window.__fve.history().past.length>0'));await q('window.__fve.dispatch({type:"undo"})');await until('window.__fve.rawProject().audioClips.length===0');check('Undo removes only the generated live narration',true);check('live verification stays in an isolated hidden app',!win.isVisible());check('live workflow has no renderer errors',!result.errors.length);await shot('live-clone-speech.png');return;
    }
    if(fixture.restart){
      await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await ui.click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
      const project=JSON.parse(fs.readFileSync(path.join(dir,'voice-project.json')));await q(`window.__fve.load(${JSON.stringify(project)})`);await openTts();await until('!!document.querySelector("[data-extension-voice-missing]")');
      const state=await q('window.api.ttsStatus()');check('cold restart retains the explicit missing-extension voice choice',state.voiceDefault.engine===engine&&!state.extensions.length&&await q('document.querySelector(".tts [role=tab][aria-selected=true]").textContent==="VoiceStudio"'));
      const media=project.media.find(m=>m.origin==='tts'),info=await require('../../electron/media/ffmpeg.cjs').probe(media.path);check('adopted audio remains readable after uninstall and app restart',info.type==='audio'&&info.duration>1&&await q('window.__fve.rawProject().audioClips.length===1'));
      check('missing extension generation fails visibly without substitution',!!(await q(`window.api.ttsSpeak({engine:${JSON.stringify(engine)},voiceId:'demo0001',text:'Must not substitute'})`)).error);
      check('cold restart executes no removed extension',!(await q('window.api.pluginsExtensionStatus()')).length);return;
    }
    studio=await standIn();fs.writeFileSync(path.join(dir,'reference.wav'),wav(2));
    // Seed the historical address before first activation. Migration reads saved settings but never executes code.
    const settingsFile=path.join(dir,'settings-test/settings.json'),settings=JSON.parse(fs.readFileSync(settingsFile));settings.voiceStudio.url='http://'+studio.url;fs.writeFileSync(settingsFile,JSON.stringify(settings));
    win.setContentSize(1440,900);
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await ui.click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    await openTts();await until('!!document.querySelector("[data-extension-voice-missing]")');
    check('missing optional package preserves migrated voice choice with a visible management action',await q(`document.querySelector('.tts [data-extension-voice-missing]').getAttribute('data-extension-voice-missing')===${JSON.stringify(engine)}&&document.querySelector('.tts [role=tab][aria-selected=true]').textContent==='VoiceStudio'&&[...document.querySelectorAll('.tts button')].some(e=>e.textContent==='Manage plugins')`));
    await clickText('.tts [data-extension-voice-missing] button','Manage plugins');await until('!!document.querySelector("[data-install-plugin]")');await ui.click('[data-install-plugin]');await until('document.querySelectorAll(".plugin-row").length===1');await ui.click('.plugin-row');
    check('installing alone runs no Node code and contacts no service',!(await q('window.api.pluginsExtensionStatus()')).length&&studio.requests.length===0);
    await ui.click('[data-trust-extension]');await until('!document.querySelector(".plugin-settings[aria-busy=true]")');check('refusing trust leaves the extension inactive',!(await q('window.api.pluginsExtensionStatus()')).length);
    approve=true;await ui.click('[data-trust-extension]');await until('(await window.api.pluginsExtensionStatus()).some(e=>e.state==="running")');
    const status=await q('window.api.ttsStatus()');
    check('legacy address, enabled state and default voice migrate into the optional extension',status.extensions[0]?.available&&status.voiceDefault.engine===engine&&status.voiceDefault.voice==='demo0001'&&(await q('window.api.pluginsExtensionSettingsRead("clipcraft.voicestudio.settings")')).address==='http://'+studio.url);
    await ui.click('[data-section=speech]');await until(`!!document.querySelector('input[aria-label="VoiceStudio address"]')`);
    check('the extension contributes native Voice settings',await q(`document.querySelector('input[aria-label="Use VoiceStudio"]').checked`));
    // Focus/blur races matter: clicking Test must wait for the pending validated address write.
    await q(`document.querySelector('input[aria-label="VoiceStudio address"]').focus()`);await set('input[aria-label="VoiceStudio address"]',studio.url);
    await ui.reveal('[data-extension-action="clipcraft.voicestudio.test"]');
    const buttonPoint=await q(`(()=>{const r=document.querySelector('[data-extension-action="clipcraft.voicestudio.test"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...buttonPoint});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...buttonPoint});await until('document.querySelector("[data-extension-actions]")?.textContent.includes("3 voices")');
    check('Test waits for the normalized address to be committed',await q(`document.querySelector('input[aria-label="VoiceStudio address"]').value==='http://${studio.url}'`));
    await set('input[aria-label="VoiceStudio address"]','file:///tmp/unsafe');await ui.click('[data-extension-action="clipcraft.voicestudio.test"]');await until('!!document.querySelector("[data-extension-settings] [role=alert]")');
    check('native validation rejects invalid addresses without overwriting the saved address',(await q('window.api.pluginsExtensionSettingsRead("clipcraft.voicestudio.settings")')).address==='http://'+studio.url);
    check('native validation errors show a concise message without source paths or stack traces',await q(`(()=>{const text=document.querySelector('[data-extension-settings] [role=alert]').textContent;return text.startsWith('Enter the VoiceStudio address')&&!text.includes('/var/folders')&&!text.includes('Error invoking')&&!text.includes(' at ')})()`));
    await until(`!document.querySelector('[data-extension-action="clipcraft.voicestudio.test"]').disabled&&!document.querySelector('input[aria-label="VoiceStudio address"]').disabled`);
    await set('input[aria-label="VoiceStudio address"]',studio.url);await ui.click('[data-extension-action="clipcraft.voicestudio.test"]');await until(`!document.querySelector('[data-extension-settings] [role=alert]')&&!document.querySelector('[data-extension-action="clipcraft.voicestudio.test"]').disabled&&document.querySelector('input[aria-label="VoiceStudio address"]').value==='http://${studio.url}'`);await shot('native-voice-settings.png');
    await ui.click('button[aria-label="Close settings"]');await until('document.querySelectorAll(".tts select[aria-label=Voice] option").length===3');
    check('Text to speech discovers the extension voices and the saved selection',await q('document.querySelector(".tts select[aria-label=Voice]").value==="demo0001"'));
    await set('.tts textarea','Hello from the optional extension.','HTMLTextAreaElement');await set('.tts select[aria-label=Voice]','design:mlx-audio','HTMLSelectElement','change');
    check('voice-specific style requirements disable generation until filled',await q(`document.querySelector('.tts input[aria-label="Speech style"]').required&&[...document.querySelectorAll(".tts button")].find(e=>e.textContent.includes("Add to timeline")).disabled`));
    await set('.tts input[aria-label="Speech style"]','Warm narrator, speaking slowly');const before=await q('window.__fve.rawProject().audioClips.length');await clickText('.tts button','Add to timeline');await until(`window.__fve.rawProject().audioClips.length===${before+1}`,90000);
    const added=await q('(()=>{const p=window.__fve.rawProject(),c=p.audioClips.at(-1);return {...c,media:p.media.find(m=>m.id===c.mediaId)}})()');result.added=added;
    check('extension output is verified, adopted and inserted as ordinary audio',added.out-added.in>1&&added.media.origin==='tts'&&added.media.credit.providerName==='VoiceStudio'&&fs.existsSync(added.media.path));
    const speech=studio.requests.filter(r=>r.path==='/v1/audio/speech').map(r=>JSON.parse(r.body));check('vendor protocol and designed-voice mapping execute inside the extension',speech.length===1&&speech[0].model==='mlx-audio'&&speech[0].voice==='alloy'&&speech[0].instruct==='Warm narrator, speaking slowly');
    await shot('extension-speech.png');
    await ui.click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');await set('.pilot-input textarea','Add narration using my default voice.','HTMLTextAreaElement');await until('!document.querySelector("button[aria-label=Send]").disabled');await ui.click('button[aria-label=Send]');await until(`window.__fve.rawProject().audioClips.length===${before+2}&&!!document.querySelector(".pilot-undo")`,90000);
    const listed=toolResults.find(e=>e.name==='list_voices')?.result;result.toolResults=toolResults;
    check('CraftAI discovers the generic extension engine and saved default',listed?.default_engine===engine&&listed.extensions.some(e=>e.engine===engine&&e.available));
    const agentSpeech=studio.requests.filter(r=>r.path==='/v1/audio/speech').map(r=>JSON.parse(r.body));
    check('CraftAI generates with the saved extension voice through the real tool loop',agentSpeech.length===2&&agentSpeech[1].voice==='demo0001'&&await q('window.__fve.rawProject().audioClips.at(-1).start===8'));
    await ui.click('.pilot-undo');await until(`window.__fve.rawProject().audioClips.length===${before+1}`);check('CraftAI Undo preserves manually added extension audio',true);
    const extensionRow=(await q('window.api.pluginsList()')).find(row=>row.manifest?.id==='clipcraft.voicestudio'),pickersBefore=filePickers;
    const timelineReference=await q('(()=>{const p=window.__fve.rawProject(),clip=p.audioClips[0];window.__fve.dispatch({type:"setProject",patch:{audioClips:p.audioClips.map(c=>c.id===clip.id?{...c,in:.37,out:1.67}:c)}});return {id:clip.id,path:p.media.find(m=>m.id===clip.mediaId).path}})()');studio.expectReference(pcm(fs.readFileSync(timelineReference.path)).subarray(Math.round(.37*24000)*2,Math.round(1.67*24000)*2));

    turn=0;calls=[{name:'get_project',args:{scope:'audio'}},{name:'list_plugin_commands',args:{query:'voice box'}},{name:'load_tools',args:{groups:['plugins']}},{name:'run_plugin_command',args:{key:extensionRow.key,command_id:'clone-and-voiceover',arguments_json:JSON.stringify({reference_clip_id:timelineReference.id,name:'Agent clone',transcript:'Reference speech.',language:'English',text:'Narration in the cloned voice.',start_sec:3})}}];
    await set('.pilot-input textarea','Use voice box and clone the voice from the audio in my timeline, then create a voiceover saying “Narration in the cloned voice.” at 3 seconds.','HTMLTextAreaElement');await until('!document.querySelector("button[aria-label=Send]").disabled');await ui.click('button[aria-label=Send]');await until(`window.__fve.rawProject().audioClips.length===${before+2}&&!!document.querySelector(".pilot-undo")`,90000);
    const commandRun=toolResults.findLast(row=>row.name==='run_plugin_command')?.result;result.cloneCommand=commandRun;
    check('CraftAI discovers and executes the combined plugin tool with verified document receipts',!commandRun?.error&&commandRun?.command_id==='clone-and-voiceover'&&commandRun.document_receipts.some(receipt=>receipt.changed)&&commandRun.untrusted_extension_response.voiceId==='clone001');
    const cloned=studio.requests.find(row=>row.path==='/profiles'&&row.method==='POST')?.clone;check('agent cloning resolves a get_project clip ID and uploads only its trimmed audio once',cloned?.name==='Agent clone'&&cloned.kind==='clone'&&cloned.transcript==='Reference speech.'&&cloned.language==='English'&&cloned.exact&&studio.requests.filter(row=>row.path==='/profiles'&&row.method==='POST').length===1);
    const cloneClip=await q('(()=>{const p=window.__fve.rawProject(),clip=p.audioClips.at(-1);return {...clip,media:p.media.find(m=>m.id===clip.mediaId)}})()');check('the returned clone ID generates real verified audio inserted at the requested time',cloneClip.start===3&&cloneClip.out-cloneClip.in>1&&fs.existsSync(cloneClip.media.path)&&(await require('../../electron/media/ffmpeg.cjs').probe(cloneClip.media.path)).type==='audio'&&studio.requests.filter(row=>row.path==='/v1/audio/speech').map(row=>JSON.parse(row.body)).at(-1).voice==='clone001');
    check('agent cloning needs no source path, picker or settings workflow',filePickers===pickersBefore&&!await q('!!document.querySelector("[data-extension-message]")')&&agentApprovals===1);await shot('agent-cloned-voiceover.png');
    await ui.click('.pilot-undo');await until(`window.__fve.rawProject().audioClips.length===${before+1}`);check('one agent Undo removes narration and preserves prior audio and the saved clone',(await q('window.api.ttsStatus()')).extensions[0].voices.some(voice=>voice.id==='clone001')&&(await q('window.api.ttsStatus()')).voiceDefault.voice==='demo0001');
    await ui.click('button[aria-label=Settings]');await until('!!document.querySelector(".settings2")');await ui.click('[data-section=speech]');await until(`!!document.querySelector('input[aria-label="Use VoiceStudio"]')`);check('Voice settings contain no cloning form or action',!await q(`!!document.querySelector('input[aria-label="Cloned voice name"]')||!!document.querySelector('[data-extension-action="clipcraft.voicestudio.clone"]')`));
    await ui.click('input[aria-label="Use VoiceStudio"]');await until('!(await window.api.ttsStatus()).extensions[0].enabled');await ui.click('button[aria-label="Close settings"]');await until('!!document.querySelector("[data-extension-voice-missing]")');
    check('disabled explicitly chosen engine is retained without substitution',(await q('window.api.ttsStatus()')).voiceDefault.engine===engine&&await q('document.querySelector(".tts [role=tab][aria-selected=true]").textContent==="VoiceStudio"'));
    fs.writeFileSync(path.join(dir,'voice-project.json'),JSON.stringify(await q('window.__fve.rawProject()')));
    // Removal cleans all native UI registrations while adopted media survives.
    await ui.click('button[aria-label=Settings]');await until('!!document.querySelector(".settings2")');await ui.click('[data-section=plugins]');await until('!!document.querySelector(".plugin-row")');await ui.click('.plugin-row');await ui.click('[data-remove-plugin]');await ui.click('[data-confirm-remove-plugin]');await until('document.querySelectorAll(".plugin-row").length===0');
    check('removing the package disposes its process and all native UI',(await q('window.api.pluginsExtensionUi("settings.voice")')).length===0&&!(await q('window.api.pluginsExtensionStatus()')).length);
    check('removal preserves the saved default and adopted audio',(await q('window.api.ttsStatus()')).voiceDefault.engine===engine&&fs.existsSync(added.media.path));
    check('trust is requested only for the two explicit trust attempts',trustPrompts===2);check('verification keeps the native app hidden',!win.isVisible());check('no renderer errors',!result.errors.length);
  } catch(error){result.error=error.stack;await shot('failure.png').catch(()=>{});}
  finally {ai.agentStep=originalStep;await studio?.close().catch(()=>{});dialog.showOpenDialog=original.open;dialog.showMessageBox=original.message;fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);}
};
