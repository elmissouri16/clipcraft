// An outside agent's session lasts across its edits (docs/design/external-agent-mcp.md):
// - the main process presents its frames under one session identity and the renderer checks evidence
//   under that same identity, so frames inspected in one call are evidence in a later one;
// - search_sounds / search_stock ids stay valid for a later add_sound / add_stock, though each read
//   closes its edit; a new connection starts with no search results.
// Plain Node: the endpoint and the window are fakes, the host modules are real.
// Usage: node tests/unit/agents/test-external-session.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };

// ---- Main process: external/host.cjs with a fake endpoint and a fake window.
const endpointFile = require.resolve('../../../electron/agents/external/endpoint.cjs');
let endpointOptions = null;
class FakeEndpoint { constructor(options) { endpointOptions = options; this.running = false; this.url = 'http://127.0.0.1:1/mcp'; } on() {} status() { return {}; } setManifest() {} async start() {} async stop() {} }
require.cache[endpointFile] = { id: endpointFile, filename: endpointFile, loaded: true, exports: { ExternalEndpoint: FakeEndpoint, errorResult: (error) => ({ isError: true, content: [{ type: 'text', text: error }] }) } };
const { createExternalAgents } = require('../../../electron/agents/external/host.cjs');
const { AgentFrames } = require('../../../electron/agents/agentFrames.cjs');
const frames = new AgentFrames(async () => { throw new Error('no capture'); });
const handlers = new Map(), sent = [];
const webContents = { id: 7, isDestroyed: () => false, send: (channel, value) => {
  sent.push({ channel, value });
  if (channel !== 'external:call') return;
  // The renderer answers: inspect_frames returns one frame; other calls return their name.
  const result = value.name === 'inspect_frames' ? { frames: [frames.addExternal(7, Buffer.from([255, 216, 255, 224, 0, 16, 0, 0]), { revision: 'r1', label: 'frame' })] } : { ok: true };
  setImmediate(() => handlers.get('external:result')({ sender: webContents }, { callId: value.callId, result }));
} };
createExternalAgents({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, getWindow: () => ({ isDestroyed: () => false, webContents }),
  settings: { getExternalAgents: () => ({ enabled: false, port: 0, approved: [] }), externalToken: () => 'token' }, version: '0', agentFrames: frames,
  reportDir: () => path.join(process.cwd(), 'unused'), installer: { home: process.cwd(), env: {}, searchDirectories: () => [] } });
handlers.get('external:hostReady')({ sender: webContents }, { tools: [{ name: 'inspect_frames', parameters: { type: 'OBJECT', properties: {} } }, { name: 'get_project', parameters: { type: 'OBJECT', properties: {} } }], instructions: '' });
const owner = { client: { name: 'Outside' } }, other = { client: { name: 'Other' } };
const mcpCall = (id, name, who = owner) => endpointOptions.onCall({ id, name, args: {}, signal: new AbortController().signal, progress: () => {} }, who);
try {
  const shown = await mcpCall('mcp-1', 'inspect_frames');
  check('the inspected frame is returned to the agent', shown.content.some((c) => c.type === 'image'));
  await mcpCall('mcp-2', 'get_project');
  const calls = sent.filter((s) => s.channel === 'external:call').map((s) => s.value);
  const session = calls[0].session;
  check('every call of one MCP session carries the same session identity', typeof session === 'string' && session && calls.every((c) => c.session === session));
  const frameId = JSON.parse(shown.content[0].text).frames[0].id;
  check('the frame is presented under the session identity, not the MCP call id', frames.records.get(frameId).presentedFor === session);
  check('evidence checked under the session identity is accepted in a later call', frames.evidence(7, [frameId], session).length === 1);
  assert.throws(() => frames.evidence(7, [frameId], 'mcp-1'));
  await mcpCall('mcp-3', 'get_project', other);
  check('another MCP session gets another identity', sent.filter((s) => s.channel === 'external:call').at(-1).value.session !== session);
} finally { frames.dispose(); }

// ---- Renderer: externalHost.js keeps search results and the evidence identity across edits.
const { emptyProject, historyReducer } = await import('../../../src/state/store.js');
const { createExternalHost } = await import('../../../src/features/agent/externalHost.js');
const probed = (name, type, duration) => ({ name, type, duration, path: `/fake/${name}`, ...(type === 'audio' ? {} : { width: 1280, height: 720 }) });
const requests = [];
globalThis.window = { api: { agentCancel: async () => {}, externalProgress: () => {},
  librarySearch: async () => ({ results: [{ id: 'freesound-1', title: 'Whoosh', duration: 1.2, creator: 'X', license: 'cc0' }] }),
  libraryAdd: async (item) => probed(`${item.title}.mp3`, 'audio', item.duration),
  stockSearch: async (o) => ({ results: [{ id: '77', kind: o.kind, tags: 'city', duration: 12, width: 1920, height: 1080 }] }),
  stockAdd: async (item) => probed(`city ${item.id}.mp4`, 'video', 12),
  agentAnnotateScene: async (req) => { requests.push(req); return { error: 'stub' }; },
} };
let s = { past: [], future: [], present: { ...emptyProject(), media: [{ id: 'm', name: 'talk', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, path: '/x/talk.mp4' }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }] } };
const dispatch = (a) => { s = historyReducer(s, a); };
const edits = [];
const host = createExternalHost({ screen: () => 'editor', project: () => s.present, loadVersion: () => 1, dispatch, settle: async () => {},
  pilotApp: { getAgentEdit: () => s.agentEdit, getAgentInterruption: () => s.agentInterruption, getEditorState: () => ({ playhead_sec: 0 }),
    addProbed: (res, token) => { const m = s.present.media.find((x) => x.path === res.path); if (m) return m; dispatch({ type: 'addMedia', items: [{ ...res, id: `media${s.present.media.length}` }], agentToken: token }); return s.present.media.at(-1); } },
  provider: () => 'external', craftBusy: () => false, projects: { status: () => ({}) }, onActivity: (e) => { if (e.type === 'edit-start') edits.push(e.editId); } });
let n = 0;
const call = (name, args, session = 'external:one') => host.call({ callId: `c${n++}`, name, args, client: { name: 'Outside' }, session });
const sounds = await call('search_sounds', { kind: 'sfx', query: 'whoosh' });
check('a search alone leaves no edit open', !host.status().edit_open);
const sound = await call('add_sound', { sound_id: sounds.sounds[0].sound_id, start_sec: 1 });
check('a search id is valid in the next edit', !sound.error && s.present.audioClips.length === 1);
const stock = await call('search_stock', { kind: 'video', query: 'city' });
await call('complete_edit', {});
const added = await call('add_stock', { stock_id: stock.items[0].stock_id });
check('stock ids stay valid after another edit was completed', !added.error && s.present.overlayClips.length === 1 && edits.length >= 2);
await call('annotate_scene', { media_id: 'm', analysis_id: 'a', shot_id: 's', frame_ids: ['f'], description: 'x', tags: [] });
check('the renderer checks evidence under the session identity, not the edit token', requests.at(-1).evidenceId === 'external:one' && requests.at(-1).requestId !== 'external:one');
await call('complete_edit', {});
await host.release();
const after = await call('add_sound', { sound_id: sounds.sounds[0].sound_id, start_sec: 3 }, 'external:two');
check('a new connection does not reuse the previous session\'s search ids', !!after.error);
console.log(`external session OK: ${checks.length} checks`);
