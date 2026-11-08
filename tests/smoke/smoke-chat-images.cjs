const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const untilFn = async (fn, name) => { for (let i = 0; i < 500; i++) { if (await fn()) return; await wait(50); } throw Error('Timeout: ' + name); };
  const until = code => untilFn(() => q(code), code);
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = text => q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const result = { checks: [], formats: [], errors: [] }, check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), (await win.capturePage()).toPNG());
  const settings = require('../../electron/system/settings.cjs'), local = require('../../electron/agents/localAgents.cjs'), { dialog } = require('electron');
  const { ffmpegPath } = require('../../electron/media/ffmpeg.cjs');
  const original = { run: local.runEditorNative, status: local.status, dialog: dialog.showOpenDialog };
  const source = path.join(dir, 'reference.png');
  execFileSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x4376bb:s=320x180', '-frames:v', '1', source]);
  const formats = ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'ico'];
  for (const extension of formats.filter(ext => ext !== 'png')) {
    const file = path.join(dir, 'reference.' + extension);
    execFileSync(ffmpegPath, ['-v', 'error', '-i', source, '-vf', extension === 'ico' ? 'scale=64:64' : 'hue=h=' + formats.indexOf(extension) * 20, '-frames:v', '1', ...(extension === 'avif' ? ['-c:v', 'libaom-av1', '-cpu-used', '8', '-still-picture', '1'] : []), file]);
  }
  fs.writeFileSync(path.join(dir, 'reference.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#8457d9"/><circle cx="120" cy="80" r="40" fill="#f2b34c"/></svg>');
  formats.push('svg');
  // A valid, uncompressed RGB PSD exercises the layered-image decoder.
  const psd = Buffer.alloc(26 + 12 + 2 + 3 * 16 * 16); psd.write('8BPS'); psd.writeUInt16BE(1, 4); psd.writeUInt16BE(3, 12); psd.writeUInt32BE(16, 14); psd.writeUInt32BE(16, 18); psd.writeUInt16BE(8, 22); psd.writeUInt16BE(3, 24); psd.fill(160, 40); fs.writeFileSync(path.join(dir, 'reference.psd'), psd); formats.push('psd');
  if (process.platform === 'darwin') { execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', source, '--out', path.join(dir, 'reference.heic')], { stdio: 'pipe' }); formats.push('heic'); }
  fs.writeFileSync(path.join(dir, 'brief.txt'), 'Not an image');
  const transparent = path.join(dir, 'transparent.png'), rgba = Buffer.alloc(40 * 40 * 4);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) rgba[(y * 40 + x) * 4 + 3] = 255;
  fs.writeFileSync(transparent, require('electron').nativeImage.createFromBitmap(rgba, { width: 40, height: 40 }).toPNG());
  let selected = [], pickerResolve;
  dialog.showOpenDialog = async () => selected === 'delay' ? new Promise(resolve => { pickerResolve = resolve; }) : { canceled: false, filePaths: selected };
  const runs = [];
  local.status = async () => ({ ok: true, authenticated: true });
  local.runEditorNative = async (_config, options) => {
    let release; const entry = { options, done: false, gate: new Promise(resolve => { release = resolve; }) }; entry.release = release; runs.push(entry);
    for (const image of options.images) { const bytes = fs.readFileSync(image.path); assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); }
    await Promise.race([entry.gate, new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Stopped')), { once: true }))]);
    const output = await options.onTool('complete_edit', {}); assert.ok(JSON.parse(output.content[0].text).ready);
    entry.done = true; return { text: 'The attached reference images were received.' };
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true }); settings.save({ provider: 'codex-sdk' });
  win.webContents.setBackgroundThrottling(false); win.setContentSize(1400, 900);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await click('.home-frame-card');
    await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()'); await click('.workspace-switch button:last-child');
    await until('!document.querySelector(".pilot-input textarea").disabled');
    selected = formats.slice(0, 6).map(ext => path.join(dir, 'reference.' + ext)); await click('button[aria-label="Attach images or reference videos"]');
    await until('document.querySelectorAll(".pilot-image-attachments .pilot-image img").length===6');
    check('picker attaches six image formats with real thumbnails', await q('!document.querySelector(".pilot-image-error")'));
    result.formats.push(...formats.slice(0, 6));
    check('reference-only drafts qualify for project autosave', await q('window.__fve.rawProject().craftAI.sessions[0].images.length===6'));
    await type('Use these image references'); await click('.pilot-input .send'); await untilFn(() => runs.length === 1, 'first image request');
    check('native provider receives six decoded JPEG image files', runs[0].options.images.length === 6);
    check('sent messages keep image thumbnails and clear pending attachments', await q('document.querySelectorAll(".pilot-msg.user .pilot-image").length===6&&!document.querySelector(".pilot-image-attachments")'));
    selected = formats.slice(6).map(ext => path.join(dir, 'reference.' + ext)); await click('button[aria-label="Attach images or reference videos"]');
    await until(`document.querySelectorAll('.pilot-image-attachments .pilot-image img').length===${selected.length}&&!document.querySelector('.pilot-image-loading')`);
    check('AVIF, ICO, SVG, PSD and platform HEIC decode successfully', await q('!document.querySelector(".pilot-image-error")'));
    result.formats.push(...formats.slice(6));
    await click('.pilot-input .send'); await until('document.querySelectorAll(".pilot-queue-item").length===1');
    check('image-only messages can be queued while the agent runs', await q('document.querySelector(".pilot-queue-item").textContent.includes("Review the attached images")'));
    const queuedCount = selected.length;
    check('each queued message keeps its image references', await q(`document.querySelectorAll('.pilot-queue-item .pilot-image').length===${queuedCount}`));
    runs[0].release(); await untilFn(() => runs.length === 2, 'queued image request');
    check('queue sends its own images and receives prior visual context separately', runs[1].options.images.length === queuedCount && runs[1].options.historyImages.length === 6 - queuedCount);
    runs[1].release(); await until('!document.querySelector("button[aria-label=Stop]")');
    // Clipboard and drag/drop use actual renderer File bytes and real main-process decoding.
    const base64 = fs.readFileSync(source).toString('base64');
    const transfer = name => `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0)),d=new DataTransfer();d.items.add(new File([bytes],${JSON.stringify(name)},{type:'image/png'}));return d})()`;
    await q(`document.querySelector('.pilot-input textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:${transfer('Pasted.png')},bubbles:true,cancelable:true}))`);
    await until('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===1&&!document.querySelector(".pilot-image-loading")');
    check('pasted screenshot is attached with a preview', await q('!!document.querySelector(".pilot-image-attachments img")'));
    await click('.pilot-image-attachments .pilot-image-remove');
    await q(`(()=>{const d=${transfer('Dropped.png')},p=document.querySelector('.pilot-panel');p.dispatchEvent(new DragEvent('dragover',{dataTransfer:d,bubbles:true,cancelable:true}));p.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
    await until('document.querySelectorAll(".pilot-image-attachments .pilot-image img").length===1&&!document.querySelector(".pilot-image-loading")');
    check('dropping an image into chat does not import timeline media', await q('window.__fve.rawProject().media.length===0&&!document.querySelector(".drop-overlay")'));
    await click('.workspace-switch button:first-child'); await click('.pilot-fab'); await click('button[title="Expand to Agent mode"]');
    check('image drafts survive changing workspaces', await q('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===1'));
    await q('window.__imageProject=structuredClone(window.__fve.rawProject());window.__fve.load(window.__imageProject)');
    await until('!!document.querySelector(".pilot-image-attachments img")');
    check('image-only draft restores from project data', await q('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===1'));
    selected = [path.join(dir, 'brief.txt')]; await click('button[aria-label="Attach images or reference videos"]'); await until('!!document.querySelector(".pilot-image-error")');
    check('non-images are rejected without losing existing attachments', await q('document.querySelector(".pilot-image-error").textContent.includes("not supported")&&document.querySelectorAll(".pilot-image-attachments .pilot-image").length===1'));
    await click('button[aria-label="Dismiss attachment error"]');
    selected = [transparent]; await click('button[aria-label="Attach images or reference videos"]'); await until('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===2&&!document.querySelector(".pilot-image-loading")');
    const transparentId = await q('window.__fve.rawProject().craftAI.sessions[0].images.find(image=>image.name==="transparent.png").id');
    const pixel = require('electron').nativeImage.createFromPath(path.join(dir, 'chat-images', transparentId, 'image.jpg')).toBitmap();
    check('transparent references retain visible artwork on a white preview', pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240 && pixel[(20 * 40 + 20) * 4] < 20);
    await click('button[aria-label="Remove image transparent.png"]');
    // Fill all attachment slots, queue a second image message and keep a tall draft.
    selected = formats.slice(0, 6).map(ext => path.join(dir, 'reference.' + ext)); await click('button[aria-label="Attach images or reference videos"]');
    await until('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===6&&!document.querySelector(".pilot-image-loading")');
    await type('Hold this request'); await click('.pilot-input .send'); await untilFn(() => runs.length === 3, 'layout request');
    await click('button[aria-label="Attach images or reference videos"]'); await until('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===6&&!document.querySelector(".pilot-image-loading")'); await type('Queued image edit'); await click('.pilot-input .send');
    await click('button[aria-label="Attach images or reference videos"]'); await until('document.querySelectorAll(".pilot-image-attachments .pilot-image").length===6&&!document.querySelector(".pilot-image-loading")'); await type('A multiline draft\n'.repeat(8));
    for (const [w, h] of [[1400, 900], [1000, 640]]) {
      win.setContentSize(w, h); await wait(200);
      const geometry = await q('(()=>{const p=document.querySelector(".pilot-panel").getBoundingClientRect(),i=document.querySelector(".pilot-input").getBoundingClientRect(),s=document.querySelector(".pilot-input .send").getBoundingClientRect(),l=document.querySelector(".pilot-list").getBoundingClientRect();return {panel:p.toJSON(),input:i.toJSON(),send:s.toJSON(),listHeight:l.height,overflow:document.documentElement.scrollWidth>innerWidth}})()');
      (result.geometry ||= []).push({ w, ...geometry });
      check('images, queue and composer stay on screen at ' + w, !geometry.overflow && geometry.input.bottom <= geometry.panel.bottom && geometry.send.right <= geometry.panel.right && geometry.listHeight > 50);
      await shot('chat-images-' + w);
    }
    const saved = await q('JSON.stringify(window.__fve.rawProject().craftAI)');
    check('saved projects retain image IDs without embedding image bytes', !saved.includes('base64') && !saved.includes('inlineData') && saved.includes('chatImage'));
    await click('button[aria-label=Stop]'); await until('!document.querySelector("button[aria-label=Stop]")');
    const project = await q('window.__fve.rawProject()'); const chat = project.craftAI.sessions.find(s => s.id === project.craftAI.activeSessionId); const imageId = chat.images[0].id;
    await q(`window.__fve.load({...window.__fve.rawProject(),craftAI:{version:1,activeSessionId:'missing',sessions:[{id:'missing',title:'Missing image',images:[{id:'${'f'.repeat(64)}',name:'Missing.png',bytes:10,width:1,height:1}],messages:[],contents:[],draft:'Use this missing image'}]}})`);
    await until('!!document.querySelector(".pilot-image.is-unavailable")'); await click('.pilot-input .send'); await until('!!document.querySelector(".pilot-context-error")');
    check('missing images block sending with a removable reference', await q('document.querySelector(".pilot-context-error").textContent.includes("no longer available")&&!document.querySelector("button[aria-label=Stop]")'));
    selected = 'delay'; await click('.pilot-image-remove'); await click('button[aria-label="Attach images or reference videos"]'); await untilFn(() => !!pickerResolve, 'delayed chooser');
    await q('window.__fve.load({id:"new-image-project",name:"Another project",media:[],videoClips:[],textClips:[],audioClips:[]})');
    pickerResolve({ canceled: false, filePaths: [source] }); await wait(300);
    check('late attachment results cannot reach another project', await q('!document.querySelector(".pilot-image-attachments")'));
    check('originals and prepared images stay in durable attachment storage', fs.existsSync(path.join(dir, 'chat-images', imageId, 'image.jpg')) && fs.existsSync(source));
    check('no renderer errors', !result.errors.length);
  } catch (error) { result.error = error.stack; await shot('failure'); }
  finally { local.runEditorNative = original.run; local.status = original.status; dialog.showOpenDialog = original.dialog; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
