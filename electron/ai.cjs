// AI provider layer for the CraftAI assistant. Runs only in the main process so API keys never reach the UI.
// chat() takes plain messages and returns text; tool calling is added on top of this later.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
// Providers that speak the OpenAI chat API, with their default address.
// 'custom' has no default: the user sets the address of any OpenAI-compatible service.
const OPENAI_LIKE = { openai: 'https://api.openai.com/v1', groq: GROQ_BASE, openrouter: 'https://openrouter.ai/api/v1', custom: '' };
const OLLAMA_DEFAULT = 'http://localhost:11434';
const localAgents = require('./localAgents.cjs');

// A deliberately blank SDK model means "use the CLI default", even when a
// different model was saved before opening Settings. API blank-field behavior
// continues to use the saved/default model.
function resolveDraft(saved, draft = {}) {
  return {
    provider: saved.provider,
    model: localAgents.isProvider(saved.provider) && draft.model !== undefined
      ? String(draft.model || '').trim() : (draft.model || '').trim() || saved.model,
    baseUrl: draft.baseUrl !== undefined ? draft.baseUrl.trim().replace(/\/+$/, '') : saved.baseUrl,
    apiKey: (draft.apiKey || '').trim() || saved.apiKey,
    executablePath: draft.executablePath !== undefined ? String(draft.executablePath).trim() : saved.executablePath,
  };
}

// The chat-completions base URL for an OpenAI-like provider, or a clear error.
function openAiBase(cfg) {
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  if (cfg.provider === 'ollama') {
    const root = base || OLLAMA_DEFAULT;
    return root.endsWith('/v1') ? root : `${root}/v1`;
  }
  if (base) return base;
  if (OPENAI_LIKE[cfg.provider]) return OPENAI_LIKE[cfg.provider];
  throw new AiError('The Custom provider needs the address of the service. Set it in Settings (for example https://api.example.com/v1).', 0);
}
const VERTEX_EXPRESS_BASE = 'https://aiplatform.googleapis.com';

// Server-side "busy / overloaded" answers worth retrying.
const BUSY = [500, 502, 503, 504];

const redact = (text, key) => (key ? String(text).split(key).join('***') : String(text));

class AiError extends Error {
  constructor(message, status, link, short, linkLabel, suggestModel) {
    super(message);
    this.status = status;
    this.link = link; // a help page the UI can offer to open
    this.short = short; // one-line reason, used when several endpoints were tried
    this.linkLabel = linkLabel; // button text for the link (the UI has a default)
    this.suggestModel = suggestModel; // a replacement model id proposed by the service
  }
}

const FREE_KEY_URL = 'https://aistudio.google.com/app/apikey';

// People often type the display name ("Gemini 3.7 Flash"); the API wants the id ("gemini-3.7-flash").
function normalizeModel(provider, model) {
  const m = (model || '').trim();
  if (provider !== 'gemini') return m;
  return m.replace(/^models\//i, '').toLowerCase().replace(/\s+/g, '-');
}

async function http(url, { headers, body, timeoutMs = 45000, signal }, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
    const why = e.name === 'AbortError' ? 'timed out' : redact(e.cause?.code || e.message, key);
    throw new AiError(`Could not reach the AI service (${why}). Check your internet connection or the address in Settings.`, 0);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const detail = redact(json?.error?.message || json?.error?.status || json?.message || raw.slice(0, 200), key);
    // A retired model: Google names the replacement in the message ("...use models/gemini-3.8-flash...").
    const suggested = res.status === 404 && /no longer available/i.test(detail) ? (detail.match(/use\s+models\/([A-Za-z0-9._-]+)/i) || [])[1] : undefined;
    if (suggested) {
      throw new AiError(
        `This model is no longer available to new accounts. Google suggests "${suggested}" instead.`,
        res.status, undefined, `model retired, use ${suggested}`, undefined, suggested,
      );
    }
    // Vertex AI needs a billing account; the free AI Studio keys do not.
    if (/requires billing|enable billing|billing (?:account|to be enabled)/i.test(detail)) {
      throw new AiError(
        'This Google key belongs to a project that needs billing (a payment card). You do not need that: create a free key in Google AI Studio (it starts with AIza) and use it instead.',
        res.status, FREE_KEY_URL, 'this project needs billing', 'Get a free key (AI Studio)',
      );
    }
    // Google answers "API not enabled" with the exact page where it can be switched on.
    const link = (detail.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"')]+/) || [])[0];
    if (link && /has not been used|is disabled|SERVICE_DISABLED/i.test(`${detail} ${json?.error?.status || ''}`)) {
      throw new AiError(
        'Google says the service behind this key is not switched on yet. Open the page, press "Enable", wait about 2 minutes, then test again. ' +
        'Easier option: create a free key in Google AI Studio (it starts with AIza) and use that instead.',
        res.status, link, "the API is not switched on for this key's project",
      );
    }
    throw new AiError(explain(res.status, detail), res.status, undefined, `HTTP ${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  return json;
}

function explain(status, detail) {
  if (status === 401 || status === 403) return `The AI service rejected the key (HTTP ${status}). Check that the key is correct, active and allowed to use this model. ${detail}`.trim();
  if (status === 404) return `Model or address not found (HTTP 404). Check the model name in Settings. ${detail}`.trim();
  if (status === 429) return `Rate limit or quota reached (HTTP 429). Wait a moment or check your plan. ${detail}`.trim();
  if (BUSY.includes(status)) return `The AI service is busy or overloaded (HTTP ${status}). It is on the service side and usually passes soon: try again in a moment, or pick another model in Settings. ${detail}`.trim();
  return `The AI service returned an error (HTTP ${status}). ${detail}`.trim();
}

const textOf = (parts) => (parts || []).map((p) => p.text || '').join('');

// One Gemini generateContent call. Tries the endpoint that matches the key type, then the other one.
// cfg: { apiKey, model (already normalised), baseUrl, vertexBase?, studioBase? }; body: the request JSON.
async function geminiGenerate(cfg, body, timeoutMs, signal) {
  const { apiKey, model } = cfg;
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  // Keys starting with "AQ." are Vertex AI express keys; they use another endpoint than AI Studio keys.
  const vertexFirst = /^AQ\./.test(apiKey);
  const vertex = { label: 'Vertex AI', run: () => http(`${cfg.vertexBase || base || VERTEX_EXPRESS_BASE}/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, { body, timeoutMs, signal }, apiKey) };
  const studio = { label: 'Google AI Studio (Gemini API)', run: () => http(`${cfg.studioBase || base || GEMINI_BASE}/v1beta/models/${model}:generateContent`, { headers: { 'x-goog-api-key': apiKey }, body, timeoutMs, signal }, apiKey) };
  const attempts = vertexFirst ? [vertex, studio] : [studio, vertex];
  const failures = [];
  for (const a of attempts) {
    try {
      return await a.run();
    } catch (e) {
      failures.push({ label: a.label, e });
      // A custom address is used as given. Only a key/endpoint mismatch is worth trying the other endpoint for.
      // A 404 means the key was accepted and the model is the problem, so it is reported as is.
      if (base || ![400, 401, 403].includes(e.status)) throw e;
    }
  }
  // Both endpoints refused the key: say what each one answered so the real cause is visible.
  const link = failures.map((f) => f.e.link).find(Boolean);
  const lines = failures.map((f) => `• ${f.label}: ${f.e.short || f.e.message}`).join('\n');
  const advice = link
    ? '\nIf you just enabled the API, wait about 2 minutes and test again. Easier option: create a key in Google AI Studio (it starts with AIza).'
    : '\nCheck that the whole key was pasted. The easiest key is a free one from Google AI Studio (it starts with AIza).';
  throw new AiError(`Google did not accept this key on either endpoint.\n${lines}${advice}`, failures[0].e.status, link);
}

// cfg: { provider, model, baseUrl, apiKey }; messages: [{ role: 'user' | 'assistant', content }]; system: string.
async function chat(cfg, { system = '', messages, maxTokens = 1024, timeoutMs }) {
  if (localAgents.isProvider(cfg.provider)) return localAgents.chat(cfg, { system, messages, timeoutMs });
  const { provider, apiKey } = cfg;
  const model = normalizeModel(provider, cfg.model);
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  if (provider !== 'ollama' && !apiKey) throw new AiError('No API key saved for this provider. Add it in Settings.', 0);

  if (provider === 'gemini') {
    const body = {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const j = await geminiGenerate({ ...cfg, model }, body, timeoutMs);
    return textOf(j?.candidates?.[0]?.content?.parts);
  }

  if (provider === 'ollama') {
    const j = await http(`${base || 'http://localhost:11434'}/api/chat`, {
      body: { model, stream: false, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] },
      timeoutMs: timeoutMs || 120000,
    });
    return j?.message?.content || '';
  }

  if (OPENAI_LIKE[provider] !== undefined) {
    const j = await http(`${openAiBase(cfg)}/chat/completions`, {
      headers: { authorization: `Bearer ${apiKey}`, ...(provider === 'openrouter' ? { 'http-referer': 'https://clipcraft.app', 'x-title': 'ClipCraft' } : {}) },
      body: { model, max_tokens: maxTokens, ...reasoning(model), messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] },
      timeoutMs,
    }, apiKey);
    return j?.choices?.[0]?.message?.content || '';
  }

  if (provider === 'claude') {
    const j = await http(`${base || 'https://api.anthropic.com'}/v1/messages`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, ...(system ? { system } : {}), messages },
      timeoutMs,
    }, apiKey);
    return textOf(j?.content);
  }

  throw new AiError(`Unknown provider: ${provider}`, 0);
}

// One step of a tool-calling conversation. `contents` is the Gemini conversation (kept by the caller and passed
// back unchanged, including any hidden reasoning fields the model returned). `tools` is a list of
// { name, description, parameters } function declarations.
// Returns { content, text, calls: [{ name, args }] }; `content` must be appended to the conversation.
// A rate limit (HTTP 429, e.g. Groq's free tier: a few thousand tokens per minute) or a busy service (500, 502,
// 503 "high demand", 504) is waited out and retried: the wait the service names ("try again in 10.7s"), else 2,
// 5 then 10 seconds, up to about a minute in all.
async function agentStep(cfg, opts, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  if (opts.signal?.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
  if (localAgents.isProvider(cfg.provider)) return localAgents.agentStep(cfg, opts);
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
    try {
      return await agentStepOnce(cfg, opts);
    } catch (e) {
      const retryable = e.status === 429 || BUSY.includes(e.status);
      const m = /(?:try again|retry) in ([\d.]+)\s*(ms|s)\b/i.exec(e.message);
      const ms = m ? Number(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000) + 500 : e.status === 429 ? 8000 : [2000, 5000, 10000][attempt] || 10000;
      if (!retryable || attempt >= 3 || waited + ms > 65000) {
        if (BUSY.includes(e.status) && attempt > 0) {
          throw new AiError(`The AI service is overloaded right now (HTTP ${e.status}); it still failed after ${attempt + 1} tries. `
            + 'This is on the service side and usually passes in a few minutes. Try again later, or pick another model in Settings (a "lite" or smaller model is often less busy).', e.status);
        }
        throw e;
      }
      waited += ms;
      await sleep(ms);
    }
  }
}

async function agentStepOnce(cfg, { system, contents, tools, maxTokens = 2048, timeoutMs = 90000, signal }) {
  // Groq counts max_tokens in its per-minute budget: ask for what a step needs (a tool call or a short answer).
  if (OPENAI_LIKE[cfg.provider] !== undefined || cfg.provider === 'ollama') return openaiAgentStep(cfg, { system, contents, tools, maxTokens: Math.min(maxTokens, 1024), timeoutMs, signal });
  if (cfg.provider === 'claude') return anthropicAgentStep(cfg, { system, contents, tools, maxTokens, timeoutMs, signal });
  if (cfg.provider !== 'gemini') {
    throw new AiError('Unknown AI provider. Choose one in Settings.', 0);
  }
  if (!cfg.apiKey) throw new AiError('No API key saved for Google Gemini. Add it in Settings.', 0);
  const body = {
    contents,
    tools: [{ functionDeclarations: tools }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const j = await geminiGenerate({ ...cfg, model: normalizeModel('gemini', cfg.model) }, body, timeoutMs, signal);
  const cand = j?.candidates?.[0];
  const content = cand?.content || { role: 'model', parts: [{ text: '' }] };
  if (!content.role) content.role = 'model';
  const parts = content.parts || [];
  const calls = parts.filter((x) => x.functionCall).map((x) => ({ name: x.functionCall.name, args: x.functionCall.args || {} }));
  const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('');
  if (!parts.length && cand?.finishReason && cand.finishReason !== 'STOP') {
    throw new AiError(`The model stopped without an answer (${cand.finishReason}). Try rephrasing your request.`, 0);
  }
  return { content, text, calls };
}

// ---- Tool calling through the OpenAI chat API (Groq, OpenAI-compatible services) ----
// The agent keeps its conversation in Gemini's format; it is translated both ways here, so the rest of CraftAI
// does not depend on the provider.

// Reasoning models (gpt-oss on Groq) think before answering and those tokens count in max_tokens: keep the
// thinking short so short answers and tool calls are not cut off.
const reasoning = (model) => (/gpt-oss/i.test(model || '') ? { reasoning_effort: 'low' } : {});

// Gemini schema types are upper case (OBJECT, STRING...); JSON Schema wants lower case.
function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  return out;
}

// Gemini contents -> OpenAI messages. Tool calls get ids from their place in the conversation; the answers that
// follow a model turn are matched to its calls in order (CraftAI answers every call, in order).
function toOpenAiMessages(system, contents) {
  const msgs = system ? [{ role: 'system', content: system }] : [];
  let lastIds = [];
  contents.forEach((c, i) => {
    const parts = c.parts || [];
    if (c.role === 'model') {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      const calls = parts.filter((p) => p.functionCall);
      lastIds = calls.map((_, k) => `call_${i}_${k}`);
      const m = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) {
        m.tool_calls = calls.map((p, k) => ({ id: lastIds[k], type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }));
      }
      msgs.push(m);
      return;
    }
    const answers = parts.filter((p) => p.functionResponse);
    answers.forEach((p, k) => msgs.push({ role: 'tool', tool_call_id: lastIds[k] || `call_${i}_${k}`, content: JSON.stringify(p.functionResponse.response ?? {}) }));
    const text = parts.filter((p) => p.text).map((p) => p.text).join('');
    if (text || !answers.length) msgs.push({ role: 'user', content: text });
  });
  return msgs;
}

async function openaiAgentStep(cfg, { system, contents, tools, maxTokens, timeoutMs, signal }) {
  if (!cfg.apiKey && cfg.provider !== 'ollama') throw new AiError('No API key saved for this provider. Add it in Settings.', 0);
  const base = openAiBase(cfg);
  const j = await http(`${base}/chat/completions`, {
    headers: { ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: {
      model: normalizeModel(cfg.provider, cfg.model),
      max_tokens: maxTokens,
      ...reasoning(normalizeModel(cfg.provider, cfg.model)),
      messages: toOpenAiMessages(system, contents),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) } })),
      tool_choice: 'auto',
    },
    timeoutMs,
    signal,
  }, cfg.apiKey);
  const msg = j?.choices?.[0]?.message || {};
  const calls = (msg.tool_calls || []).map((tc) => {
    let args = {};
    try {
      args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = {};
    }
    return { name: tc.function.name, args: args || {} };
  });
  const text = msg.content || '';
  const parts = [...(text ? [{ text }] : []), ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))];
  return { content: { role: 'model', parts: parts.length ? parts : [{ text: '' }] }, text, calls };
}

// ---- Tool calling through the Anthropic messages API (Claude) ----
// Same contract as the other adapters: the conversation stays in Gemini format in the caller.
function toAnthropicMessages(system, contents) {
  const messages = [];
  let lastIds = [];
  contents.forEach((c, i) => {
    const parts = c.parts || [];
    if (c.role === 'model') {
      const blocks = [];
      const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('');
      if (text) blocks.push({ type: 'text', text });
      const calls = parts.filter((x) => x.functionCall);
      lastIds = calls.map((_, k) => `toolu_${i}_${k}`);
      calls.forEach((x, k) => blocks.push({ type: 'tool_use', id: lastIds[k], name: x.functionCall.name, input: x.functionCall.args || {} }));
      messages.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
      return;
    }
    const blocks = [];
    parts.filter((x) => x.functionResponse).forEach((x, k) => blocks.push({
      type: 'tool_result', tool_use_id: lastIds[k] || `toolu_${i}_${k}`,
      content: JSON.stringify(x.functionResponse.response ?? {}),
    }));
    const text = parts.filter((x) => x.text).map((x) => x.text).join('');
    if (text) blocks.push({ type: 'text', text });
    if (blocks.length) messages.push({ role: 'user', content: blocks });
  });
  return { system: system || undefined, messages };
}

async function anthropicAgentStep(cfg, { system, contents, tools, maxTokens, timeoutMs, signal }) {
  if (!cfg.apiKey) throw new AiError('No API key saved for Anthropic Claude. Add it in Settings.', 0);
  const base = (cfg.baseUrl || '').replace(/\/+$/, '') || 'https://api.anthropic.com';
  const conv = toAnthropicMessages(system, contents);
  const j = await http(`${base}/v1/messages`, {
    headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: {
      model: normalizeModel(cfg.provider, cfg.model),
      max_tokens: maxTokens,
      ...(conv.system ? { system: conv.system } : {}),
      messages: conv.messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t.parameters) })),
    },
    timeoutMs,
    signal,
  }, cfg.apiKey);
  const blocks = j?.content || [];
  const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, args: b.input || {} }));
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parts = [...(text ? [{ text }] : []), ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))];
  return { content: { role: 'model', parts: parts.length ? parts : [{ text: '' }] }, text, calls };
}

// Sends one tiny prompt and reports whether the provider answered.
async function testConnection(cfg) {
  const t0 = Date.now();
  try {
    const reply = await chat(cfg, { messages: [{ role: 'user', content: 'Reply with the single word: OK' }], maxTokens: 256, timeoutMs: localAgents.isProvider(cfg.provider) ? 120000 : 30000 });
    return { ok: true, ms: Date.now() - t0, reply: reply.trim().slice(0, 60) };
  } catch (e) {
    let { message } = e;
    let suggest = e.suggestModel;
    // The key works but cannot use this model (not on the account, blocked in the project, retired): ask which
    // models it can use and offer one, preferring models that handle CraftAI's tools well.
    if (e.status === 404 && OPENAI_LIKE[cfg.provider]) {
      const list = await listModels(cfg);
      if (list.ok && !list.models.includes(cfg.model)) {
        const prefer = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'gpt-4o-mini', 'llama-3.1-8b-instant'];
        suggest = prefer.find((m) => list.models.includes(m)) || list.models[0];
        message = `Your key cannot use "${cfg.model}". It can use: ${list.models.slice(0, 8).join(', ')}${list.models.length > 8 ? '…' : ''}. ` +
          'Pick one (or press the button below). On Groq, also check that the model is allowed for your project in the Groq console.';
      }
    }
    return { ok: false, ms: Date.now() - t0, error: redact(message, cfg.apiKey), link: e.link, linkLabel: e.linkLabel, suggestModel: suggest };
  }
}

// Asks the provider which models this key can use, so the user picks a real model id instead of typing one.
// Returns { ok, models: [id...] } or { ok: false, error }.
async function listModels(cfg) {
  if (localAgents.isProvider(cfg.provider)) return localAgents.listModels(cfg);
  const { provider, apiKey } = cfg;
  const base = (cfg.baseUrl || '').replace(/\/+$/, '');
  try {
    if (provider !== 'ollama' && !apiKey) throw new AiError('Paste or save an API key first, then load the models.', 0);
    let ids = [];
    if (provider === 'gemini') {
      // The models list is part of the AI Studio API (AIza keys). Vertex express keys cannot list models there.
      const j = await http(`${cfg.studioBase || base || GEMINI_BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, apiKey);
      ids = (j?.models || [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''))
        .filter((id) => id.startsWith('gemini'));
    } else if (provider === 'ollama') {
      const j = await http(`${base || 'http://localhost:11434'}/api/tags`, {});
      ids = (j?.models || []).map((m) => m.name);
    } else if (OPENAI_LIKE[provider] !== undefined) {
      const j = await http(`${openAiBase({ provider, baseUrl: base })}/models`, { headers: { authorization: `Bearer ${apiKey}` } }, apiKey);
      // Groq also lists speech and safety models: keep the chat ones.
      ids = (j?.data || []).filter((m) => m.active !== false && !/whisper|tts|guard|orpheus|playai/i.test(m.id)).map((m) => m.id);
    } else if (provider === 'claude') {
      const j = await http(`${base || 'https://api.anthropic.com'}/v1/models?limit=100`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }, apiKey);
      ids = (j?.data || []).map((m) => m.id);
    }
    ids = [...new Set(ids)].sort();
    if (!ids.length) throw new AiError('The service returned no models for this key.', 0);
    return { ok: true, models: ids };
  } catch (e) {
    return { ok: false, error: redact(e.message, apiKey), link: e.link, linkLabel: e.linkLabel };
  }
}

module.exports = { chat, agentStep, testConnection, listModels, normalizeModel, AiError, toOpenAiMessages, toJsonSchema, toAnthropicMessages, openAiBase, resolveDraft };
