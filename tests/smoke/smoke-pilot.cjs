// UI smoke test for CraftAI with a scripted model (a local mock of the Gemini API).
// The tools are the real ones: silence removal runs real FFmpeg on <dir>/gaps.mp4 (silences at 2-3.5s and 5.5-6.5s).
// FVE_SMOKE=<dir> FVE_SMOKE_MODE=pilot electron .
const fs = require('fs');
const http = require('http');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smokePilot(win, app, dir, shot) {
  const run = (js) => win.webContents.executeJavaScript(js);
  const result = { errors: [] };
  win.webContents.on('console-message', (_e, level, msg) => level >= 2 && result.errors.push(msg));

  // Scripted model: decides its next move from the conversation it receives.
  const requests = [];
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ url: req.url, key: req.headers['x-goog-api-key'], tools: (body.tools?.[0]?.functionDeclarations || []).length });
      const send = (parts) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] }));
      };
      const contents = body.contents;
      const lastUser = [...contents].reverse().find((c) => c.role === 'user' && c.parts.some((p) => p.text));
      const ask = lastUser.parts.find((p) => p.text).text.toLowerCase();
      // Turns taken since that user message.
      const since = contents.slice(contents.indexOf(lastUser) + 1).filter((c) => c.role === 'model').length;
      const responses = contents.flatMap((c) => c.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse));
      if (ask.includes('silences')) {
        return since === 0 ? send([{ functionCall: { name: 'remove_silences', args: {} } }]) : send([{ text: 'Removed the silences.' }]);
      }
      if (ask.includes('title')) {
        if (since === 0) return send([{ functionCall: { name: 'get_project', args: {} } }]);
        if (since === 1) {
          const proj = responses.filter((r) => r.name === 'get_project').at(-1).response.result;
          const id = proj.main_track[0].id;
          return send([
            { functionCall: { name: 'add_text', args: { text: 'Hello ClipCraft', start_sec: 0.5, duration_sec: 2, template_id: 'title-neon' } } },
            { functionCall: { name: 'set_filter', args: { clip_id: id, filter_id: 'bw' } } },
            { functionCall: { name: 'set_filter', args: { clip_id: 'does-not-exist', filter_id: 'bw' } } },
          ]);
        }
        return send([{ text: 'Added a **neon title** and a black and white filter.' }]);
      }
      return send([{ text: 'I did not understand.' }]);
    });
  });

  try {
    await new Promise((r) => mock.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${mock.address().port}`;
    await wait(800);
    await run(`window.__fve.load(${fs.readFileSync(path.join(dir, 'project.json'), 'utf8')})`);
    await run(`window.api.settingsSave({ provider: 'gemini', model: 'gemini-3.8-flash', baseUrl: ${JSON.stringify(base)}, apiKey: 'AIzaFAKE-pilot-test-key' })`);
    const proj = () => run('window.__fve.exportData().project');
    const setText = (v) => run(`(() => { const el = document.querySelector('.pilot-input textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const waitFor = async (js, ms = 20000) => {
      for (let t = 0; t < ms; t += 250) {
        if (await run(js)) return true;
        await wait(250);
      }
      return false;
    };
    const dur = async () => run('(() => { const p = window.__fve.exportData().project; return window.__fve.duration(); })()');

    result.initialDuration = await dur();
    await run(`document.querySelector('.pilot-fab').click()`);
    await wait(600);
    await shot('pilot-1-open.png');
    result.welcomeChips = await run(`[...document.querySelectorAll('.pilot-chips .chip')].map(b => b.textContent)`);

    // Message 1: remove silences (real FFmpeg).
    await setText('Please remove the silences');
    await run(`document.querySelector('.send').click()`);
    result.msg1Done = await waitFor(`document.querySelectorAll('.pilot-msg.assistant').length === 1 && !document.querySelector('.pilot-msg.assistant .spin') && !!document.querySelector('.pilot-msg.assistant .bubble')`);
    result.afterSilences = await dur();
    result.mainClips = (await proj()).videoClips.length;

    // Message 2: add a title + a filter, one tool call is deliberately invalid.
    await setText('Add a title and a bw filter');
    await run(`document.querySelector('.send').click()`);
    result.msg2Done = await waitFor(`document.querySelectorAll('.pilot-msg.assistant').length === 2 && !document.querySelector('.pilot-msg.assistant:last-child .spin') && !!document.querySelector('.pilot-msg.assistant:last-child .bubble')`);
    const p2 = await proj();
    result.texts = p2.textClips.map((c) => c.text);
    result.filters = p2.videoClips.map((c) => c.filter || 'none');
    result.steps = await run(`[...document.querySelectorAll('.pilot-msg.assistant:last-child .pilot-steps li')].map(li => li.className + ': ' + li.textContent.trim())`);
    result.reply = await run(`document.querySelector('.pilot-msg.assistant:last-child .bubble').textContent`);
    await shot('pilot-2-chat.png');

    // One Undo reverts everything message 2 did, another reverts message 1.
    const undos = () => run(`document.querySelectorAll('.pilot-undo').length`);
    result.undoButtons = await undos();
    await run(`document.querySelectorAll('.pilot-undo')[1].click()`);
    await wait(300);
    const p3 = await proj();
    result.afterUndo2 = { texts: p3.textClips.length, filters: p3.videoClips.map((c) => c.filter || 'none'), duration: await dur() };
    await run(`document.querySelectorAll('.pilot-undo')[0].click()`);
    await wait(300);
    result.afterUndo1 = { duration: await dur(), clips: (await proj()).videoClips.length };

    result.requests = requests.length;
    result.sawKey = requests.every((r) => r.key === 'AIzaFAKE-pilot-test-key');
    result.toolsPerRequest = [...new Set(requests.map((r) => r.tools))];
  } catch (e) {
    result.error = e.message;
  }
  mock.close();
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.quit();
};
