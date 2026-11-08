// Scoring for the agent evaluation harness (scripts/agent-eval.cjs). Combines
// the editorial critique of the final project with the case's explicit
// expectations, so prompt/tool changes can be compared run against run.
import { exportDuration } from '../../state/store.js';
import { critiqueProject, findFillers, findRetakes } from './editorial.js';

const r1 = n => Math.round(n * 10) / 10;
const finite = n => typeof n === 'number' && Number.isFinite(n);

// expect: { ratio, min_duration_sec, max_duration_sec, target_duration_sec,
// captions, hook_title, music, max_fillers, max_retakes, min_score, plan_proposed }
export function scoreEvalCase(project, { words = null, loudness = null, expect = {}, steps = [], platform } = {}) {
  const critique = critiqueProject(project, { words, loudness, target_duration_sec: expect.target_duration_sec, platform });
  const duration = exportDuration(project), checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, ...(detail !== undefined ? { detail } : {}) });
  if (expect.ratio) add(`format ${expect.ratio}`, project.ratio === expect.ratio, project.ratio);
  if (finite(expect.min_duration_sec)) add(`at least ${expect.min_duration_sec} s`, duration >= expect.min_duration_sec, r1(duration));
  if (finite(expect.max_duration_sec)) add(`at most ${expect.max_duration_sec} s`, duration <= expect.max_duration_sec, r1(duration));
  if (expect.captions) add('captions present', (project.textClips || []).some(c => c.caption && !c.disabled));
  if (expect.hook_title) add('hook title in the first 3 s', (project.textClips || []).some(c => !c.caption && !c.disabled && c.start < 3));
  if (expect.music) {
    const tts = new Set((project.media || []).filter(m => m.origin === 'tts').map(m => m.id));
    add('music bed present', (project.audioClips || []).some(c => !c.disabled && !tts.has(c.mediaId)));
  }
  if (finite(expect.max_fillers)) add(`at most ${expect.max_fillers} fillers`, Array.isArray(words) && findFillers(words).length <= expect.max_fillers, Array.isArray(words) ? findFillers(words).length : 'no transcript');
  if (finite(expect.max_retakes)) add(`at most ${expect.max_retakes} retakes`, Array.isArray(words) && findRetakes(words).filter(r => r.kind !== 'stutter').length <= expect.max_retakes, Array.isArray(words) ? findRetakes(words).filter(r => r.kind !== 'stutter').length : 'no transcript');
  if (finite(expect.min_score)) add(`critique score ≥ ${expect.min_score}`, critique.score >= expect.min_score, critique.score);
  if (expect.plan_proposed) add('edit plan proposed', steps.some(s => s.name === 'propose_edit_plan' && s.status === 'done'));
  const passed = checks.filter(c => c.pass).length, ratio = checks.length ? passed / checks.length : 1;
  return { score: Math.round(critique.score * 0.6 + ratio * 100 * 0.4), critique_score: critique.score, expectations_passed: passed, expectations_total: checks.length, checks,
    issues: critique.issues, metrics: critique.metrics };
}

// Tool usage profile of a run: how often each tool ran and how many failed.
export function toolProfile(steps = []) {
  const out = {};
  for (const s of steps) {
    if (!s?.name) continue;
    const row = out[s.name] ||= { calls: 0, failed: 0 };
    row.calls++; if (s.status === 'error') row.failed++;
  }
  return out;
}

// Compare two summaries (case id → score) for the CLI report.
export function compareRuns(current, previous) {
  const before = new Map((previous?.cases || []).map(c => [c.id, c]));
  return (current.cases || []).map(c => {
    const old = before.get(c.id);
    return { id: c.id, score: c.score, previous: old?.score ?? null, delta: old && finite(old.score) && finite(c.score) ? c.score - old.score : null };
  });
}
