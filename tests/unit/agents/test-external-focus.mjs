// Timeline spotlight and trail for an outside MCP agent (src/features/agent/externalFocus.js): the external
// host's activity events become the same App.agentFocus value CraftPilot emits for its own turns — the running
// tool's targets live, finished changes in the trail, the edit's end a null that starts the hold and fade.
// Usage: node tests/unit/agents/test-external-focus.mjs
import assert from 'node:assert/strict';
import { externalFocusStep } from '../../../src/features/agent/externalFocus.js';

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const RUN = 'p1:0', targets = { clips: [{ track: 'video', id: 'v1' }], ranges: [] };
const tool = (id, status, extra = {}) => ({ type: 'tool', editId: 'e1', client: 'Claude Code', id, name: 'trim_clip', label: 'Trimming', status, activity: { title: 'Trimming a clip', ...extra } });

let step = externalFocusStep(null, { type: 'edit-start', editId: 'e1', client: 'Claude Code' }, RUN);
check('an edit start opens a run keyed on the project and named after the client', step.changed && step.focus.runKey === RUN && step.focus.requestId === 'e1' && step.focus.agent === 'Claude Code' && step.focus.live === null && step.focus.trail.length === 0);
step = externalFocusStep(step.focus, tool('native-0', 'running', { targets }), RUN);
check('a running tool with targets is the live spotlight, with the tool title and a step id unique to the edit', step.changed && step.focus.live.id === 'e1:native-0' && step.focus.live.title === 'Trimming a clip' && step.focus.live.targets === targets);
const progress = externalFocusStep(step.focus, tool('native-0', 'running', { targets }), RUN);
check('a progress update keeps the same live step id', progress.focus.live.id === 'e1:native-0');
step = externalFocusStep(step.focus, tool('native-0', 'done', { targets: { clips: [{ track: 'video', id: 'v1' }], created: [] } }), RUN);
check('a finished change leaves the trail and clears the spotlight', step.changed && step.focus.live === null && step.focus.trail.length === 1 && step.focus.trail[0].id === 'e1:native-0');
step = externalFocusStep(step.focus, tool('native-1', 'running'), RUN);
check('a running read without targets shows no spotlight', step.changed && step.focus.live === null);
step = externalFocusStep(step.focus, tool('native-1', 'done'), RUN);
check('a read leaves no trail', step.focus.trail.length === 1);
step = externalFocusStep(step.focus, tool('native-2', 'error', { targets }), RUN);
check('a failed call leaves no trail', step.focus.live === null && step.focus.trail.length === 1);
check('a tool event from another edit is ignored', externalFocusStep(step.focus, { ...tool('native-9', 'done', { targets }), editId: 'other' }, RUN).changed === false);
let many = step.focus;
for (let i = 0; i < 40; i++) many = externalFocusStep(many, tool(`n${i}`, 'done', { targets }), RUN).focus;
check('the trail keeps the last 24 changes', many.trail.length === 24 && many.trail.at(-1).id === 'e1:n39');
step = externalFocusStep(step.focus, { type: 'edit-end', editId: 'e1', reason: 'validated', changed: true }, RUN);
check('the edit end ends the run (null starts the hold and fade)', step.changed && step.focus === null);
check('an end with no run open changes nothing', externalFocusStep(null, { type: 'agent-released', client: 'Claude Code' }, RUN).changed === false);
check('a tool event with no run open changes nothing', externalFocusStep(null, tool('native-0', 'running', { targets }), RUN).changed === false);
check('malformed events never throw', externalFocusStep(null, null, RUN).changed === false && externalFocusStep(step.focus, 'x', RUN).changed === false && externalFocusStep({ runKey: RUN, requestId: 'e1', agent: 'x', live: null, trail: [] }, { type: 'tool', editId: 'e1', id: 'q', status: 'done' }, RUN).focus.trail.length === 0);
const released = externalFocusStep({ runKey: RUN, requestId: 'e1', agent: 'x', live: null, trail: [] }, { type: 'agent-released', client: 'x' }, RUN);
check('Disconnect during an edit ends the run', released.changed && released.focus === null);
console.log(`external focus: ${checks.length} checks passed`);
