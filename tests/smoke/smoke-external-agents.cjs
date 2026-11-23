// External agents over MCP in the real app (docs/design/external-agent-mcp.md). An agent connects to
// the app's MCP server over HTTP with the MCP SDK client, as Claude Code or Codex would, and edits:
// approval, project tools, an edit validated with complete_edit and undone as one step, a user edit
// interrupting the agent, saving, closing and reopening, CraftAI paused while the agent works, a
// second agent refused, Disconnect, a denied agent, and Settings: Install for Claude Code (into a
// temporary home) after which the real Claude Code reaches this app, and the switch turned off.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = { checks: [], errors: [], calls: [] };
  const check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const until = async (code, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(code)) return; await wait(40); } throw Error('Timed out: ' + code); };
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG());
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text)) result.errors.push(text); });
  const agents = [];
  const endpoint = () => { const ext = JSON.parse(fs.readFileSync(path.join(dir, 'settings-test', 'settings.json'), 'utf8')).externalAgents; return { url: `http://127.0.0.1:${ext.port}/mcp`, token: ext.token }; };
  const agentNamed = async (name) => {
    const { url, token } = endpoint();
    const client = new Client({ name, version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    agents.push(client);
    return client;
  };
  // Calls return parsed JSON; tool errors come back as { error }.
  const call = async (agent, name, args = {}) => {
    try {
      const res = await agent.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
      const raw = res.content.find((c) => c.type === 'text')?.text || '';
      result.calls.push({ name, ok: !res.isError, images: res.content.filter((c) => c.type === 'image').length, ...(res.isError ? { error: raw.slice(0, 300) } : {}) });
      try { return JSON.parse(raw); } catch { return { error: raw }; }
    } catch (error) {
      result.calls.push({ name, ok: false, error: error.message.slice(0, 300) });
      return { error: error.message };
    }
  };
  try {
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    const agent = await agentNamed('Test agent');
    check('the app serves MCP over HTTP and sends the native instructions', agent.getServerVersion().name === 'clipcraft' && /complete_edit/.test(agent.getInstructions()) && /get_status first/.test(agent.getInstructions()));
    const tools = (await agent.listTools()).tools.map((t) => t.name);
    result.tools = tools;
    check('the agent is offered the project tools and the native editor tools', ['get_status', 'list_projects', 'create_project', 'duplicate_project', 'open_project', 'save_project', 'close_project', 'get_project', 'add_text', 'edit_text', 'complete_edit', 'export_video'].every((n) => tools.includes(n)) && tools.length > 60);
    check('no image generation without a Codex sign-in, and no re-exported MCP servers', !tools.includes('generate_image') && !tools.some((n) => n.startsWith('mcp_')));

    // First call: the user is asked once.
    const pendingStatus = call(agent, 'get_status');
    await until('!!document.querySelector(".external-approve")');
    check('a new agent asks for permission, naming it, with Don’t allow focused', await q(`document.querySelector('#external-approve-title').textContent.includes('Test agent')&&document.activeElement.textContent.includes('allow')&&!document.activeElement.classList.contains('btn-primary')`));
    await shot('external-approve.png');
    await q(`[...document.querySelectorAll('.external-approve button')].find(b=>b.textContent==='Allow').click()`);
    const status = await pendingStatus;
    check('get_status works after Allow and reports Home', status.screen === 'home' && status.project === null && status.connected_as === 'Test agent');
    await until('document.querySelector(".external-badge .external-name")?.textContent==="Test agent"');
    check('Home shows the connected agent', true);
    await shot('external-home-badge.png');

    const noProject = await call(agent, 'add_text', { text: 'x' });
    check('editor tools on Home say to open or create a project', /No project is open/.test(noProject.error || ''));
    const created = await call(agent, 'create_project', { format: '9:16', name: 'MCP project', fps: 30 });
    check('create_project opens a new project in the editor', created.status?.screen === 'editor' && created.status.project.name === 'MCP project' && created.status.project.format === '9:16');
    await until('!!document.querySelector(".topbar")');
    await q(`[...document.querySelectorAll('.workspace-switch button')].find(b=>b.textContent==='Agent').click()`);
    await until('!!document.querySelector("#craft-ai-panel")');
    check('CraftAI is paused while the agent works', await q(`!!document.querySelector('#craft-ai-panel .pilot-external')&&document.querySelector('#craft-ai-panel .pilot-external').textContent.includes('Test agent is working')&&document.querySelector('#craft-ai-panel textarea').disabled`));
    const refused = await q(`window.api.agentStep({requestId:'smoke-step'})`);
    check('the main process refuses CraftAI requests while the agent works', refused.ok === false && /Test agent is working/.test(refused.error));

    // An edit: changes, then complete_edit until accepted; Undo removes it as one step. The timeline shows
    // the outside agent's work exactly as CraftAI's (docs/agents/agent-editing.md): record every state the
    // spotlight goes through, since each call is over in one render.
    const pastBefore = await q('window.__fve.history().past.length');
    await q(`window.__spot=[];new MutationObserver(()=>{const s={ranges:[...document.querySelectorAll('.tl-agent-range')].map(e=>[parseFloat(e.style.left),parseFloat(e.style.width)]),ruler:document.querySelector('.tl-agent-ruler')?.getAttribute('aria-label')||'',done:[...document.querySelectorAll('.clip.agent-done')].map(e=>e.textContent)};const last=window.__spot.at(-1);if(!last||JSON.stringify(last)!==JSON.stringify(s))window.__spot.push(s);}).observe(document.querySelector('.tl-content'),{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});`);
    const added = await call(agent, 'add_text', { text: 'Hello from MCP', start_sec: 0, duration_sec: 2 });
    check('add_text changes the project and asks for validation', !added.error && added.validation_pending === true && !!added.operation_id);
    const second = await call(agent, 'add_text', { text: 'Second line', start_sec: 2, duration_sec: 2 });
    check('a second change joins the same edit', !second.error && second.validation_pending === true);
    check('the agent edit is open in the editor', await q('!!window.__fve.history().agentEdit&&window.__fve.history().agentEdit.steps.length>=2'));
    const spot = await q('window.__spot');
    result.spotlight = spot;
    check('the timeline spotlit where the agent placed its text, in the agent’s name', spot.some((s) => s.ranges.length === 1 && /^Test agent: Adding text 00:00\.00 to 00:02\.00/.test(s.ruler)));
    check('each finished change leaves the trail on the created clip', await q(`[...document.querySelectorAll('.clip.agent-done')].map(e=>e.textContent).join('|')`).then((t) => t.includes('Hello from MCP') && t.includes('Second line')) && await q(`document.querySelector('.clip.agent-done .agent-mark')?.title==='Changed by Test agent'`));
    await shot('external-spotlight-trail.png');
    let done = null;
    for (let i = 0; i < 6 && !done?.ready; i++) done = await call(agent, 'complete_edit');
    result.completeEdit = { ready: done?.ready, attempts: result.calls.filter((c) => c.name === 'complete_edit').length };
    check('complete_edit accepts the edit', done?.ready === true);
    check('the accepted edit is one Undo step', await q(`!window.__fve.history().agentEdit&&window.__fve.history().past.length===${pastBefore + 1}&&window.__fve.rawProject().textClips.length===2`));
    await until(`[...document.querySelectorAll('#craft-ai-panel .pilot-msg.assistant .bubble')].some(b=>b.textContent.includes('Edit complete and validated.'))`);
    check('the trail stays through the edit’s own Undo commit and holds after the edit ends', await q(`document.querySelectorAll('.clip.agent-done').length===2&&!document.querySelector('.clip.agent-live')&&!document.querySelector('.tl-agent-range')&&!document.querySelector('.timeline.agent-fading')`));
    check('the CraftAI panel shows the agent’s steps in its own session', await q(`document.querySelector('#craft-ai-panel .pilot-reply-heading b').textContent==='Test agent'&&document.querySelectorAll('#craft-ai-panel .pilot-steps li').length>=3`));
    await shot('external-editor-activity.png');
    await q(`document.querySelector('#craft-ai-panel .pilot-undo').click()`);
    await until('window.__fve.rawProject().textClips.length===0');
    check('Undo in the panel removes the whole agent edit', true);
    await q(`window.__fve.dispatch({type:'redo'})`);
    await until('window.__fve.rawProject().textClips.length===2');
    await wait(250);
    check('Undo after the edit clears the trail at once (the clips return without it)', await q(`document.querySelectorAll('.clip[data-sel-track=text]').length===2&&!document.querySelector('.clip.agent-done')&&!document.querySelector('.timeline.agent-fading')`));

    // The user edits during an open agent edit: the agent's next call is told, the one after works.
    const pending = await call(agent, 'add_text', { text: 'Third', start_sec: 4, duration_sec: 1 });
    check('a new change opens a new edit', pending.validation_pending === true);
    await q(`window.__fve.dispatch({type:'setProject',patch:{name:'Renamed by the user'}})`);
    const interrupted = await call(agent, 'get_project');
    check('the agent learns the user changed the project', /project changed/i.test(interrupted.error || '') && interrupted.project_changed_by_user === true);
    const fresh = await call(agent, 'get_project');
    check('the next call continues from the current timeline', !fresh.error && JSON.stringify(fresh).includes('Renamed by the user'));
    check('the interrupted edit kept its change', await q('window.__fve.rawProject().textClips.length===3'));

    // Saving: no file yet, a new file, the same file again, never another existing file.
    const noFile = await call(agent, 'save_project');
    check('save_project without a file asks for a path', /no file yet/.test(noFile.error || ''));
    const target = path.join(dir, 'agent-made.clipcraft.json');
    const saved = await call(agent, 'save_project', { path: target });
    check('save_project writes a new project file', saved.saved === true && saved.file === target && JSON.parse(fs.readFileSync(target, 'utf8')).textClips.length === 3);
    check('saving again to the project’s own file works', (await call(agent, 'save_project')).saved === true);
    fs.writeFileSync(path.join(dir, 'other.clipcraft.json'), '{}');
    const overwrite = await call(agent, 'save_project', { path: path.join(dir, 'other.clipcraft.json') });
    check('another existing file is never overwritten', /already exists/.test(overwrite.error || '') && fs.readFileSync(path.join(dir, 'other.clipcraft.json'), 'utf8') === '{}');
    check('a path that is not a project file is refused', /\.clipcraft\.json/.test((await call(agent, 'save_project', { path: path.join(dir, 'notes.txt') })).error || ''));

    // Close, list, reopen.
    const closed = await call(agent, 'close_project');
    check('close_project returns to Home', closed.status?.screen === 'home');
    await until('!!document.querySelector(".home")');
    const list = await call(agent, 'list_projects');
    const entry = list.projects?.find((p) => p.file === target);
    check('list_projects lists the saved project with its file', !!entry && entry.name === 'Renamed by the user');
    const opened = await call(agent, 'open_project', { id: entry.id });
    check('open_project reopens it in the editor with its content', opened.status?.screen === 'editor' && await q('window.__fve.rawProject().textClips.length===3'));

    // The Project button and save indicator share the toolbar with the connected agent.
    const originalSize = win.getContentSize(), originalZoom = win.webContents.getZoomFactor();
    for (const [width, zoom] of [[1506, 1], [1000, 1], [1000, 1.25]]) {
      win.setContentSize(width, originalSize[1]); win.webContents.setZoomFactor(zoom);
      await until(`Math.abs(innerWidth-${width/zoom})<=1 && !!document.querySelector('.save-state.saved')`);
      const fits = await q(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const boxes = ['.project-menu-btn','.save-state','.external-badge','.workspace-switch','.plugin-actions-toggle','.settings-btn','.top-export'].map(rect);
        return document.querySelector('.project-menu-btn').innerText.trim() === 'Project' && boxes.every((a,i) => a.width > 0 && a.left>=0 && a.right<=innerWidth+1 &&
          boxes.slice(i+1).every(b => a.right<=b.left+1 || b.right<=a.left+1 || a.bottom<=b.top+1 || b.bottom<=a.top+1));
      })()`);
      check(`the connected toolbar keeps Project visible and every control separate at ${width}px and ${zoom}x zoom`, fits);
    }
    win.webContents.setZoomFactor(originalZoom); win.setContentSize(...originalSize);

    const baseImage = path.join(dir, 'external-home-badge.png');
    const imported = await call(agent, 'import_media', { paths: [baseImage], as: 'library' });
    check('the source has a media reference to carry into the copy', !!imported.media?.length);
    const copy = await call(agent, 'duplicate_project', { name: 'Episode 2' });
    check('duplicate_project opens an independently named project with no file binding',
      copy.source_id === entry.id && copy.created !== entry.id && copy.status?.project.id === copy.created && copy.status.project.name === 'Episode 2' && copy.status.project.file === null);
    await q('document.querySelector(".project-menu-btn").click()');
    await until('document.querySelector(".ctx-heading")?.textContent === "Episode 2"');
    await q('document.querySelector(".project-menu-btn").click()');
    await until('!document.querySelector(".ctx-heading")');
    check('the Project menu identifies the active copy', true);
    const sourceBytes = fs.readFileSync(target, 'utf8');
    const source = JSON.parse(sourceBytes);
    const snapshot = await q('window.__fve.rawProject()');
    assert.deepEqual(snapshot.textClips, source.textClips);
    check('the copy carries the timeline, format and original media reference', snapshot.ratio === source.ratio && snapshot.fps === source.fps
      && snapshot.media.some(m => m.path === source.media[0].path && fs.realpathSync(m.path) === fs.realpathSync(baseImage)));
    check('the copy starts with fresh chat and undo history',
      !snapshot.craftAI?.sessions?.some(s => s.messages?.length) && await q('window.__fve.history().past.length===0'));
    const both = (await call(agent, 'list_projects')).projects;
    check('both projects are immediately available in Home with separate bindings', both.some(p => p.id === entry.id && p.file === target && !p.open)
      && both.some(p => p.id === copy.created && p.file === null && p.open));
    check('the copy cannot overwrite the base project file', /already exists/.test((await call(agent, 'save_project', { path: target })).error || ''));
    const copyEdit = await call(agent, 'add_text', { text: 'Only in Episode 2', start_sec: 6, duration_sec: 1 });
    check('a new edit goes to the copy', !!copyEdit.operation_id);
    const third = await call(agent, 'duplicate_project');
    check('an autosave-only project can be duplicated with its default name',
      third.source_id === copy.created && third.created !== copy.created && third.status?.project.name === 'Episode 2 (copy)');
    const reopenCopy = await call(agent, 'open_project', { id: copy.created });
    const copyFile = path.join(dir, 'episode-2.clipcraft.json');
    const savedCopy = await call(agent, 'save_project', { path: copyFile });
    check('the edited copy reopens and saves to its own file', reopenCopy.opened === copy.created && savedCopy.file === copyFile
      && JSON.parse(fs.readFileSync(copyFile, 'utf8')).textClips.some(c => c.text === 'Only in Episode 2'));
    check('the original file is byte-for-byte unchanged after editing and saving the copy', fs.readFileSync(target, 'utf8') === sourceBytes);
    const reopenedBase = await call(agent, 'open_project', { id: entry.id });
    check('the original Home entry reopens its original timeline and file', reopenedBase.status?.project.file === target
      && JSON.stringify(await q('window.__fve.rawProject().textClips')) === JSON.stringify(source.textClips));
    const modalBefore = await q('document.querySelector(".modal-backdrop")?.innerText||""');
    const byPath = await call(agent, 'open_project', { path: path.join(dir, 'missing.clipcraft.json') });
    result.modals = { before: modalBefore, after: await q('document.querySelector(".modal-backdrop")?.innerText||""') };
    check('opening a missing file reports an error instead of a dialog', /could not be found/.test(byPath.error || '') && !result.modals.after.includes('could not be found'));

    // One agent at a time.
    const intruder = await agentNamed('Second agent');
    const blocked = await call(intruder, 'get_status');
    check('a second agent is refused while the first works', /being used by Test agent/.test(blocked.error || ''));

    // Disconnect from the top bar: CraftAI resumes, the panel records it, the other agent may ask.
    await until('!!document.querySelector(".topbar .external-badge")');
    await shot('external-topbar-badge.png');
    await q(`document.querySelector('.topbar .external-badge button').click()`);
    await until('!document.querySelector(".external-badge")');
    check('Disconnect frees the editor and CraftAI resumes', await q(`!document.querySelector('#craft-ai-panel .pilot-external')||!document.querySelector('#craft-ai-panel .pilot-external').textContent.includes('is connected')`));
    const stepAfter = await q(`window.api.agentStep({requestId:'smoke-step-2'})`);
    check('the main process no longer refuses CraftAI', !/is working in ClipCraft/.test(stepAfter?.error || ''));
    check('the disconnected agent\'s session is closed', /Session not found|404/.test((await call(agent, 'get_status')).error || ''));
    const denied = call(intruder, 'get_status');
    await until('!!document.querySelector(".external-approve")');
    await q(`[...document.querySelectorAll('.external-approve button')].find(b=>b.textContent.includes('allow')&&!b.classList.contains('btn-primary')).click()`);
    check('a denied agent cannot edit', /did not allow Second agent/.test((await denied).error || ''));

    // Settings: on, the address, the agents found, Install for Claude Code, the allowed agent.
    result.status = await q(`window.api.externalStatus()`);
    check('only the allowed agent is remembered', JSON.stringify(result.status.approved) === JSON.stringify(['Test agent']));
    await q(`document.querySelector('button[aria-label="Settings"],.topbar button[title*="Settings"]').click()`);
    await until('!!document.querySelector(\'[data-section="external"]\')');
    await q(`document.querySelector('[data-section="external"]').click()`);
    await until('document.querySelectorAll("[data-agent]").length===3');
    result.agents = await q(`[...document.querySelectorAll('[data-agent]')].map(r=>({id:r.dataset.agent,text:r.textContent}))`);
    check('Settings shows the switch on, the server address and Claude Code, Codex and OpenCode', await q(`document.querySelector('input[aria-label="Allow external agents"]').checked&&document.querySelector('.external-url').textContent===${JSON.stringify(endpoint().url)}`)
      && result.agents.map((a) => a.id).join() === 'claude,codex,opencode');
    const manual = JSON.parse(await q('window.api.externalManualConfig()'));
    check('other clients get the address and key as mcpServers JSON', manual.mcpServers.clipcraft.url === endpoint().url && manual.mcpServers.clipcraft.headers.Authorization === `Bearer ${endpoint().token}`);
    if (/Not set up/.test(result.agents[0].text)) {
      await q(`document.querySelector('[data-agent="claude"] .btn-primary').click()`);
      try { await until(`/Set up$/.test(document.querySelector('[data-agent="claude"] .muted').textContent)`, 90000); }
      catch (error) { result.installMessage = await q(`[...document.querySelectorAll('.set2-page .result')].map(r=>r.textContent).join(' | ')`); throw error; }
      const installed = JSON.parse(fs.readFileSync(path.join(dir, 'agent-home', '.claude', '.claude.json'), 'utf8')).mcpServers.clipcraft;
      check('Install writes ClipCraft into Claude Code (temporary home)', installed.url === endpoint().url && installed.headers.Authorization === `Bearer ${endpoint().token}`);
      await shot('external-settings.png');
      // The real Claude Code health check reaches this running app with what Install wrote.
      const claude = require('../../electron/agents/localAgents.cjs').searchDirectories().map((d) => path.join(d, 'claude')).find((f) => fs.existsSync(f));
      result.claudeHealth = await new Promise((resolve) => execFile(claude, ['mcp', 'list'], { timeout: 90000, env: { ...process.env, HOME: path.join(dir, 'agent-home'), CLAUDE_CONFIG_DIR: path.join(dir, 'agent-home', '.claude') } }, (error, stdout) => resolve(String(stdout || error?.message))));
      check('the real Claude Code connects to the app with that setup', /clipcraft: .*\(HTTP\) - ✔ Connected/.test(result.claudeHealth));
      await q(`[...document.querySelectorAll('[data-agent="claude"] button')].find(b=>b.textContent==='Remove').click()`);
      await until(`/Not set up/.test(document.querySelector('[data-agent="claude"] .muted').textContent)`, 60000);
      check('Remove takes it out again', !JSON.parse(fs.readFileSync(path.join(dir, 'agent-home', '.claude', '.claude.json'), 'utf8')).mcpServers?.clipcraft);
    } else { result.skipped = 'Claude Code not installed: Install not exercised'; await shot('external-settings.png'); }
    // Turning it off stops serving.
    await q(`document.querySelector('input[aria-label="Allow external agents"]').click()`);
    await until(`window.api.externalStatus().then(s=>!s.running&&!s.enabled)`);
    const off = await agentNamed('Late agent').then(() => 'connected', (error) => error.message);
    check('with the switch off agents cannot connect', off !== 'connected');
    check('no interface errors', !result.errors.length);
  } catch (error) {
    result.error = error.stack || error.message;
  } finally {
    for (const a of agents) await a.close().catch(() => {});
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    app.exit(result.error ? 1 : 0);
  }
};
