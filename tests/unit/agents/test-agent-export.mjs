import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentExportPlan } from '../../../src/features/export/agentExport.js';
import { emptyProject } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { createEditorExportTarget } from '../../../electron/agents/editorExport.cjs';
import ff from '../../../electron/media/ffmpeg.cjs';
import { runAgent } from '../../../src/features/agent/runAgent.js';
import { runNativeAgent } from '../../../src/features/agent/runNativeAgent.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-agent-export-'));
const source = path.join(dir, 'source.mp4');
execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12:d=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source]);
const p = { ...emptyProject(), name: 'My video', width: 160, height: 96, fps: 12, media: [{ ...await ff.probe(source), id: 'm', path: source }],
  videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 4 }], textClips: [{ id: 'c', caption: true, text: 'Hello', start: 1, duration: 2, words: [{ text: 'Hello', start: 0, end: 2 }] }], layerState: { 'video:0': { locked: true } } };
const before = JSON.stringify(p), plan = agentExportPlan(p, { quality: 'medium', codec: 'h264', crf: 24, fps: 24, resolution: 480, encoder_preset: 'ultrafast' });
assert.equal(JSON.stringify(p), before);assert.equal(plan.effective.crf, 24);assert.equal(plan.effective.outW, 160);assert.equal(plan.effective.outFps, 24);
const section = agentExportPlan(p, { review: true, start_sec: 1, end_sec: 3 });
assert.deepEqual([section.project.videoClips[0].in, section.project.videoClips[0].out], [1, 3]);assert.equal(section.project.textClips[0].start, 0);
assert.equal(p.layerState['video:0'].locked, true);
assert.throws(() => agentExportPlan(p, { fps: 27 }), /fps/);
assert.throws(() => agentExportPlan(p, { quality: 'invented' }), /quality/);
assert.throws(() => agentExportPlan(p, { review: true, start_sec: 0, end_sec: 31 }), /section/);
const options = { outputDir: dir, cacheDir: path.join(dir, 'reviews') }, requestId = 'export-test';
const target = createEditorExportTarget({ requestId, name: 'My export' }, options);
assert.match(target.file, /My export-[a-z0-9-]+\.mp4$/);assert.equal(target.noOverwrite, true);
const output = ff.runExport({ ...plan.project, textClips: [], export: plan.effective }, target.file, () => {}, { noOverwrite: true });
await output.promise;const metadata = await ff.probe(target.file);assert.equal(metadata.width, 160);assert.equal(metadata.fps, 24);assert.ok(fs.statSync(target.file).size > 0);
assert.throws(() => createEditorExportTarget({ requestId, file_path: target.file }, options), /already exists/);
assert.throws(() => createEditorExportTarget({ requestId, file_path: path.join(dir, 'wrong.avi') }, options), /mp4/);
const exclusive = createEditorExportTarget({ requestId, file_path: path.join(dir, 'raced.mp4') }, options);
fs.writeFileSync(exclusive.file, 'Keep existing file');
await assert.rejects(ff.runExport({ ...plan.project, textClips: [], export: plan.effective }, exclusive.file, () => {}, { noOverwrite: true }).promise, /EEXIST/);
assert.equal(fs.readFileSync(exclusive.file, 'utf8'), 'Keep existing file');
const review = createEditorExportTarget({ requestId, kind: 'review' }, options);assert.equal(path.dirname(review.file), fs.realpathSync(options.cacheDir));
assert.throws(() => createEditorExportTarget({ requestId, kind: 'review', file_path: target.file }, options), /cache/);
let resolve, started = false;
const runner = createToolRunner({ getProject: () => p, settle: async () => {}, dispatch() {}, requestId,
  startExport: async (args, request) => { assert.equal(request.requestId, requestId);started = true;return await new Promise(r => { resolve = r; }); } });
let finished = false;const pending = runner.run('export_video', {}).then(result => { finished = true;return result; });
await new Promise(r => setTimeout(r, 0));assert.ok(started && !finished, 'tool awaits actual output');
resolve({ ok: true, file: target.file, size: fs.statSync(target.file).size, metadata: { width: metadata.width, height: metadata.height, duration_sec: metadata.duration } });
const result = await pending;assert.equal(result.artifact.path, target.file);
let stage=0;const progressEvents=[];
const inline=await runAgent({contents:[],requestId:'inline-api-export',isCanceled:()=>false,onEvent:event=>progressEvents.push(event),ctx:{getProject:()=>p,dispatch(){},settle:async()=>{},
 startExport:async(_args,request)=>{request.onProgress({progress:.4,stage:'Encoding video',remainingSeconds:3,elapsedSeconds:2});return {ok:true,file:target.file,size:100,metadata:{duration_sec:2,width:320,height:180}};},api:{
 agentStep:async()=>{const calls=stage++===0?[{name:'load_tools',args:{groups:['export']}}]:stage===2?[{name:'export_video',args:{}}]:[];return {ok:true,provider:'ollama',calls,content:{role:'model',parts:calls.map(functionCall=>({functionCall}))},text:'Done'};}
 }}});
assert.ok(!inline.error);assert.ok(progressEvents.some(e=>e.activity?.render?.progress===.4&&e.activity.render.stage==='Encoding video'),'API exports publish real progress to the active chat step');
assert.ok(progressEvents.some(e=>e.status==='done'&&e.activity?.artifact?.file===target.file),'the chat receives the verified delivered file');
for (const failure of [{ canceled: true }, { error: 'Encoder failed' }, { ok: true }]) {
  const r = createToolRunner({ getProject: () => p, settle: async () => {}, dispatch() {}, startExport: async () => failure });assert.ok((await r.run('export_video', {})).error, 'never treats cancellation, error or an unverified file as success');
}
let calls = 0;const history = [];
const apiCanceled = await runAgent({ contents: history, requestId: 'cancel-api-export', isCanceled: () => false, onEvent() {}, ctx: {
  getProject: () => p, dispatch() { throw Error('Canceled export must not edit'); }, settle: async () => {}, startExport: async () => ({ canceled: true }), api: {
    agentStep: async () => { const list = ++calls === 1 ? [{ name: 'load_tools', args: { groups: ['export'] } }] : [{ name: 'export_video', args: {} }, { name: 'set_project', args: { name: 'Must not run' } }];return { ok: true, provider: 'ollama', calls: list, content: { role: 'model', parts: list.map(functionCall => ({ functionCall })) } }; },
  },
} });
assert.ok(apiCanceled.canceled);assert.equal(calls, 2, 'Cancel export ends the API turn without retrying');
assert.deepEqual(history.at(-1).parts.map(part => part.functionResponse.name), ['export_video', 'set_project'], 'cancellation pairs every outstanding model call with a result');
let listener, finishNative, nativeStopped = false;
const nativeCanceled = await runNativeAgent({ contents: [], requestId: 'cancel-native-export', sessionKey: 'cancel-export', isCanceled: () => false, onEvent() {}, ctx: {
  provider: 'codex-sdk', getProject: () => p, dispatch() {}, settle: async () => {}, startExport: async () => ({ canceled: true }), api: {
    onAgentNativeTool: cb => { listener = cb;return () => {}; }, agentCancel: async () => { nativeStopped = true; },
    agentNativeToolResult: async result => { finishNative(result); },
    agentRunNative: async () => { const response = new Promise(resolve => { finishNative = resolve; });listener({ requestId: 'cancel-native-export', callId: 'export', name: 'export_video', args: {} });await response;return { canceled: nativeStopped }; },
  },
} });
assert.ok(nativeCanceled.canceled && nativeStopped, 'Cancel export also stops the native provider turn');
for (const t of [target, exclusive, review]) fs.rmSync(t.frameDir, { recursive: true, force: true });
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, output: target.file, metadata, exclusive_publication: true }, null, 2));
console.log('Awaited export, actual codecs/dimensions, cancellation results, snapshot settings and exclusive publication passed: ' + dir);
