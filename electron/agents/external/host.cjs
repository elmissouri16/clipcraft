// External agents in the app (docs/design/external-agent-mcp.md): starts the endpoint when the
// setting is on, routes each call to the renderer's external host (src/features/agent/externalHost.js)
// and back through the shared result builder (toolResult.cjs), asks the user to allow new agents,
// and tells the renderer who holds the editor.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { ExternalEndpoint } = require('./endpoint.cjs');
const { LIMITS } = require('../contract.cjs');
const { createToolCaller } = require('../toolResult.cjs');
const { createRunReport } = require('../runReport.cjs');
const { textResult } = require('./protocol.cjs');

const IDLE_MS = 30 * 60 * 1000;
const APPROVAL_MS = 2 * 60 * 1000;
const READY_MS = 20000;

// opts: { ipcMain, getWindow, settings, dir, version, agentFrames, reportDir, launch: () => info }
function createExternalAgents({ ipcMain, getWindow, settings, dir, version, agentFrames, reportDir, launch }) {
  const pending = new Map(); // callId -> { resolve }
  const approvals = new Map(); // approval id -> resolve
  let contract = null; // { tools, aliases } from the renderer's declarations
  let readyWaiters = [];
  let report = null;
  let validateToolCall = null;
  const contents = () => { const win = getWindow(); return win && !win.isDestroyed() ? win.webContents : null; };
  const send = (channel, value) => { const wc = contents(); if (wc && !wc.isDestroyed()) wc.send(channel, value); };
  const fromWindow = (event) => event.sender === contents();

  const endpoint = new ExternalEndpoint({ dir, version, limits: { toolCallTimeoutMs: LIMITS.toolCallTimeoutMs, idleMs: IDLE_MS },
    approve: async (client) => {
      if (settings.getExternalAgents().approved.includes(client.name)) return true;
      if (!contents()) return false;
      const id = crypto.randomUUID();
      const allowed = await new Promise((resolve) => {
        const timer = setTimeout(() => { approvals.delete(id); send('external:approveDone', { id }); resolve(false); }, APPROVAL_MS);
        approvals.set(id, (value) => { clearTimeout(timer); resolve(value); });
        send('external:approve', { id, client });
        getWindow()?.flashFrame?.(true);
      });
      if (allowed) settings.setExternalAgents({ approved: [...settings.getExternalAgents().approved, client.name] });
      return allowed;
    },
    onCall: async (call) => {
      if (!contract && !(await waitReady())) return textResult(JSON.stringify({ error: 'ClipCraft is still starting. Retry in a moment.' }), true);
      validateToolCall ||= (await import(pathToFileURL(path.join(__dirname, '../../../shared/toolArguments.mjs')).href)).validateToolCall;
      const owner = endpoint.owner;
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

  const status = () => ({ ...endpoint.status(), enabled: settings.getExternalAgents().enabled, approved: settings.getExternalAgents().approved, launch: launch() });
  endpoint.on('status', () => send('external:status', status()));
  endpoint.on('claimed', (owner) => { report = createRunReport({ dir: reportDir(), provider: 'external', model: owner.client.name, webResearch: false }); });
  endpoint.on('released', (info) => {
    report?.finish({ outcome: info.reason === 'idle' || info.reason === 'released' ? 'completed' : 'canceled' }); report = null;
    send('external:released', info);
  });

  async function apply() {
    const want = settings.getExternalAgents().enabled;
    try {
      if (want && !endpoint.running) await endpoint.start();
      else if (!want && endpoint.running) await endpoint.stop();
      return { ok: true, status: status() };
    } catch (error) { return { ok: false, error: error.message, status: status() }; }
  }

  // The renderer's tool declarations (project tools + the native list) and instructions.
  ipcMain.handle('external:hostReady', (event, manifest) => {
    // Also sent again when the offer changes (Settings); calls in flight continue. A reload fails
    // them through rendererGone().
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
  ipcMain.handle('external:status', () => status());
  ipcMain.handle('external:setEnabled', async (_event, on) => {
    settings.setExternalAgents({ enabled: on === true });
    if (on !== true) endpoint.disconnect();
    return apply();
  });
  ipcMain.handle('external:disconnect', () => { endpoint.disconnect(); return status(); });
  ipcMain.handle('external:forget', (_event, name) => {
    settings.setExternalAgents({ approved: settings.getExternalAgents().approved.filter((n) => n !== name) });
    if (endpoint.owner?.client.name === name) endpoint.disconnect();
    return status();
  });

  return {
    start: apply,
    // A renderer reload or crash: calls in flight cannot be answered.
    rendererGone() { contract = null; failPending('ClipCraft reloaded during the call. Check the project with get_status, then retry.'); },
    // Who holds the editor, for CraftAI's own requests.
    holder: () => endpoint.owner?.client.name || null,
    stop: () => endpoint.stop(),
  };
}

module.exports = { createExternalAgents };
