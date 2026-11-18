// The native editor request (agent:runNative in electron/main.cjs) must not stop a long edit before
// the documented budget: LIMITS.toolCallsPerRequest is enforced gently by nativeAgents.cjs, the host's
// hard cap is only a backstop above it, complete_edit and the completion check are never counted, and
// an analysis subagent's calls are not charged to the parent request.
// Runs the real handler source with the real session manager and a scripted agent session.
// Usage: node tests/unit/agents/test-native-call-budget.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../../..');
const mainFile = path.join(root, 'electron/main.cjs');
const source = fs.readFileSync(mainFile, 'utf8');
const from = source.indexOf("ipcMain.handle('agent:nativeToolResult'"), to = source.indexOf('const analysisDelegation');
assert.ok(from > 0 && to > from, 'the native request handlers are found in electron/main.cjs');
const handlerSource = source.slice(from, to).replace("'../shared/toolArguments.mjs'", JSON.stringify(pathToFileURL(path.join(root, 'shared/toolArguments.mjs')).href));
const mainRequire = createRequire(mainFile);
const { checkAbort, activityTimeout } = mainRequire('./system/cancel.cjs');
const { createNativeAgents } = mainRequire('./agents/nativeAgents.cjs');
const { LIMITS } = mainRequire('./agents/contract.cjs');
const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-native-budget-'));

// script(onTool, job) plays the agent's side of one request.
async function request(script) {
  const handlers = {}, nativeRuns = new Map();
  const counts = { editor: 0, analysis: 0 };
  class ScriptedSession { async run({ onTool }) { return script(onTool, [...nativeRuns.values()][0]); } close() {} }
  const native = createNativeAgents({ loadSdk: async () => ({}), resolveExecutable: () => '/bin/false', childEnv: () => ({}), CodexSession: ScriptedSession });
  const deps = {
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, nativeRuns, agentRequests: new Map(), nativeOwners: new Set(), externalHolder: () => null,
    localAgents: { isProvider: (p) => p === 'codex-sdk', runEditorNative: native.run, closeNativeOwner: () => {} },
    settings: { getActive: () => ({ provider: 'codex-sdk', model: 'test' }) },
    chatImages: { native: async (prompt, history) => ({ prompt, history, images: [], historyImages: [] }) },
    crashDir: () => reports, agentFrames: { images: () => [], markPresented: () => {} }, checkAbort, activityTimeout,
    agentRequestKey: (event, id) => `${event.sender.id}:${id}`, require: mainRequire,
  };
  new Function(...Object.keys(deps), handlerSource)(...Object.values(deps));
  // The renderer's tool host answers every callback at once.
  const event = { sender: { id: 1, isDestroyed: () => false, once() {}, removeListener() {}, send(channel, payload) {
    if (channel !== 'agent:nativeTool') return;
    counts[payload.analysis ? 'analysis' : 'editor']++;
    setImmediate(() => handlers['agent:nativeToolResult'](event, { requestId: payload.requestId, callId: payload.callId, result: payload.name === '__native_status' ? { ready: true } : { ok: true } }));
  } } };
  const tool = (name) => ({ name, description: name, parameters: { type: 'OBJECT', properties: {} } });
  const result = await handlers['agent:runNative'](event, { provider: 'codex-sdk', requestId: 'r1', sessionKey: 's1', system: 'sys', prompt: 'edit', history: [], tools: [tool('get_project'), tool('complete_edit')] });
  return { result, counts };
}

(async () => {
  try {
    // The whole documented budget, then complete_edit: the edit validates.
    let completed = false;
    const full = await request(async (onTool) => {
      for (let i = 0; i < LIMITS.toolCallsPerRequest; i++) assert.ok(!(await onTool('get_project', {}, { nativeCallId: `c${i}`, turnId: 't' })).isError, `call ${i + 1} is served`);
      completed = !(await onTool('complete_edit', {}, { nativeCallId: 'done', turnId: 't' })).isError;
      return { text: 'Done.' };
    });
    assert.equal(full.result.ok, true, JSON.stringify(full.result));
    assert.ok(completed, 'complete_edit runs after the full budget');
    assert.ok(full.counts.editor > LIMITS.toolCallsPerRequest + 1, 'the host completion check runs too, uncounted');

    // Over budget: the session manager answers the agent itself (the request is not killed), and
    // complete_edit still goes through.
    const over = await request(async (onTool) => {
      for (let i = 0; i < LIMITS.toolCallsPerRequest; i++) await onTool('get_project', {}, { nativeCallId: `c${i}`, turnId: 't' });
      const refused = await onTool('get_project', {}, { nativeCallId: 'extra', turnId: 't' });
      assert.ok(refused.isError && /limit/.test(JSON.stringify(refused)), 'the call past the budget gets a host answer');
      assert.ok(!(await onTool('complete_edit', {}, { nativeCallId: 'done', turnId: 't' })).isError, 'complete_edit is never refused for budget');
      return { text: 'Stopped at the budget.' };
    });
    assert.equal(over.result.ok, true, JSON.stringify(over.result));

    // An analysis subagent's calls run through the same host but are not the parent's budget.
    const delegated = await request(async (onTool, job) => {
      for (let i = 0; i < 200; i++) await job.invokeAnalysis('get_project', {}, { request_id: 'sub-1' });
      for (let i = 0; i < 250; i++) await onTool('get_project', {}, { nativeCallId: `c${i}`, turnId: 't' });
      await onTool('complete_edit', {}, { nativeCallId: 'done', turnId: 't' });
      return { text: 'Done.' };
    });
    assert.equal(delegated.result.ok, true, JSON.stringify(delegated.result));
    assert.equal(delegated.counts.analysis, 200);
    assert.ok(delegated.counts.editor >= 251);
    console.log('NATIVE CALL BUDGET OK');
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
