// A local stand-in for the model APIs the native agents call (OpenAI Responses for Codex, Anthropic
// Messages for Claude). It records every request body, which holds exactly what the agent sends to
// its model (instructions, tools, messages), and answers each turn with a short text reply so the
// run ends. No account, token or network is involved. Test-only.
const http = require('node:http');

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

function openAiResponse(res, reply) {
  const item = { type: 'message', id: 'msg_probe', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  sse(res, [
    ['response.created', { type: 'response.created', response: { id: 'resp_probe', object: 'response', status: 'in_progress', output: [] } }],
    ['response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
    ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item }],
    ['response.completed', { type: 'response.completed', response: { id: 'resp_probe', object: 'response', status: 'completed', output: [item], usage } }],
  ]);
}

function anthropicMessage(res, body, reply) {
  const message = { id: 'msg_probe', type: 'message', role: 'assistant', model: body.model || 'probe', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }));
  }
  sse(res, [
    ['message_start', { type: 'message_start', message }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

// Resolves { url, requests, close }. requests: [{ method, path, body }] in arrival order.
function startFakeModelServer({ reply = 'Done.' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = { unparsed: raw.slice(0, 2000) }; }
      const pathOnly = req.url.split('?')[0];
      requests.push({ method: req.method, path: pathOnly, body });
      if (req.method === 'POST' && /\/responses$/.test(pathOnly)) return openAiResponse(res, reply);
      if (req.method === 'POST' && /\/messages$/.test(pathOnly)) return anthropicMessage(res, body || {}, reply);
      if (req.method === 'POST' && /\/messages\/count_tokens$/.test(pathOnly)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"input_tokens":1}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(/\/models$/.test(pathOnly) ? '{"data":[],"models":[]}' : '{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  })));
}

module.exports = { startFakeModelServer };
