// External agents in the app (docs/design/external-agent-mcp.md): runs the MCP endpoint while the
// setting is on, routes each call to the renderer's external host (src/features/agent/externalHost.js)
// and back through the shared result builder (toolResult.cjs), asks the user to allow new agents,
// installs ClipCraft in the agents found on this computer, and tells the renderer who holds the editor.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { ExternalEndpoint, errorResult } = require('./endpoint.cjs');
const { createInstaller } = require('./install.cjs');
const { LIMITS } = require('../contract.cjs');
const { createToolCaller } = require('../toolResult.cjs');
const { createRunReport } = require('../runReport.cjs');

const APPROVAL_MS = 2 * 60 * 1000;
const READY_MS = 20000;
const ENDPOINT_LIMITS = { toolCallTimeoutMs: LIMITS.toolCallTimeoutMs, takeoverMs: 2 * 60 * 1000, sessionIdleMs: 60 * 60 * 1000 };

// opts: { ipcMain, getWindow, settings, version, agentFrames, reportDir, installer: { home, env, searchDirectories } }
function createExternalAgents({ ipcMain, getWindow, settings, version, agentFrames, reportDir, installer: installerOptions }) {
  const pending = new Map(); // callId -> { resolve, progress }
  const approvals = new Map(); // approval id -> resolve
  let contract = null; // { tools, aliases } from the renderer's declarations
  let readyWaiters = [];
  let report = null;
  let validateToolCall = null;
  let craftBusy = false;
  const installer = createInstaller(installerOptions);
  const contents = () => { const win = getWindow(); return win && !win.isDestroyed() ? win.webContents : null; };
  const send = (channel, value) => { const wc = contents(); if (wc && !wc.isDestroyed()) wc.send(channel, value); };
  const fromWindow = (event) => event.sender === contents();
  const config = () => settings.getExternalAgents();
  const connection = () => ({ url: endpoint.url, token: settings.externalToken() });

  const endpoint = new ExternalEndpoint({ port: config().port, token: settings.externalToken(), version, limits: ENDPOINT_LIMITS,
    isCraftBusy: () => craftBusy,
    approve: async (client) => {
      if (config().approved.includes(client.name)) return true;
      if (!contents()) return false;
      const id = crypto.randomUUID();
      const allowed = await new Promise((resolve) => {
        const timer = setTimeout(() => { approvals.delete(id); send('external:approveDone', { id }); resolve(false); }, APPROVAL_MS);
        approvals.set(id, (value) => { clearTimeout(timer); resolve(value); });
        send('external:approve', { id, client });
        getWindow()?.flashFrame?.(true);
      });
      if (allowed) settings.setExternalAgents({ approved: [...config().approved, client.name] });
      return allowed;
    },
    onCall: async (call, owner) => {
      if (!contract && !(await waitReady())) return errorResult('ClipCraft is still starting. Retry in a moment.');
      validateToolCall ||= (await import(pathToFileURL(path.join(__dirname, '../../../shared/toolArguments.mjs')).href)).validateToolCall;
      const invoke = (name, args) => new Promise((resolve) => {
        if (call.signal.aborted) return resolve({ error: 'Stopped.', canceled: true });
        pending.set(call.id, { resolve, progress: call.progress });
        call.signal.addEventListener('abort', () => send('external:cancel', { callId: call.id }), { once: true });
        send('external:call', { callId: call.id, name, args, client: owner?.client || null });
      });
      const caller = createToolCaller({ tools: contract.tools, aliases: contract.aliases, validateToolCall, report, invoke, agentFrames,
        ownerId: contents()?.id, requestId: call.id, provider: 'external', model: owner?.client?.name || '' });
      return caller(call.name, call.args);
    },
  });
  const waitReady = () => new Promise((resolve) => {
    const timer = setTimeout(() => { readyWaiters = readyWaiters.filter((w) => w !== done); resolve(false); }, READY_MS);
    const done = () => { clearTimeout(timer); resolve(true); };
    readyWaiters.push(done);
  });
  const failPending = (error) => { for (const [id, call] of pending) { pending.delete(id); call.resolve({ error }); } };

  const status = () => ({ ...endpoint.status(), enabled: config().enabled, approved: config().approved });
  endpoint.on('status', () => send('external:status', status()));
  endpoint.on('claimed', ({ client }) => { report = createRunReport({ dir: reportDir(), provider: 'external', model: client.name, webResearch: false }); });
  endpoint.on('released', (info) => {
    report?.finish({ outcome: ['disconnected', 'stopped'].includes(info.reason) ? 'canceled' : 'completed' }); report = null;
    send('external:released', info);
  });

  async function apply() {
    try {
      if (config().enabled && !endpoint.running) await endpoint.start();
      else if (!config().enabled && endpoint.running) await endpoint.stop();
      return { ok: true, status: status() };
    } catch (error) { return { ok: false, error: error.message, status: status() }; }
  }

  // The renderer's tool declarations (project tools + the native list) and instructions. Sent again
  // when the offer changes (Settings); calls in flight continue. A reload fails them (rendererGone).
  ipcMain.handle('external:hostReady', (event, manifest) => {
    if (!fromWindow(event) || !Array.isArray(manifest?.tools) || manifest.tools.length > 160) return false;
    const { wireTools } = require('../contract.cjs');
    contract = wireTools(manifest.tools);
    endpoint.setManifest({ tools: contract.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })), instructions: manifest.instructions });
    for (const done of readyWaiters.splice(0)) done();
    return status();
  });
  ipcMain.handle('external:result', (event, req) => {
    if (!fromWindow(event)) return false;
    const call = pending.get(req?.callId);
    if (!call) return false;
    pending.delete(req.callId); call.resolve(req.result && typeof req.result === 'object' ? req.result : { error: 'Tool returned no valid result.' });
    return true;
  });
  ipcMain.handle('external:progress', (event, req) => {
    if (!fromWindow(event)) return;
    const call = pending.get(req?.callId);
    if (call) { call.count = (call.count || 0) + 1; call.progress(call.count, req.label); }
  });
  ipcMain.handle('external:approval', (event, req) => {
    if (!fromWindow(event)) return false;
    const resolve = approvals.get(req?.id);
    if (!resolve) return false;
    approvals.delete(req.id); resolve(req.allow === true); return true;
  });
  // CraftAI running in the renderer: outside agents may not take the editor meanwhile.
  ipcMain.handle('external:craftBusy', (event, busy) => { if (fromWindow(event)) craftBusy = busy === true; });
  ipcMain.handle('external:status', () => status());
  ipcMain.handle('external:setEnabled', async (_event, on) => {
    settings.setExternalAgents({ enabled: on === true });
    return apply();
  });
  ipcMain.handle('external:disconnect', async () => { await endpoint.disconnect(); return status(); });
  ipcMain.handle('external:forget', async (_event, name) => {
    settings.setExternalAgents({ approved: config().approved.filter((n) => n !== name) });
    if (endpoint.owner?.client?.name === name) await endpoint.disconnect();
    return status();
  });
  // The agents on this computer and whether ClipCraft is set up in each.
  ipcMain.handle('external:agents', async () => {
    try { return { agents: await installer.list(connection()) }; } catch (error) { return { error: error.message, agents: [] }; }
  });
  ipcMain.handle('external:install', async (_event, id) => {
    try { await installer.install(String(id), connection()); return { ok: true, agents: await installer.list(connection()) }; }
    catch (error) { return { ok: false, error: error.message, agents: await installer.list(connection()).catch(() => []) }; }
  });
  ipcMain.handle('external:uninstall', async (_event, id) => {
    try { await installer.remove(String(id)); return { ok: true, agents: await installer.list(connection()) }; }
    catch (error) { return { ok: false, error: error.message, agents: await installer.list(connection()).catch(() => []) }; }
  });
  // For MCP clients without an Install button: the usual mcpServers JSON, token included.
  ipcMain.handle('external:manualConfig', () => {
    const { url, token } = connection();
    return JSON.stringify({ mcpServers: { clipcraft: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  });

  return {
    start: apply,
    // A renderer reload or crash: calls in flight cannot be answered.
    rendererGone() { contract = null; failPending('ClipCraft reloaded during the call. Check the project with get_status, then retry.'); },
    // CraftAI wants to start: the agent's name while it is working (refuse), else null (editor freed).
    yieldToCraft: () => endpoint.yieldToCraft(),
    stop: () => endpoint.stop(),
  };
}

module.exports = { createExternalAgents };
