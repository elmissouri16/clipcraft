// Real editor interactions: folding changes display geometry, never the edit.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const { nativeImage, clipboard } = require('electron');
  const library = require('../../electron/library/mediaSources.cjs').MediaSources.prototype, originalSearch = library.search;
  const priorClipboard = await clipboard.readText(); // the clipboard API is Promise-based since Electron 44
  library.search = async () => ({ results: [], page: 1, pages: 1 });
  const result = { checks: [], errors: [] }, q = js => win.webContents.executeJavaScript(js);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async js => { for (let n = 0; n < 150; n++) { if (await q(js)) return;await wait(100); }throw Error('Timeout: ' + js); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const check = (name, value) => { assert.ok(value, name);result.checks.push(name); };
  const focusForClipboard = async () => { win.show();win.focus();win.webContents.focus();await until('document.hasFocus()'); };
  const capture = async name => { await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(120);fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG()); };
  const image = path.join(dir, 'portrait.png'), audio = path.join(dir, 'licensed.wav');
  fs.writeFileSync(image, nativeImage.createFromBitmap(Buffer.from([60, 120, 40, 255]), { width: 1, height: 1 }).resize({ width: 180, height: 320 }).toPNG());
  const wav = Buffer.alloc(44 + 20 * 8000 * 2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length - 8, 4);wav.write('WAVEfmt ', 8);wav.writeUInt32LE(16, 16);wav.writeUInt16LE(1, 20);wav.writeUInt16LE(1, 22);wav.writeUInt32LE(8000, 24);wav.writeUInt32LE(16000, 28);wav.writeUInt16LE(2, 32);wav.writeUInt16LE(16, 34);wav.write('data', 36);wav.writeUInt32LE(wav.length - 44, 40);fs.writeFileSync(audio, wav);
  const credit = '"Fixture music" by Test Artist — CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/';
  const project = { id: 'editor-space', name: 'Editor space verification', ratio: '9:16', width: 1080, height: 1920, fps: 30,
    media: [{ id: 'picture', type: 'image', name: 'Portrait source', path: image, width: 180, height: 320, duration: 20 },
      { id: 'licensed', type: 'audio', name: 'Fixture music', path: audio, duration: 20, hasAudio: true, credit: { license: 'by', line: credit } }],
    videoClips: [{ id: 'v', mediaId: 'picture', in: 0, out: 20, effects: ['vignette', 'grain'] }],
    textClips: [0, 1, 2].map(n => ({ id: 't' + n, layer: n, start: 1, duration: 12, text: 'Title ' + n })),
    audioClips: [{ id: 'a', mediaId: 'licensed', start: 0, in: 0, out: 20, volume: .1 }], overlayClips: [], effectClips: [], layers: { text: 3, overlay: 2, audio: 1 } };
  const editSnapshot = async () => {
    const { craftAI, media, ...edit } = await q('window.__fve.rawProject()');
    return JSON.stringify({ ...edit, media: media.map(({ id, type, path, duration, width, height }) => ({ id, type, path, duration, width, height })) });
  };
  win.setSize(1440, 1000);win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  require('../../electron/system/settings.cjs').setFirstRun({ tourSeen: true, packPromptSeen: true });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(project)})`);await until('!!document.querySelector("[data-sel-id=t2]")');
    check('fold controls fit the existing header control column', await q('(()=>{const h=document.querySelector(".tl-head[data-lane=effect]"),b=h.querySelector(".tl-fold-toggle").getBoundingClientRect(),n=h.querySelector(".tl-name").getBoundingClientRect(),r=h.getBoundingClientRect();return b.left>=n.right&&b.right<=r.right;})()'));
    const before = await editSnapshot();
    const expanded = await q('document.querySelector(".tl-head[data-lane=effect]").parentElement.getBoundingClientRect().height');
    await click('button[aria-label="Collapse Effects tracks"]');await until('!!document.querySelector(".tl-row.is-folded .tl-lane[data-lane=effect]")');
    const collapsed = await q('document.querySelector(".tl-head[data-lane=effect]").parentElement.getBoundingClientRect().height');
    result.effectHeights = { expanded, collapsed };
    check('folding recovers vertical timeline space and shows its summary', collapsed < expanded && await q('document.querySelector(".tl-lane[data-lane=effect] .tl-folded-summary").textContent.includes("2 effects")'));
    check('folding removes hidden clip hit targets', await q('!document.querySelector(".tl-lane[data-lane=effect] [data-sel-id]")'));
    await q('document.querySelector(".tl-scroll").scrollLeft=240');await wait(100);
    check('folded summaries stay visible after horizontal scrolling', await q('(()=>{const s=document.querySelector(".tl-lane[data-lane=effect] .tl-folded-summary").getBoundingClientRect(),h=document.querySelector(".tl-head[data-lane=effect]").getBoundingClientRect();return s.left>=h.right-1;})()'));
    await q('document.querySelector(".tl-scroll").scrollLeft=0');
    await click('button[aria-label="Collapse Text tracks"]');
    check('folding leaves edit data and Undo history unchanged', before === await editSnapshot() && await q('window.__fve.history().past.length===0'));
    await q(`(()=>{document.querySelector('.tl-scroll').scrollTop=0;const o=document.querySelector('.tl-lane[data-lane=overlay]').getBoundingClientRect(),f=document.querySelector('.tl-lane[data-lane=effect]').getBoundingClientRect();document.querySelector('.tl-lane[data-lane=overlay]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:o.left+360,clientY:o.bottom-8}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:o.left+540,clientY:f.top+4}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:o.left+540,clientY:f.top+4}));})()`);
    check('marquee selection excludes folded clips', await q('document.querySelector("button[aria-label^=\\"Delete (\\"]").disabled'));
    await q('window.__fve.select({track:"text",id:"t2"})');
    await until('!!document.querySelector("[data-sel-id=t2]")');
    check('selecting a clip reveals its folded group', await q('document.querySelector("button[aria-label=\\"Collapse Text tracks\\"]").getAttribute("aria-expanded")==="true"'));
    await click('button[aria-label="Collapse Text tracks"]');await capture('folded-timeline.png');
    await click('button[aria-label="Expand Effects tracks"]');
    check('expanding restores the original track height', await q(`document.querySelector('.tl-head[data-lane=effect]').parentElement.getBoundingClientRect().height===${expanded}`));
    await click('button[aria-label="Collapse Overlay tracks"]');
    await q(`(()=>{const source=[...document.querySelectorAll('.asset[draggable=true]')].find(e=>e.textContent.includes('Portrait source'));const target=document.querySelector('.tl-lane[data-lane=overlay]'),r=target.getBoundingClientRect(),dt=new DataTransfer();const ev=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+120,clientY:r.top+r.height/2}));ev('dragstart',source);ev('dragover',target);ev('drop',target);ev('dragend',source);})()`);
    await until('window.__fve.rawProject().overlayClips.length===1');
    check('dropping into a folded group uses layer zero and reveals the edit', await q('window.__fve.rawProject().overlayClips[0].layer===0&&!document.querySelector(".tl-row.is-folded .tl-lane[data-lane=overlay]")'));
    await q('window.__fve.tab("audio")');await until('!!document.querySelector(".browser-audio-source")');
    await q('[...document.querySelectorAll(".browser-destinations button")].find(b=>b.textContent.trim()==="This project").click()');await until('!!document.querySelector(".lib-credit-reminder")');
    check('audio browsing shows a compact reminder with no expanded credit block', await q('document.querySelector(".lib-credit-link").textContent.includes("1 credit needed")&&!document.querySelector(".lib-credits")'));
    const reminderHeight = await q('document.querySelector(".lib-credit-reminder").getBoundingClientRect().height');
    await focusForClipboard();await click('.lib-credit-reminder button[aria-label="Copy credits"]');
    await until('!!document.querySelector(".lib-credit-reminder button[aria-label=\\"Credits copied\\"]")');
    check('quick copy preserves the complete attribution', await clipboard.readText() === credit);
    await capture('audio-reminder.png');await click('.lib-credit-link');await until('!!document.querySelector(".lib-credits pre")');
    check('the reminder opens the existing Credits view with full text', await q(`document.querySelector('.lib-credits pre').textContent===${JSON.stringify(credit)}&&!document.querySelector('.lib-credit-reminder')`));
    check('the compact reminder is smaller than the attribution card', reminderHeight < await q('document.querySelector(".lib-credits").getBoundingClientRect().height'));
    await focusForClipboard();await clipboard.clear();await click('.lib-credits button');await wait(100);check('full Credits view still copies attribution', await clipboard.readText() === credit);
    const size = await q('document.querySelector(".stage").getBoundingClientRect().height');
    check('resize handles remain visible without hover', await q('(()=>{const h=document.querySelector(".splitter.row"),s=getComputedStyle(h,"::after");return s.backgroundColor!=="rgba(0, 0, 0, 0)"&&parseFloat(s.width)>0&&parseFloat(s.height)>0;})()'));
    await q(`(()=>{const el=document.querySelector('.splitter.row'),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+3;el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:x,clientY:y}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y+60}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:y+60}));})()`);
    await wait(150);
    check('resizing gives the portrait preview more height', await q(`document.querySelector('.stage').getBoundingClientRect().height>${size}`));
    await capture('resized-preview.png');check('no renderer errors', result.errors.length === 0);
  } catch (error) { result.error = error.stack;await capture('failure.png');result.dom = await q('document.body.innerText.slice(-3000)'); }
  finally { library.search = originalSearch;await clipboard.writeText(priorClipboard); }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify({ checks: result.checks, error: result.error, evidence: dir }));app.exit(result.error ? 1 : 0);
};
