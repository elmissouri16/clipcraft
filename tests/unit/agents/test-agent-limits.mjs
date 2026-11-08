// The shared limits (electron/agents/contract.cjs LIMITS) apply to every agent through the session
// manager, not through an agent's own options: the tool call budget (complete_edit stays callable),
// the per-call timeout, the completion attempts and the image cap.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');
const { LIMITS } = require('../../../electron/agents/contract.cjs');

// A stand-in for an agent session: each turn runs the script it is given.
let script = async () => ({ text: 'done' }), seenImages = [];
class FakeSession { constructor() {} async run({ onTool, images }) { seenImages.push(images.length); return script(onTool); } close() {} get tokenUsage() { return null; } }
const make = (limits) => createNativeAgents({ loadSdk: async () => ({}), resolveExecutable: () => '/fake', childEnv: () => ({}), CodexSession: FakeSession, ...(limits ? { limits } : {}) });
const parse = (r) => JSON.parse(r.content[0].text);
const base = { sessionKey: 's', tools: [], system: 'S', prompt: 'P', isComplete: async () => true };

// The app's own limits.
assert.equal(LIMITS.toolCallsPerRequest, 300); assert.equal(LIMITS.toolCallTimeoutMs, 15 * 60 * 1000); assert.equal(LIMITS.completionAttempts, 3);
assert.ok(Object.isFrozen(LIMITS));

// Budget: calls past it are answered by the host; complete_edit is never refused.
{
  const agents = make({ ...LIMITS, toolCallsPerRequest: 3 }); let ran = 0; const results = [];
  script = async (onTool) => { for (let i = 0; i < 5; i++) results.push(await onTool('add_text', { i })); results.push(await onTool('complete_edit', {})); return { text: 'ok' }; };
  await agents.run({ provider: 'codex-sdk' }, { ...base, onTool: async (name) => { ran++; return { content: [{ type: 'text', text: JSON.stringify({ ok: name }) }] }; } });
  assert.equal(ran, 4, 'three edits and complete_edit ran');
  assert.match(parse(results[3]).error, /limit of 3 tool calls/); assert.equal(results[3].isError, true);
  assert.deepEqual(parse(results[5]), { ok: 'complete_edit' }, 'complete_edit runs past the budget');
  agents.close();
}
// Timeout: a call that hangs is answered by the host after the shared timeout.
{
  const agents = make({ ...LIMITS, toolCallTimeoutMs: 40 }); let out;
  script = async (onTool) => { out = await onTool('export_video', {}); return { text: 'ok' }; };
  await agents.run({ provider: 'codex-sdk' }, { ...base, onTool: () => new Promise(() => {}) });
  assert.match(parse(out).error, /export_video did not finish within/); assert.equal(out.isError, true);
  agents.close();
}
// Completion attempts: an agent that never completes gets the shared number of turns.
{
  const agents = make({ ...LIMITS, completionAttempts: 2 }); let turns = 0;
  script = async () => { turns++; return { text: 'not yet' }; };
  await assert.rejects(agents.run({ provider: 'codex-sdk' }, { ...base, isComplete: async () => false, onTool: async () => ({ content: [] }) }), /without completing editor validation/);
  assert.equal(turns, 2);
  agents.close();
}
// Images: the shared cap on attached images.
{
  const agents = make({ ...LIMITS, imagesPerRequest: 2 }); seenImages = [];
  script = async () => ({ text: 'ok' });
  await agents.run({ provider: 'codex-sdk' }, { ...base, images: [1, 2, 3, 4], onTool: async () => ({ content: [] }) });
  assert.deepEqual(seenImages, [2]);
  agents.close();
}
console.log('AGENT LIMITS OK (budget with complete_edit exempt, per-call timeout, completion attempts, image cap; host-enforced)');
