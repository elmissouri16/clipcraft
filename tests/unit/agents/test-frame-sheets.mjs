// Contact sheets for overview checks: layout, real FFmpeg composition, cell
// metadata, evidence rules, and which tools send a sheet instead of frames.
// Usage: node tests/unit/agents/test-frame-sheets.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { historyReducer, normalizeProject } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';

const require = createRequire(import.meta.url);
const { AgentFrames, sheetLayout } = require('../../../electron/agents/agentFrames.cjs');
const { ffmpegPath } = require('../../../electron/media/ffmpeg.cjs');
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-sheets-'));
const jpegSize = file => { const out = execFileSync(require('../../../electron/media/ffmpeg.cjs').ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim(); return out.split(',').map(Number); };

try {
  await check('layouts stay within 1024 px: portrait 3 per row, landscape 2 per row', () => {
    const portrait = sheetLayout(Array(6).fill({ width: 576, height: 1024 }));
    assert.deepEqual([portrait.cols, portrait.rows], [3, 2]); assert.ok(portrait.cols * portrait.cw <= 1024 && portrait.rows * portrait.ch <= 1024);
    const landscape = sheetLayout(Array(5).fill({ width: 1024, height: 576 }));
    assert.deepEqual([landscape.cols, landscape.rows], [2, 3]); assert.ok(landscape.cols * landscape.cw <= 1024 && landscape.rows * landscape.ch <= 1024);
    assert.ok(Math.abs(portrait.cw / portrait.ch - 576 / 1024) < 0.02, 'cells keep the frame aspect');
  });

  // Six real JPEG "captures" through the registry, as the timeline capture would store them.
  let n = 0;
  const frames = new AgentFrames(async () => { const file = path.join(dir, `cap${n}.jpg`); execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${(0x203040 + n++ * 0x101010).toString(16)}:s=576x1024:d=1`, '-frames:v', '1', file]); return fs.readFileSync(file); });
  const project = { ...normalizeProject({}), width: 1080, height: 1920, media: [], videoClips: [], textClips: [{ id: 't', text: 'x', start: 0, duration: 10 }] };
  const inspected = await frames.inspect('owner', { project, source: 'timeline', times_sec: [0, 1, 2, 3, 4, 5], revision: 'r1' });
  const ids = inspected.frames.map(f => f.id);

  let sheet;
  await check('a sheet is one real JPEG of numbered cells with their own IDs and times', async () => {
    sheet = await frames.sheet('owner', ids, { revision: 'r1' });
    assert.equal(sheet.source, 'sheet'); assert.equal(sheet.cells.length, 6);
    assert.deepEqual(sheet.cells.map(c => c.id), ids); assert.deepEqual(sheet.cells.map(c => c.time_sec), [0, 1, 2, 3, 4, 5]);
    const [image] = frames.images('owner', [sheet.id]);
    const [w, h] = jpegSize(image.path);
    assert.ok(w <= 1024 && h <= 1024 && w === sheet.width && h === sheet.height, `${w}x${h}`);
    assert.match(image.label, /Contact sheet of 6 frames, 3 per row/); assert.match(image.label, /#6 timeline 5\.00s/);
    // The sheet replaces six full-size frames with a quarter of their pixels.
    assert.ok(w * h <= 6 * 576 * 1024 / 4 + 1);
  });

  await check('sheets refuse foreign, expired, nested or single-frame input', async () => {
    await assert.rejects(frames.sheet('other', ids), /expired/);
    await assert.rejects(frames.sheet('owner', [ids[0]]), /2–6/);
    await assert.rejects(frames.sheet('owner', [sheet.id, ids[0]]), /expired/);
  });

  await check('presenting a sheet counts its cells for scene notes, not for tracking', () => {
    frames.markPresented('owner', [sheet.id], 'req-1', 'codex-sdk', 'm');
    const evidence = frames.evidence('owner', [ids[0]], 'req-1');
    assert.equal(evidence[0].presentedFor, 'req-1'); assert.equal(evidence[0].presentedVia, sheet.id, 'a sheet cell is marked as such');
    frames.markPresented('owner', [ids[1]], 'req-1', 'codex-sdk', 'm');
    assert.equal(frames.evidence('owner', [ids[1]], 'req-1')[0].presentedVia, undefined, 'a frame shown on its own is full evidence');
    const mainSource = fs.readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(mainSource, /frames\.some\(f => f\.presentedVia\)\) throw Error\('Tracking needs the starting frame inspected on its own/);
  });

  // Renderer: which tools ask for a sheet.
  let state = { past: [], future: [], present: { ...normalizeProject({}), fps: 30, width: 1080, height: 1920, ratio: '9:16', media: [{ id: 'm', type: 'image', path: '/x.png', width: 1080, height: 1920 }],
    videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1 }] } };
  const sheetCalls = [];
  const api = {
    agentInspectFrames: async req => ({ revision: req.revision, frames: (req.times_sec || req.source_times_sec).map((t, i) => ({ id: `f${i}-${t}`, source: req.source, time_sec: t })) }),
    agentFrameSheet: async req => { sheetCalls.push(req.frame_ids); return { id: 'sheet-1', width: 864, height: 1024, cells: req.frame_ids.map((id, i) => ({ cell: i + 1, id, time_sec: i })) }; },
  };
  const runner = createToolRunner({ getProject: () => state.present, dispatch: a => { state = historyReducer(state, a); }, settle: async () => {}, api });
  await check('explicit inspection keeps separate full-size frames', async () => {
    const r = await runner.run('inspect_frames', { times_sec: [1, 2, 3] });
    assert.equal(r.sheet_id, undefined); assert.equal(sheetCalls.length, 0);
  });
  await check('completion checks get one sheet with per-cell times kept for coverage', async () => {
    const r = await runner.run('inspect_frames', { times_sec: [1, 2, 3], sheet: true });
    assert.equal(r.sheet_id, 'sheet-1'); assert.deepEqual(r.frames.map(f => f.time_sec), [1, 2, 3]); assert.equal(r.sheet_cells.length, 3); assert.match(r.note, /contact sheet/);
    const single = await runner.run('inspect_frames', { times_sec: [4], sheet: true });
    assert.equal(single.sheet_id, undefined, 'one frame is sent as itself');
  });
  await check('a failing sheet falls back to the separate frames', async () => {
    const fallback = createToolRunner({ getProject: () => state.present, dispatch: () => {}, settle: async () => {}, api: { ...api, agentFrameSheet: async () => ({ error: 'ffmpeg missing' }) } });
    const r = await fallback.run('inspect_frames', { times_sec: [1, 2], sheet: true });
    assert.equal(r.sheet_id, undefined); assert.equal(r.frames.length, 2); assert.ok(!r.error);
  });

  // Both completion paths and the API transport ask for and send the sheet.
  const runAgentSource = fs.readFileSync(new URL('../../../src/features/agent/runAgent.js', import.meta.url), 'utf8');
  const nativeSource = fs.readFileSync(new URL('../../../src/features/agent/toolHost.js', import.meta.url), 'utf8'); // the native completion check (runNativeAgent uses it)
  await check('API and native completion checks request sheets; the API sends the sheet ID', () => {
    assert.match(runAgentSource, /runner\.run\('inspect_frames', \{ times_sec, sheet: true \}\)/);
    assert.match(runAgentSource, /frameIds = result\.sheet_id \? \[result\.sheet_id\]/);
    assert.match(nativeSource, /runner\.run\('inspect_frames', \{ times_sec, sheet: true \}\)/);
  });
  console.log(`${checks.length} contact sheet checks passed`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
