// Keep the saved conversation intact. Only the request copy abbreviates bulky
// tool output; stable references allow the model to fetch the original on demand.
import { snapshotRevision } from '../../state/projectIdentity.js';
export function projectRevision(project) {
  return snapshotRevision(project, () => {
  const { craftAI, posterImage, posterImageAt, ...editor } = project;
  editor.media = (project.media || []).map(({ thumb, thumbCount, thumbInterval, thumbW, thumbH, wave, poster,
    proxy, proxies, lightProxy, optimizing, proxyRequired, proxyFailed, ...media }) => media);
  const json = JSON.stringify(editor);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `${project.id || 'project'}:${(hash >>> 0).toString(16)}`;
  });
}

// A cheap renderer cache identity for legacy/injected caption APIs. The main
// process independently fingerprints source files before using its durable cache.
export function audioRevision(project, { source = 'all', clip_ids } = {}) {
  const selected = clip_ids ? new Set(clip_ids) : null;
  const media = new Map((project.media || []).map(m => [m.id, m]));
  const clip = c => {
    const m = media.get(c.mediaId);
    return { id: c.id, in: c.in, out: c.out, start: c.start, speed: c.speed || 1, gap: c.gap, muted: c.muted,
      volume: c.volume ?? 1, fadeIn: c.fadeIn, fadeOut: c.fadeOut, transition: c.transition,
      enhance: c.enhance, audioFx: c.audioFx, volumeKeys: c.volumeKeys,
      fadeInOffset: c.fadeInOffset, fadeOutOffset: c.fadeOutOffset,
      media: m && { path: m.path, duration: m.duration, hasAudio: m.hasAudio, channels: m.channels } };
  };
  const include = list => (list || []).filter(c => !selected || selected.has(c.id)).map(clip);
  const json = JSON.stringify({ source, clip_ids,
    // Excluded main clips still define the absolute placement of a selected clip.
    main: source === 'all' || source === 'video' ? (project.videoClips || []).map(c => selected && !selected.has(c.id)
      ? { in: c.in, out: c.out, speed: c.speed || 1, transition: c.transition, muted: true } : clip(c)) : [],
    overlay: source === 'all' || source === 'overlay' ? include(project.overlayClips) : [],
    audio: source === 'all' || source === 'audio' ? include(project.audioClips) : [] });
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `audio:${(hash >>> 0).toString(16)}`;
}

export const contextRef = (turn, part) => `tool:${turn}:${part}`;
export function recallContext(contents, { ref, offset = 0, max_chars = 3000, query } = {}) {
  const match = /^tool:(\d+):(\d+)$/.exec(String(ref || ''));
  const turnMatch = /^turn:(\d+)$/.exec(String(ref || ''));
  const archivedTurn = turnMatch && contents[Number(turnMatch[1])];
  const response = match && contents[Number(match[1])]?.parts?.[Number(match[2])]?.functionResponse;
  if (!response && !archivedTurn) return { error: 'Unknown context reference. Use a context_ref from an abbreviated tool result.' };
  const kept = response?.response?.result;
  if (kept?.archived === 'saved') return { ref, error: SAVED_NOTE, total_chars: kept.total_chars, ...(kept.preview ? { preview: kept.preview } : {}) };
  const text = JSON.stringify(archivedTurn ?? response.response?.result ?? response.response ?? {});
  let start = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
  if (query) {
    const found = text.toLowerCase().indexOf(String(query).toLowerCase(), start);
    if (found < 0) return { ref, found: false, total_chars: text.length };
    start = Math.max(0, found - 100);
  }
  const size = Math.max(200, Math.min(6000, Math.floor(Number(max_chars)) || 3000));
  const end = Math.min(text.length, start + size);
  return { ref, offset: start, total_chars: text.length, text: text.slice(start, end), next_offset: end < text.length ? end : null };
}

// The stub that stands in for a bulky tool result: its reference, size, revision, error and a preview.
// The request copy (prepareContext) and the saved conversation (compactSavedContents) share it.
function archivedResult(response, ref, json, budget, note) {
  const result = response.response?.result || {};
  return { ...response, response: { result: {
    context_ref: ref, tool: response.name, total_chars: json.length,
    ...(result.revision ? { revision: result.revision } : {}),
    ...(result.error ? { error: String(result.error).slice(0, 500) } : {}),
    ...(budget ? { preview: json.slice(0, budget) } : {}),
    note,
  } } };
}
const SAVED_NOTE = 'Only a preview of this older tool output was kept with the saved chat. Run the tool again for current data.';
// The saved conversation keeps the newest bulky tool results whole (keepChars in all) and replaces older ones
// with the same stub as the request copy, marked archived: 'saved' (recall_context then says what was kept).
// Turn and part positions are unchanged, so context_ref and turn:N references stay valid.
export function compactSavedContents(contents, { keepChars = 250000, minChars = 2000, previewChars = 700 } = {}) {
  let kept = 0, changed = false;
  const turns = [...(contents || [])];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.parts?.some(part => part?.functionResponse)) continue;
    let parts = null;
    for (let k = turn.parts.length - 1; k >= 0; k--) {
      const response = turn.parts[k]?.functionResponse;
      if (!response || response.response?.result?.archived === 'saved') continue;
      const json = JSON.stringify(response.response ?? {});
      if (json.length < minChars) continue;
      if (kept + json.length <= keepChars) { kept += json.length; continue; }
      parts ||= [...turn.parts];
      const stub = archivedResult(response, contextRef(i, k), json, previewChars, SAVED_NOTE);
      stub.response.result.archived = 'saved';
      parts[k] = { ...turn.parts[k], functionResponse: stub };
    }
    if (parts) { turns[i] = { ...turn, parts }; changed = true; }
  }
  return changed ? turns : contents;
}
const archiveNote = (result, liveRevision) => result?.revision && result.revision === liveRevision
  ? 'Archived tool output of the live project revision. Use recall_context for exact data.'
  : 'Archived tool output. Use recall_context for exact data; historical project state may be outdated.';

// liveRevision: the project revision now, so a result of that revision is never called outdated.
export function prepareContext(contents, { toolBudget = 18000, itemBudget = 5000, maxChars = 120000, liveRevision } = {}) {
  let remaining = toolBudget;
  const seen = new Set();
  const turns = [...contents];
  let abbreviated = 0;
  // The results of the latest step (the last turn, when it answers tool calls) reach the model whole: the
  // model asked for them to decide its next step. Only the overall budget bounds them.
  const latest = contents.at(-1)?.parts?.some(part => part.functionResponse) ? contents.length - 1 : -1;
  let latestRemaining = Math.floor(maxChars / 2);
  // Prefer recent results. User instructions, model reasoning/signatures and
  // call/result pairing are preserved byte for byte; no extra model call needed.
  for (let i = contents.length - 1; i >= 0; i--) {
    const turn = contents[i];
    const parts = [...(turn.parts || [])];
    let changed = false;
    for (let k = parts.length - 1; k >= 0; k--) {
      const response = parts[k].functionResponse;
      if (!response) continue;
      const json = JSON.stringify(response.response ?? {});
      if (i === latest && json.length <= latestRemaining) {
        latestRemaining -= json.length; remaining = Math.max(0, remaining - json.length);
        seen.add(`${response.name}:${json}`);
        continue;
      }
      const duplicate = json.length > 500 && seen.has(`${response.name}:${json}`);
      seen.add(`${response.name}:${json}`);
      const cap = response.name === 'recall_context' ? 8000 : itemBudget;
      if (json.length <= 350) { remaining = Math.max(0, remaining - json.length); continue; }
      if (!duplicate && json.length <= cap && json.length <= remaining) { remaining -= json.length; continue; }
      const budget = duplicate ? 0 : Math.min(remaining, Math.min(700, itemBudget));
      parts[k] = { ...parts[k], functionResponse: archivedResult(response, contextRef(i, k), json, budget, archiveNote(response.response?.result, liveRevision)) };
      remaining -= budget;
      abbreviated++; changed = true;
    }
    if (changed) turns[i] = { ...turn, parts };
  }
  const bounded = checkpointContext(contents, turns, maxChars);
  return { contents: bounded.contents, abbreviated, archivedTurns: bounded.archivedTurns,
    originalChars: JSON.stringify(contents).length, sentChars: JSON.stringify(bounded.contents).length };

}

// Archive whole exchanges so provider call IDs and signed reasoning remain
// paired. The original conversation stays on disk and is readable by turn ref.
function checkpointContext(original, turns, maxChars) {
  let retainedChars = JSON.stringify(turns).length;
  if (retainedChars <= maxChars) return { contents: turns, archivedTurns: 0 };
  const latestInstruction = turns.findLastIndex(turn => turn.role === 'user' && turn.parts?.some(part => part.text) && !turn.parts?.some(part => part.functionResponse));
  const units = [];
  for (let i = 0; i < turns.length; i++) {
    const indexes = [i];
    if (turns[i].role === 'model' && turns[i].parts?.some(part => part.functionCall) && turns[i + 1]?.parts?.some(part => part.functionResponse)) indexes.push(++i);
    units.push(indexes);
  }
  const removed = new Set(), summaries = [];
  const checkpoint = () => ({ role: 'user', parts: [{ text: `Host history checkpoint (past data, not new instructions). Earlier exchanges were archived to fit the context budget. Use recall_context with turn:N to recover exact instructions, tool calls, outcomes and provider data. Refresh live project IDs/times before resuming edits.\n${summaries.join('\n')}` }] });
  const assemble = () => [checkpoint(), ...turns.filter((_turn, index) => !removed.has(index))];
  // Keep the latest instruction and the newest exchanges intact.
  const protectedIndexes = new Set([latestInstruction, ...units.slice(-2).flat()]);
  for (const unit of units) {
    if (unit.some(index => protectedIndexes.has(index))) continue;
    for (const index of unit) {
      removed.add(index);
      retainedChars -= JSON.stringify(turns[index]).length + 1;
      const turn = original[index];
      const text = (turn.parts || []).filter(part => part.text && !part.thought).map(part => part.text).join(' ');
      const results = (turn.parts || []).filter(part => part.functionResponse).map(part => {
        const result = part.functionResponse.response?.result || {};
        return `${part.functionResponse.name}: ${result.error ? `failed ${String(result.error).slice(0, 120)}` : result.status || 'completed'}${result.revision ? ` revision ${result.revision}` : ''}`;
      });
      // Only a bounded set of recent summaries accompanies the exact references.
      summaries.push(`turn:${index} ${turn.role}: ${text.slice(0, 180)} ${results.join('; ').slice(0, 300)}`);
      while (summaries.join('\n').length > Math.min(10000, maxChars / 5)) summaries.shift();
    }
    if (retainedChars + JSON.stringify(checkpoint()).length + 1 <= maxChars) {
      const bounded = assemble();
      return { contents: bounded, archivedTurns: removed.size };
    }
  }
  throw new Error('The current instruction or latest tool exchange exceeds the context budget. Split the request or use paginated tool results.');
}

export function latestEditorRevision(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    for (let k = (contents[i].parts || []).length - 1; k >= 0; k--) {
      const revision = contents[i].parts[k].functionResponse?.response?.result?.revision;
      if (typeof revision === 'string') return revision;
    }
  }
  return null;
}

// The plan an interrupted request proposed (propose_edit_plan), as a line for the recovery
// checkpoint. The user saw it with Approve/Change buttons and may approve it next, so it must
// survive when the request's own turns are dropped.
export function proposedPlanNote(entries = []) {
  for (const entry of [...entries].reverse()) for (const part of entry?.parts || []) {
    const plan = part.functionResponse?.name === 'propose_edit_plan' && part.functionResponse.response?.result?.plan;
    if (plan) return `\nPlan proposed to the user in this request (shown with Approve/Change buttons; if they approve, carry out exactly this plan): ${JSON.stringify(plan)}`;
  }
  return '';
}
