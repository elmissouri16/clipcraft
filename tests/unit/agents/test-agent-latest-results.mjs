// What the model gets back from its latest step, against the real tool runner and context builder:
// - the newest tool results reach the model whole (a get_project of a 20-clip project is not a preview);
// - a stub of the live revision is not labelled outdated;
// - add_narration that places only some lines reports the change and the lines still missing.
// Usage: node tests/unit/agents/test-agent-latest-results.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { prepareContext, projectRevision } from '../../../src/features/agent/context.js';
import geminiTts from '../../../electron/audio/geminiTts.cjs';

const checks = [], check = (name, value) => { assert.ok(value, name); checks.push(name); };
const media = [{ id: 'm', name: 'talk.mp4', type: 'video', duration: 60, width: 1920, height: 1080, hasAudio: true, path: '/x/talk.mp4' },
  { id: 'mus', name: 'music.mp3', type: 'audio', duration: 120, hasAudio: true, path: '/x/music.mp3' }];
const make = (present, api = {}, addProbed) => {
  let state = { past: [], future: [], present: { ...normalizeProject({}), fps: 30, ratio: '16:9', resolution: 1080, width: 1920, height: 1080, ...present } };
  const dispatch = (a) => { state = historyReducer(state, a); };
  const p = () => state.present;
  const runner = createToolRunner({ getProject: p, dispatch, api, settle: async () => {}, fontIds: () => ['montserrat'],
    addProbed: addProbed?.(p, dispatch) || ((res) => { const m = p().media.find((x) => x.path === res.path); if (m) return m; const item = { ...res, id: `media${p().media.length}` }; dispatch({ type: 'addMedia', items: [item] }); return item; }) });
  return { p, run: (name, args) => runner.run(name, args) };
};

// 4. The latest get_project reaches the model whole, also beside many older bulky results.
const videoClips = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, mediaId: 'm', in: i * 2, out: i * 2 + 2, speed: 1, volume: 1 }));
const h = make({ media, videoClips, audioClips: [{ id: 'mu', mediaId: 'mus', in: 0, out: 40, start: 0, speed: 1, layer: 0, volume: 0.3 }] });
const read = await h.run('get_project', {});
const size = JSON.stringify({ result: read }).length;
check('the fixture result is larger than the per-item cap', size > 5000);
const call = { role: 'model', parts: [{ functionCall: { name: 'get_project', args: {} } }] };
const answer = { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: read } } }] };
const older = [];
for (let i = 0; i < 6; i++) older.push(call, { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { ...read, note: `older ${i}` } } } }] });
const contents = [{ role: 'user', parts: [{ text: 'Make it punchier' }] }, ...older, call, answer];
const live = projectRevision(h.p());
const prepared = prepareContext(contents, { maxChars: 120000, liveRevision: live });
check('the latest result reaches the model unchanged', prepared.contents.at(-1) === answer);
check('older bulky results are still abbreviated', prepared.abbreviated > 0 && prepared.sentChars < prepared.originalChars);
const stub = prepared.contents.slice(1, -2).flatMap((t) => t.parts).map((part) => part.functionResponse?.response?.result).find((r) => r?.context_ref);
check('a stub of the live revision is not called outdated', stub && stub.revision === live && !/outdated/.test(stub.note));
const stale = prepareContext(contents, { maxChars: 120000, liveRevision: 'project:other' }).contents.slice(1, -2).flatMap((t) => t.parts).map((part) => part.functionResponse?.response?.result).find((r) => r?.context_ref);
check('a stub of an older revision still says it may be outdated', /outdated/.test(stale.note));
// The latest step is still bounded by the overall budget.
const huge = { role: 'user', parts: [{ functionResponse: { name: 'get_project', response: { result: { revision: live, blob: 'x'.repeat(90000) } } } }] };
const bounded = prepareContext([contents[0], call, huge], { maxChars: 120000, liveRevision: live });
check('a latest result over half the budget is abbreviated', bounded.contents.at(-1).parts[0].functionResponse.response.result.context_ref);
// A new user message: the previous request's results are history again.
const next = prepareContext([...contents, { role: 'model', parts: [{ text: 'Done.' }] }, { role: 'user', parts: [{ text: 'Now louder' }] }], { liveRevision: live });
check('after a new instruction the earlier result is ordinary history', next.contents.at(-3).parts[0].functionResponse.response.result.context_ref);

// 5. add_narration that fails on a later line: the placed lines count as a change, the rest are named.
const voice = make({ media, videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 30, speed: 1 }] }, {
  ttsStatus: async () => ({ extensions: [], elevenKey: false, geminiKey: true, gemini: geminiTts.catalog(), voiceDefault: { engine: 'auto', voice: '' } }),
  ttsSpeakLines: async (req) => ({ items: req.lines.map((t, i) => ({ name: `Voice ${i + 1}.wav`, type: 'audio', duration: 1.5, path: `/fake/voice-${i + 1}.wav` })), mode: 'one_request', requests: 1 }),
}, (p, dispatch) => (res) => {
  if (res.path.endsWith('voice-3.wav')) return null; // the third file cannot be added
  const item = { ...res, id: `media${p().media.length}` }; dispatch({ type: 'addMedia', items: [item] }); return item;
});
const before = voice.p().audioClips.length;
const partial = await voice.run('add_narration', { lines: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }] });
check('a partial narration is reported as a change', partial.changed === true && partial.error && partial.placed_clip_ids.length === 2);
check('the placed lines are on the timeline', voice.p().audioClips.length === before + 2);
check('the lines still missing are named for the retry', partial.remaining_lines.map((l) => l.line).join(',') === '3,4' && partial.remaining_lines[0].text === 'Three');
check('the model is told not to repeat the call unchanged', /remaining lines/.test(partial.error) && /not repeat/i.test(partial.error) && partial.revision === projectRevision(voice.p()));
const none = make({ media }, { ttsStatus: async () => ({ extensions: [], elevenKey: false, geminiKey: true, gemini: geminiTts.catalog(), voiceDefault: { engine: 'auto', voice: '' } }),
  ttsSpeakLines: async (req) => ({ items: req.lines.map((t, i) => ({ name: `V${i}.wav`, type: 'audio', duration: 1, path: `/fake/n-${i}.wav` })), requests: 1 }) }, () => () => null);
const failed = await none.run('add_narration', { lines: ['A', 'B'] });
check('nothing placed: an error without a change', failed.error && !failed.changed && failed.remaining_lines.length === 2);
console.log(`latest results OK: ${checks.length} checks`);
