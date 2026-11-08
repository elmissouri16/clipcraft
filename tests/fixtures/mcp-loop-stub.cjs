// Isolated Electron regression fixture. Never contacts external services.
const fs = require('node:fs'), path = require('node:path');
const dir = process.argv[2];
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, end); input = input.slice(end + 1);
    let message; try { message = JSON.parse(line); } catch { continue; }
    const send = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
    if (message.method === 'initialize') send({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'loop-fixture', version: '1' } });
    else if (message.method === 'tools/list') send({ tools: ['image', 'wait'].map(name => ({ name, description: 'Loop regression fixture', inputSchema: { type: 'object', properties: {} } })) });
    else if (message.method === 'tools/call' && message.params.name === 'image') send({ content: [{ type: 'text', text: 'External frame' }, { type: 'image', mimeType: 'image/png', data: fs.readFileSync(path.join(dir, 'green.png')).toString('base64') }], structuredContent: { scene: 'green', clip_id: 'v' } });
    else if (message.method === 'tools/call' && message.params.name === 'wait') fs.writeFileSync(path.join(dir, 'mcp-started.json'), JSON.stringify({ id: message.id }));
    else if (message.method === 'notifications/cancelled') fs.writeFileSync(path.join(dir, 'mcp-canceled.json'), JSON.stringify(message.params));
  }
});
