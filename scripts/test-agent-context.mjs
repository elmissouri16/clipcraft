import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyProject, historyReducer } from '../src/store.js';
import { TOOL_DECLARATIONS, createToolRunner } from '../src/agent/tools.js';
import { CORE_TOOLS, CONTEXT_TOOLS, TOOL_GROUPS, createToolCatalog } from '../src/agent/toolCatalog.js';
import { prepareContext, projectRevision, recallContext, latestEditorRevision } from '../src/agent/context.js';
import { runAgent } from '../src/agent/runAgent.js';

const catalog = createToolCatalog(TOOL_DECLARATIONS, [{ name: 'mcp_demo_lookup', description: 'External test', parameters: {} }]);
assert.equal(catalog.tools().length, CORE_TOOLS.length + CONTEXT_TOOLS.length);
assert.ok(!catalog.tools().some((t) => t.name.startsWith('mcp_')));
assert.ok(catalog.load(['wrong']).error);
assert.equal(catalog.load(['text', 'motion', 'external']).ok, true);
assert.ok(catalog.tools().some((t) => t.name === 'add_captions'));
assert.ok(catalog.tools().some((t) => t.name === 'mcp_demo_lookup'));
assert.ok(catalog.tools().some((t) => t.name === 'add_keyframes'));
assert.ok(!catalog.tools().some((t) => t.name === 'export_video'));
const grouped = [...CORE_TOOLS, ...Object.values(TOOL_GROUPS).flat()];
assert.equal(new Set(grouped).size, TOOL_DECLARATIONS.length);
assert.deepEqual([...grouped].sort(), TOOL_DECLARATIONS.map((t) => t.name).sort());

const iconSource = fs.readFileSync(new URL('../src/components/ToolCallIcon.jsx', import.meta.url), 'utf8');
const iconMap = new Map([...iconSource.matchAll(/(\w+): (\w+)/g)].map((m) => [m[1], m[2]]));
const toolNames = [...TOOL_DECLARATIONS, ...CONTEXT_TOOLS].map((t) => t.name);
assert.ok(toolNames.every((name) => iconMap.has(name)), 'every built-in tool has an action icon');
assert.equal(new Set(toolNames.map((name) => iconMap.get(name))).size, toolNames.length, 'built-in tools have distinct icons');

const fullResult = { segments: Array.from({ length: 400 }, (_, i) => ({ start: i, end: i + 1, text: `Segment ${i}: ` + 'speech '.repeat(35) })) };
const conv = [{ role: 'user', parts: [{ text: 'Keep the entire user instruction, including prior constraints.' }] }];
for (let i = 0; i < 12; i++) {
  conv.push({ role: 'model', parts: [{ functionCall: { name: 'transcribe', args: { language: 'en' } }, thoughtSignature: `sig-${i}` }] },
    { role: 'user', parts: [{ functionResponse: { name: 'transcribe', response: { result: fullResult } } }] });
}
conv.push({ role: 'model', parts: [{ text: 'Previous answer.' }] }, { role: 'user', parts: [{ text: 'Continue.' }] });
const original = JSON.stringify(conv);
const reduced = prepareContext(conv);
assert.equal(JSON.stringify(conv), original, 'saved conversation stays intact');
assert.equal(reduced.contents[0], conv[0], 'user instructions survive unchanged');
assert.equal(reduced.contents[1], conv[1], 'model reasoning and signatures survive unchanged');
assert.equal(reduced.contents.at(-1), conv.at(-1));
assert.ok(reduced.sentChars < reduced.originalChars / 5);
const ref = reduced.contents[2].parts[0].functionResponse.response.result.context_ref;
let recovered = '', offset = 0;
do {
  const page = recallContext(conv, { ref, offset, max_chars: 6000 });
  recovered += page.text; offset = page.next_offset;
} while (offset !== null);
assert.equal(recovered, JSON.stringify(fullResult));
assert.ok(recallContext(conv, { ref, query: 'Segment 399' }).text.includes('Segment 399'));
assert.ok(recallContext(conv, { ref: 'tool:999:0' }).error);
assert.equal(recallContext(conv, { ref, query: 'does not exist' }).found, false);
const recallTurn = { role: 'user', parts: [{ functionResponse: { name: 'recall_context', response: { result: recallContext(conv, { ref, max_chars: 6000 }) } } }] };
assert.equal(prepareContext([...conv, recallTurn]).contents.at(-1), recallTurn, 'a recalled page is not immediately abbreviated again');

let state = { past: [], present: emptyProject(), future: [] };
state.present.media = [{ id: 'm1', name: 'Sample', path: '/sample.mp4', type: 'video', duration: 300 }];
state.present.videoClips = Array.from({ length: 150 }, (_, i) => ({ id: `v${i}`, mediaId: 'm1', in: 0, out: 2, speed: 1 }));
state.present.textClips = [{ id: 'caption', caption: true, text: 'Actual caption', start: 0, duration: 1 }];
state.present.audioClips = [{ id: 'a1', mediaId: 'm1', start: 1, in: 0, out: 8, speed: 2 }];
const revision = projectRevision(state.present);
assert.equal(projectRevision({ ...state.present, craftAI: { arbitrary: 'chat changed' } }), revision);
assert.equal(projectRevision({ ...state.present, media: [{ ...state.present.media[0], thumb: '/new-thumb.jpg', wave: '/wave.png', poster: '/poster.jpg' }] }), revision);
let transcriptions = 0;
const ctx = { getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, settle: async () => {},
  api: { runCaptions: async () => { transcriptions++; return { ok: true, segments: [{ start: 0, end: 1, text: 'Hi' }] }; } } };
const runner = createToolRunner(ctx);
assert.ok((await runner.run('constructor', {})).error);
const read = await runner.run('get_project', { scope: 'main', offset: 30, limit: 10 });
assert.equal((await runner.run('get_project', { scope: 'audio' })).audio_track[0].end, 5, 'audio context uses timeline speed');
assert.equal(read.main_track.length, 10);
assert.equal(read.main_track[0].id, 'v30');
assert.equal(read.pages.main.next_offset, 40);
assert.equal(read.media_library, undefined);
assert.equal(read.counts.main, 150);
assert.deepEqual(await runner.run('get_project', { if_revision: revision }), { revision, unchanged: true });
assert.equal((await runner.run('get_project', { clip_ids: ['v149', 'caption'] })).caption_lines[0].text, 'Actual caption');
assert.equal((await runner.run('get_project', { scope: 'captions' })).caption_lines[0].id, 'caption');
assert.ok((await runner.run('get_project', { scope: 'missing' })).error);
await runner.run('transcribe', { language: 'en' }); await runner.run('transcribe', { language: 'en' });
assert.equal(transcriptions, 1, 'repeated read-only work is cached within a run');
ctx.dispatch({ type: 'setProject', patch: { name: 'Manual change' } });
assert.notEqual(projectRevision(state.present), revision);
await runner.run('transcribe', { language: 'en' });
assert.equal(transcriptions, 2, 'edits invalidate cached reads');
assert.equal(latestEditorRevision([{ role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: read } } }] }]), revision);

const requests = [], events = [];
ctx.api.agentStep = async (req) => {
  requests.push(structuredClone(req));
  const calls = requests.length === 1 ? [{ name: 'load_tools', args: { groups: ['text'] } }]
    : requests.length === 2 ? [{ name: 'add_text', args: { text: 'Context verified', duration_sec: 2 } }]
      : [];
  return { ok: true, provider: 'codex-sdk', calls, text: calls.length ? '' : 'Done.', content: { role: 'model', parts: calls.length ? calls.map((call) => ({ functionCall: call })) : [{ text: 'Done.' }] } };
};
const result = await runAgent({ contents: [{ role: 'user', parts: [{ text: 'Add a title' }] }], ctx,
  onEvent: (event) => events.push(event), isCanceled: () => false, requestId: 'context-test' });
assert.equal(result.changed, true);
assert.ok(!requests[0].tools.some((t) => t.name === 'add_text'));
assert.ok(requests[1].tools.some((t) => t.name === 'add_text'));
assert.ok(requests.every((req) => !req.tools.some((t) => t.name === 'export_video')));
assert.equal(result.contextUsage.requests, 3);
assert.ok(events.some((event) => event.type === 'context'));
assert.ok(state.present.textClips.some((clip) => clip.text === 'Context verified'));
assert.ok(requests.at(-1).system.includes('Matches the latest editor result'));
assert.equal(latestEditorRevision([{ role: 'user', parts: [{ functionResponse: { name: 'set_project', response: { result: { revision: 'after-edit' } } } }] }]), 'after-edit');
const initialCatalogChars = JSON.stringify(createToolCatalog(TOOL_DECLARATIONS).tools()).length;
const evidence = { initialCatalogChars, fullCatalogChars: JSON.stringify(TOOL_DECLARATIONS).length,
  originalContextChars: reduced.originalChars, sentContextChars: reduced.sentChars, contextUsage: result.contextUsage };
if (process.env.AGENT_CONTEXT_EVIDENCE) fs.writeFileSync(process.env.AGENT_CONTEXT_EVIDENCE, JSON.stringify(evidence, null, 2));
console.log('agent context ok (lazy tools, exact recall, signed history, pagination, cache invalidation, icons, editor loop)');
