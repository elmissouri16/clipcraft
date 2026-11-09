// External agents over MCP in the real app (docs/design/external-agent-mcp.md). An agent connects
// through the stdio bridge, run by the app binary in Node mode exactly as Settings tells users to,
// and edits: approval, project tools, an edit validated with complete_edit and undone as one step,
// a user edit interrupting the agent, saving, closing and reopening, CraftAI paused while the agent
// holds the editor, a second agent refused, Disconnect, and a denied agent.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { McpClient } = require('../../electron/agents/mcp.cjs');

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = { checks: [], errors: [], calls: [] };
  const check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const until = async (code, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(code)) return; await wait(40); } throw Error('Timed out: ' + code); };
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG());
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text)) result.errors.push(text); });
  const bridge = path.join(__dirname, '../../electron/agents/external/bridge.cjs');
  const server = { name: 'clipcraft', command: process.execPath, args: [bridge, '--dir', path.join(dir, 'mcp')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const agents = [];
  const agentNamed = (name) => { const a = new McpClient(server, { timeoutMs: 120000, clientInfo: { name, version: '1.0' } }); agents.push(a); return a; };
  // Calls return parsed JSON; errors come back as { error } (McpClient throws on isError).
  const call = async (agent, name, args = {}) => {
    try {
      const res = await agent.callTool(name, args);
      const value = JSON.parse(res.content[0].text);
      result.calls.push({ name, ok: true, images: res.content.filter((c) => c.type === 'image').length });
      return value;
    } catch (error) {
      result.calls.push({ name, ok: false, error: error.message.slice(0, 300) });
      try { return JSON.parse(error.message); } catch { return { error: error.message }; }
    }
  };
  try {
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    const agent = agentNamed('Test agent');
    const init = await agent.start();
    check('the bridge started by the app binary answers initialize with the native instructions', init.serverInfo.name === 'clipcraft' && /complete_edit/.test(init.instructions) && /get_status first/.test(init.instructions));
    const tools = (await agent.listTools()).map((t) => t.name);
    result.tools = tools;
    check('the agent is offered the project tools and the native editor tools', ['get_status', 'list_projects', 'create_project', 'open_project', 'save_project', 'close_project', 'get_project', 'add_text', 'edit_text', 'complete_edit', 'export_video'].every((n) => tools.includes(n)) && tools.length > 60);
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
    check('CraftAI is paused while the agent holds the editor', await q(`!!document.querySelector('#craft-ai-panel .pilot-external')&&document.querySelector('#craft-ai-panel .pilot-external').textContent.includes('Test agent is connected')&&document.querySelector('#craft-ai-panel textarea').disabled`));
    const refused = await q(`window.api.agentStep({requestId:'smoke-step'})`);
    check('the main process refuses CraftAI requests while the agent holds the editor', refused.ok === false && /Test agent is connected/.test(refused.error));

    // An edit: changes, then complete_edit until accepted; Undo removes it as one step.
    const pastBefore = await q('window.__fve.history().past.length');
    const added = await call(agent, 'add_text', { text: 'Hello from MCP', start_sec: 0, duration_sec: 2 });
    check('add_text changes the project and asks for validation', !added.error && added.validation_pending === true && !!added.operation_id);
    const second = await call(agent, 'add_text', { text: 'Second line', start_sec: 2, duration_sec: 2 });
    check('a second change joins the same edit', !second.error && second.validation_pending === true);
    check('the agent edit is open in the editor', await q('!!window.__fve.history().agentEdit&&window.__fve.history().agentEdit.steps.length>=2'));
    let done = null;
    for (let i = 0; i < 6 && !done?.ready; i++) done = await call(agent, 'complete_edit');
    result.completeEdit = { ready: done?.ready, attempts: result.calls.filter((c) => c.name === 'complete_edit').length };
    check('complete_edit accepts the edit', done?.ready === true);
    check('the accepted edit is one Undo step', await q(`!window.__fve.history().agentEdit&&window.__fve.history().past.length===${pastBefore + 1}&&window.__fve.rawProject().textClips.length===2`));
    await until(`[...document.querySelectorAll('#craft-ai-panel .pilot-msg.assistant .bubble')].some(b=>b.textContent.includes('Edit complete and validated.'))`);
    check('the CraftAI panel shows the agent’s steps in its own session', await q(`document.querySelector('#craft-ai-panel .pilot-reply-heading b').textContent==='Test agent'&&document.querySelectorAll('#craft-ai-panel .pilot-steps li').length>=3`));
    await shot('external-editor-activity.png');
    await q(`document.querySelector('#craft-ai-panel .pilot-undo').click()`);
    await until('window.__fve.rawProject().textClips.length===0');
    check('Undo in the panel removes the whole agent edit', true);
    await q(`window.__fve.dispatch({type:'redo'})`);
    await until('window.__fve.rawProject().textClips.length===2');

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
    const modalBefore = await q('document.querySelector(".modal-backdrop")?.innerText||""');
    const byPath = await call(agent, 'open_project', { path: path.join(dir, 'missing.clipcraft.json') });
    result.modals = { before: modalBefore, after: await q('document.querySelector(".modal-backdrop")?.innerText||""') };
    check('opening a missing file reports an error instead of a dialog', /could not be found/.test(byPath.error || '') && !result.modals.after.includes('could not be found'));

    // One agent at a time.
    const intruder = agentNamed('Second agent');
    const blocked = await call(intruder, 'get_status');
    check('a second agent is refused while the first holds the editor', /connected to Test agent/.test(blocked.error || ''));

    // Disconnect from the top bar: CraftAI resumes, the panel records it, the other agent may ask.
    await until('!!document.querySelector(".topbar .external-badge")');
    await shot('external-topbar-badge.png');
    await q(`document.querySelector('.topbar .external-badge button').click()`);
    await until('!document.querySelector(".external-badge")');
    check('Disconnect frees the editor and CraftAI resumes', await q(`!document.querySelector('#craft-ai-panel .pilot-external')||!document.querySelector('#craft-ai-panel .pilot-external').textContent.includes('is connected')`));
    const stepAfter = await q(`window.api.agentStep({requestId:'smoke-step-2'})`);
    check('the main process no longer refuses CraftAI', !/is connected to ClipCraft/.test(stepAfter?.error || ''));
    const denied = call(intruder, 'get_status');
    await until('!!document.querySelector(".external-approve")');
    await q(`[...document.querySelectorAll('.external-approve button')].find(b=>b.textContent.includes('allow')&&!b.classList.contains('btn-primary')).click()`);
    check('a denied agent cannot edit', /did not allow Second agent/.test((await denied).error || ''));

    // Settings: on, the allowed agent listed, the launch commands for this install.
    await q(`window.api.externalStatus()`).then((s) => { result.status = s; });
    check('only the allowed agent is remembered', JSON.stringify(result.status.approved) === JSON.stringify(['Test agent']));
    await q(`document.querySelector('button[aria-label="Settings"],.topbar button[title*="Settings"]').click()`);
    await until('!!document.querySelector(\'[data-section="external"]\')');
    await q(`document.querySelector('[data-section="external"]').click()`);
    await until('document.querySelectorAll(".external-settings-command").length===3');
    const commands = await q(`[...document.querySelectorAll('.external-settings-command')].map(c=>c.textContent)`);
    result.commands = commands;
    check('Settings shows the switch on and the setup for Claude Code, Codex and other clients', await q(`document.querySelector('input[aria-label="Allow external agents"]').checked`)
      && commands[0].startsWith('claude mcp add clipcraft -s user -e ELECTRON_RUN_AS_NODE=1 -- ') && commands[0].includes('bridge.cjs')
      && commands[1].includes('[mcp_servers.clipcraft]') && commands[1].includes('tool_timeout_sec = 900') && JSON.parse(commands[2]).mcpServers.clipcraft.env.ELECTRON_RUN_AS_NODE === '1');
    await shot('external-settings.png');
    // Turning it off stops listening.
    await q(`document.querySelector('input[aria-label="Allow external agents"]').click()`);
    await until(`window.api.externalStatus().then(s=>!s.running&&!s.enabled)`);
    check('turning the switch off removes the endpoint', !fs.existsSync(path.join(dir, 'mcp', 'endpoint.json')));
    const off = await call(agentNamed('Late agent'), 'get_status');
    check('with the switch off agents are told to open ClipCraft and turn it on', /turn on Settings > External agents/.test(off.error || ''));
    check('no interface errors', !result.errors.length);
  } catch (error) {
    result.error = error.stack || error.message;
  } finally {
    for (const a of agents) a.stop();
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    app.exit(result.error ? 1 : 0);
  }
};
