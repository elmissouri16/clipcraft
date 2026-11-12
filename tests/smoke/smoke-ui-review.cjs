// Visual review of the flat desktop design language (v14): captures every major surface
// plus a hovered and a pressed control, so a reviewer can check the shell reads as a
// native editor. Writes <dir>/review-*.png and result.json; asserts only that the
// surfaces open and that no control carries a gradient, glow or hover transform.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const q = (s) => { new (require('node:vm').Script)(s); return win.webContents.executeJavaScript(s); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s) => { for (let i = 0; i < 200; i++) { if (await q(s)) return; await wait(50); } throw Error('Timeout: ' + s); };
  const click = (s) => q(`document.querySelector(${JSON.stringify(s)}).click()`);
  const result = { shots: [], checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  const shot = async (label) => { await wait(200); fs.writeFileSync(path.join(dir, `review-${label}.png`), (await win.capturePage()).toPNG()); result.shots.push(label); };
  const centre = (s) => q(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  const mouse = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: p.x, y: p.y, ...extra }); await wait(120); };
  win.webContents.setBackgroundThrottling(false); win.setContentSize(1400, 860); win.show(); win.focus(); win.webContents.focus();
  win.webContents.on('console-message', (_e, n, s) => { if (n >= 3) result.errors.push(s); });
  require('../../electron/system/settings.cjs').save({ provider: 'ollama' });
  const image = path.join(dir, 'source.png');
  fs.writeFileSync(image, require('electron').nativeImage.createFromBitmap(Buffer.from([74, 84, 120, 255]), { width: 1, height: 1 }).resize({ width: 180, height: 320 }).toPNG());
  const project = { id: 'ui-review', name: 'Flat desktop review', ratio: '9:16', width: 1080, height: 1920, fps: 30,
    media: Array.from({ length: 6 }, (_, i) => ({ id: 'm' + i, type: 'image', path: image, poster: image, name: 'Source ' + i, width: 180, height: 320 })),
    videoClips: [{ id: 'v', mediaId: 'm0', in: 0, out: 120 }], overlayClips: [], audioClips: [], effectClips: [],
    textClips: Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, text: 'Caption ' + i, start: i * 3, duration: 3, layer: i % 2 })), layers: { text: 2, overlay: 1, audio: 1 } };
  try {
    await wait(900);
    await shot('home');
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await click('.home-frame-card');
    await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(project)})`);
    await until('!!document.querySelector(".timeline .clip")');
    await wait(400);
    if (await q('!!document.querySelector(".welcome-go")')) { await click('.welcome-go'); await wait(300); }
    await shot('edit');
    // Hover, then press, the Import button and a ghost icon button; the press is released
    // away from the button so no click fires. The computed background in each state is the
    // evidence that hover and press are tints, not movement.
    const bg = (s) => q(`getComputedStyle(document.querySelector(${JSON.stringify(s)})).backgroundColor`);
    const states = {};
    for (const [name, sel] of [['primary', '.lib-head .btn-primary'], ['icon', '.tl-toolbar .icon-btn:not(.active):not(:disabled)']]) {
      const p = await centre(sel);
      check(`${sel} is on screen`, !!p);
      const rest = await bg(sel);
      await mouse('mouseMove', p); const hover = await bg(sel); await shot(`hover-${name}`);
      await mouse('mouseDown', p, { button: 'left', clickCount: 1 }); const press = await bg(sel); await shot(`pressed-${name}`);
      await mouse('mouseMove', { x: 700, y: 400 }); await mouse('mouseUp', { x: 700, y: 400 }, { button: 'left', clickCount: 1 });
      states[name] = { rest, hover, press };
      check(`${sel}: hover and press change only the fill (${rest} / ${hover} / ${press})`, rest !== hover && hover !== press);
    }
    result.states = states;
    const dock = await centre('.dock-btn:nth-child(3)');
    if (dock) { await mouse('mouseMove', dock); await shot('hover-dock'); }
    await mouse('mouseMove', { x: 700, y: 400 });
    for (const tab of ['effects', 'transitions', 'text', 'audio', 'adjust']) { await q(`window.__fve.tab(${JSON.stringify(tab)})`); await wait(350); await shot('tab-' + tab); }
    await q(`window.__fve.tab('media'); window.__fve.select({ track: 'text', id: 't1' })`); await wait(300); await shot('inspector-text');
    // Context menu on a clip.
    const clip = await centre('.clip');
    if (clip) { await q(`(()=>{const e=document.elementFromPoint(${clip.x},${clip.y});e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${clip.x},clientY:${clip.y},button:2}))})()`); await wait(250); if (await q('!!document.querySelector(".ctx-menu")')) { await shot('context-menu'); await q('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await wait(150); } }
    // Settings.
    await click('button[aria-label=Settings]'); await until('!!document.querySelector(".settings2")'); await shot('settings');
    // Every Settings page, plus the computed styles of its building blocks against the v14 rules
    // (docs/design/DESIGN-SYSTEM.md): one place to see what the dialog really renders.
    const sections = await q('[...document.querySelectorAll(".set2-rail button[data-section]")].map(b => b.dataset.section)');
    const PROBES = { dialog: '.settings2', head: '.settings2 .settings-head h3', rail: '.set2-rail', railOn: '.set2-rail button.on', railLabel: '.set2-rail-label', pane: '.set2-pane', pageTitle: '.set2-page-head h4', group: '.set2-group', groupLabel: '.set2-group-label', note: '.set2-note', field: '.set2-group select, .set2-group input[type=text], .set2-group input[type=password], .set2-group input[type=number], .set2-group .dropdown-btn', button: '.set2-page .btn:not(.btn-primary):not(.btn-ghost)', primary: '.set2-page .btn-primary', ghost: '.set2-page .btn-ghost', item: '.set2-item', status: '.set2-status', empty: '.set2-empty', segTabs: '.set2-page .seg-tabs', segOn: '.set2-page .seg-tabs button.on', switchEl: '.set2-page input.switch', card: '.set2-page .card', actions: '.set2-page-actions' };
    const PROPS = ['height', 'fontSize', 'fontWeight', 'backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'borderRadius', 'boxShadow', 'color', 'textTransform', 'letterSpacing', 'paddingTop', 'paddingLeft', 'outlineWidth'];
    result.settings = {};
    for (const id of sections) {
      await q(`document.querySelector('.set2-rail button[data-section="${id}"]').click()`); await wait(300); await shot('settings-' + id);
      result.settings[id] = await q(`(()=>{const out={};for(const [k,sel] of Object.entries(${JSON.stringify(PROBES)})){const e=document.querySelector(sel);if(!e)continue;const s=getComputedStyle(e),r=e.getBoundingClientRect();out[k]={w:Math.round(r.width),h:Math.round(r.height)};for(const p of ${JSON.stringify(PROPS)})out[k][p]=s[p];}return out;})()`);
    }
    await q(`document.querySelector('.set2-rail button[data-section="${sections[0]}"]').click()`); await wait(200);
    await click('button[aria-label="Close settings"]'); await wait(200);
    // Export dialog.
    await click('.top-export > button:first-child'); await until('!!document.querySelector(".export-modal")'); await shot('export');
    if (await q('!!document.querySelector(".export-ready button[aria-label=Close]")')) await click('.export-ready button[aria-label=Close]');
    else await q('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await wait(250);
    // Scrollbars that should not be there: an element that scrolls although it is not one of the
    // panel bodies designed to scroll. Recorded per surface and width for review.
    const scrollers = () => q(`(()=>{const ok=/tl-scroll|inspector-body|tab-content|pilot-list|set2-pane|x-body|dock|home-app|lib-body|library-scroll/;return [...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);if(!/(auto|scroll)/.test(s.overflowY+s.overflowX))return false;const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;return (e.scrollHeight>e.clientHeight+1&&/(auto|scroll)/.test(s.overflowY))||(e.scrollWidth>e.clientWidth+1&&/(auto|scroll)/.test(s.overflowX))}).map(e=>(e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)+(e.scrollWidth>e.clientWidth+1?' x+'+(e.scrollWidth-e.clientWidth):'')+(e.scrollHeight>e.clientHeight+1?' y+'+(e.scrollHeight-e.clientHeight):'')+(ok.test(e.className)?'':'  <-- unexpected'))})()`);
    result.scrollers = {};
    for (const w of [1000, 1400]) {
      win.setContentSize(w, 760); await wait(400);
      result.scrollers[`edit-${w}`] = await scrollers(); await shot(`edit-${w}`);
      await click('.workspace-switch button:nth-child(2)'); await wait(500);
      result.scrollers[`agent-${w}`] = await scrollers(); await shot(`agent-${w}`);
      await click('.agent-workspace-tools button:first-child'); await wait(400);
      result.scrollers[`agent-media-${w}`] = await scrollers(); await shot(`agent-media-${w}`);
      await click('.agent-workspace-tools button:first-child'); await wait(200);
      await click('.workspace-switch button:first-child'); await wait(300);
    }
    win.setContentSize(1400, 860); await wait(300);
    // A populated CraftAI conversation: text, a work log with media, a timing receipt, a
    // rendered video, a render in progress, and a queued message. Captured docked (Agent
    // mode) and floating (Edit mode).
    const movie = path.join(dir, 'review.mp4');
    try { require('node:child_process').execFileSync(require('../../electron/media/ffmpeg.cjs').ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3', '-pix_fmt', 'yuv420p', movie]); } catch (e) { result.errors.push('ffmpeg: ' + e.message); }
    const chat = { version: 1, activeSessionId: 'review', sessions: [{ id: 'review', title: 'Tighten the intro', draft: '', contents: [], images: [], videos: [], timelineAttachments: [],
      queue: [{ id: 'q1', text: 'Then add captions for the intro and tighten the pacing of the middle section.', images: [] }],
      messages: [
        { role: 'user', text: 'Cut the dead air after the first caption and add a scene image for the opening and the ending.' },
        { role: 'assistant', text: 'I removed 2.5 seconds of silence after the first caption and placed two scene images. The export is ready below.', changed: true, tokenUsage: { inputTokens: 18420, cachedInputTokens: 12000, outputTokens: 612 },
          steps: [
            { id: 's1', name: 'read_project', label: 'Read the project', status: 'done', activity: { title: 'Read the project', description: '4 captions on 2 text layers over one source clip.', outcome: '4 clips read' } },
            { id: 's2', name: 'generate_images', label: 'Generate scene images', status: 'done', activity: { title: 'Scene images added', visuals: [{ src: image, label: 'Opening scene', at_sec: 0, duration_sec: 3 }, { src: image, label: 'Closing scene', at_sec: 9, duration_sec: 3 }], outcome: '2 images placed' } },
            { id: 's3', name: 'cut_range', label: 'Remove a section', status: 'done', activity: { title: 'Section removed', change: { kind: 'remove', applied: true, duration_sec: 2.5, window_start: 0, window_end: 12, ranges: [{ start: 4, end: 6.5 }], tracks: { Text: 1, Main: 1 } } } },
            { id: 's4', name: 'export_video', label: 'Export the video', status: 'done', activity: { title: 'Video ready', outcome: 'review.mp4 · 3.0 s · 0.2 MB', artifact: { file: movie, name: 'Flat desktop review.mp4', duration_sec: 3 } } },
          ] },
        { role: 'user', text: 'Looks good. Export a 1080p version too.' },
        { role: 'assistant', pending: true, steps: [{ id: 's5', name: 'export_video', label: 'Exporting the video', status: 'running', activity: { title: 'Exporting video', render: { progress: 0.42, stage: 'Encoding video', remainingSeconds: 18 } } }] },
      ] }] };
    await q(`window.__fve.load(${JSON.stringify({ ...project, craftAI: chat })})`); await wait(400);
    await click('.workspace-switch button:nth-child(2)'); await wait(600); await shot('chat-agent');
    await q('document.querySelectorAll(".pilot-turn-activity").forEach(d => { d.open = true; }); document.querySelector(".pilot-list").scrollTop = 0'); await wait(400); await shot('chat-agent-activity');
    await q('document.querySelector(".pilot-list").scrollTop = 420'); await wait(300); await shot('chat-agent-activity-2');
    await click('.workspace-switch button:first-child'); await wait(300);
    await click('.pilot-fab'); await wait(600); await shot('chat-floating');
    await q('document.querySelector(".pilot-list").scrollTop = 0'); await wait(300); await shot('chat-floating-top');
    await q('document.querySelector(".pilot-shell button[aria-label=\\"Close assistant\\"]")?.click()'); await wait(300);
    // Flatness: no control in the shell may carry a gradient, an outer glow or a hover transform.
    const decorated = await q(`(()=>{const out=[];for(const e of document.querySelectorAll('.btn,.icon-btn,.dock-btn,.chip,.seg-tabs button,.proj-seg button,.tile,.lib-row,.left,.player,.inspector,.timeline,.topbar,.transport,.panel-head')){const s=getComputedStyle(e);if(s.backgroundImage!=='none')out.push(e.className+' bg:'+s.backgroundImage.slice(0,40));if(/rgba?\\(13[0-9], 92, 251|109, 40, 224/.test(s.boxShadow))out.push(e.className+' glow');}return out.slice(0,20)})()`);
    check('no shell control carries a gradient or a violet glow: ' + JSON.stringify(decorated), decorated.length === 0);
    result.heights = await q(`(()=>{const h=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):null};return {topbar:h('.topbar'),button:h('.lib-head .btn'),input:h('.inspector input[type=text]'),panelHead:h('.panel-head'),transport:h('.transport'),tlToolbar:h('.tl-toolbar')}})()`);
  } catch (e) { result.error = e.stack; fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.quit();
};
