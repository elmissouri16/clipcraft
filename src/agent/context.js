// Keep the saved conversation intact. Only the request copy abbreviates bulky
// tool output; stable references allow the model to fetch the original on demand.
export function projectRevision(project) {
  const { craftAI, ...editor } = project;
  editor.media = (project.media || []).map(({ thumb, thumbCount, thumbInterval, thumbW, thumbH, wave, poster,
    proxy, proxies, lightProxy, optimizing, ...media }) => media);
  const json = JSON.stringify(editor);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `${project.id || 'project'}:${(hash >>> 0).toString(16)}`;
}

export const contextRef = (turn, part) => `tool:${turn}:${part}`;
export function recallContext(contents, { ref, offset = 0, max_chars = 3000, query } = {}) {
  const match = /^tool:(\d+):(\d+)$/.exec(String(ref || ''));
  const response = match && contents[Number(match[1])]?.parts?.[Number(match[2])]?.functionResponse;
  if (!response) return { error: 'Unknown context reference. Use a context_ref from an abbreviated tool result.' };
  const text = JSON.stringify(response.response?.result ?? response.response ?? {});
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

export function prepareContext(contents, { toolBudget = 18000, itemBudget = 5000 } = {}) {
  let remaining = toolBudget;
  const seen = new Set();
  const turns = [...contents];
  let abbreviated = 0;
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
      const duplicate = json.length > 500 && seen.has(`${response.name}:${json}`);
      seen.add(`${response.name}:${json}`);
      const cap = response.name === 'recall_context' ? 8000 : itemBudget;
      if (json.length <= 350) { remaining = Math.max(0, remaining - json.length); continue; }
      if (!duplicate && json.length <= cap && json.length <= remaining) { remaining -= json.length; continue; }
      const ref = contextRef(i, k);
      const budget = duplicate ? 0 : Math.min(remaining, Math.min(700, itemBudget));
      const result = response.response?.result || {};
      parts[k] = { ...parts[k], functionResponse: { ...response, response: { result: {
        context_ref: ref, tool: response.name, total_chars: json.length,
        ...(result.revision ? { revision: result.revision } : {}),
        ...(result.error ? { error: String(result.error).slice(0, 500) } : {}),
        ...(budget ? { preview: json.slice(0, budget) } : {}),
        note: 'Archived tool output. Use recall_context for exact data; historical project state may be outdated.',
      } } } };
      remaining -= budget;
      abbreviated++; changed = true;
    }
    if (changed) turns[i] = { ...turn, parts };
  }
  return { contents: turns, abbreviated,
    originalChars: JSON.stringify(contents).length, sentChars: JSON.stringify(turns).length };
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
