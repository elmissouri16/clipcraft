#!/usr/bin/env node
// A tiny MCP server used by scripts/test-mcp.mjs: newline-delimited JSON-RPC on stdio,
// implementing initialize, tools/list and tools/call with one "echo" tool.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const reply = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
    if (msg.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0.1.0' } } });
    } else if (msg.method === 'tools/list') {
      reply({
        jsonrpc: '2.0', id: msg.id,
        result: {
          tools: [{
            name: 'echo', description: 'Echoes the given text back.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          }],
        },
      });
    } else if (msg.method === 'tools/call') {
      if (!msg.params || msg.params.name !== 'echo') {
        reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${msg.params && msg.params.name}` } });
        return;
      }
      const text = (msg.params.arguments && msg.params.arguments.text) || '';
      reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } });
    } else if (msg.id !== undefined) {
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  }
});
