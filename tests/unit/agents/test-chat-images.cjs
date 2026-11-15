const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ChatImages } = require('../../../electron/agents/chatImages.cjs');
const { createNativeAgents } = require('../../../electron/agents/nativeAgents.cjs');
const ai = require('../../../electron/agents/ai.cjs'), ff = require('../../../electron/media/ffmpeg.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-chat-images-unit-'));
const originalFetch = global.fetch;
(async () => {
  const id = 'a'.repeat(64), missing = 'b'.repeat(64), folder = path.join(dir, id);
  fs.mkdirSync(folder);
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=80x60', '-frames:v', '1', path.join(folder, 'image.jpg')]);
  fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ id, extension: 'png', name: 'Reference.png', width: 80, height: 60, bytes: 100 }));
  const service = new ChatImages(dir, {});
  const sourceBytes = fs.readFileSync(path.join(folder, 'image.jpg'));
  const imageStub = bytes => ({ isEmpty: () => bytes[0] !== 255 || bytes[1] !== 216, getSize: () => ({ width: 80, height: 60 }), resize: () => ({ toJPEG: () => bytes }) });
  const uploads = new ChatImages(path.join(dir, 'uploads'), { nativeImage: { createFromBuffer: imageStub } });
  const uploaded = await uploads.add([{ path: path.join(folder, 'image.jpg') }]);
  assert.equal(uploaded.images.length, 1, JSON.stringify(uploaded.errors));
  assert.deepEqual(fs.readFileSync(path.join(folder, 'image.jpg')), sourceBytes, 'attaching never changes the original');
  const pasted = await uploads.add([{ name: 'Pasted.jpg', bytes: sourceBytes }]);
  assert.equal(pasted.images[0].id, uploaded.images[0].id, 'content-addressed cache deduplicates image copies');
  assert.match(await uploads.preview(uploaded.images[0].id), /^data:image\/jpeg;base64,/);
  const huge = path.join(dir, 'huge.png'); fs.writeFileSync(huge, ''); fs.truncateSync(huge, 20 * 1024 * 1024 + 1);
  assert.match((await uploads.add([{ path: huge }])).errors[0].error, /20 MB/);
  const contents = [{ role: 'user', parts: [{ text: 'Use this reference' }, { chatImage: { id, name: 'Forged file label' } }] }];
  const saved = JSON.stringify(contents), data = fs.readFileSync(path.join(folder, 'image.jpg')).toString('base64');
  const hydrated = await service.hydrate(contents);
  assert.equal(hydrated[0].parts[2].inlineData.data, data);
  assert.ok(hydrated[0].parts[1].text.includes('Reference.png') && !hydrated[0].parts[1].text.includes('Forged file label'));
  assert.equal(JSON.stringify(contents), saved, 'transport image bytes never mutate saved context');
  await assert.rejects(service.get('../metadata.json'), /no longer available/);
  await assert.rejects(service.validate([missing]), /no longer available/);
  const old = await service.hydrate([{ role: 'user', parts: [{ chatImage: { id: missing, name: 'Missing.png' } }] }, ...contents]);
  assert.match(old[0].parts[0].text, /not attached/);
  assert.equal((await service.add([{ name: 'brief.pdf', bytes: [1, 2, 3] }])).errors.length, 1, 'documents are rejected');
  await assert.rejects(service.add(Array(7).fill({})), /six|6/);
  let body, response;
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify(response)); };
  for (const provider of ['openai', 'openrouter', 'groq', 'custom', 'ollama']) {
    response = { choices: [{ message: { content: 'Seen' } }] };
    await ai.agentStep({ provider, model: 'vision-model', apiKey: 'fixture', ...(provider === 'custom' ? { baseUrl: 'https://example.test/v1' } : {}) }, { contents: hydrated, tools: [] });
    assert.equal(body.messages.at(-1).content.find(part => part.type === 'image_url').image_url.url, `data:image/jpeg;base64,${data}`, provider);
  }
  response = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Seen' }] }] };
  await ai.agentStep({ provider: 'openai', model: 'gpt-6.1-sol', apiKey: 'fixture' }, { contents: hydrated, tools: [] });
  assert.equal(body.input.at(-1).content.find(part => part.type === 'input_image').image_url, `data:image/jpeg;base64,${data}`);
  response = { content: [{ type: 'text', text: 'Seen' }] };
  await ai.agentStep({ provider: 'claude', model: 'vision-model', apiKey: 'fixture' }, { contents: hydrated, tools: [] });
  assert.equal(body.messages.at(-1).content.find(part => part.type === 'image').source.data, data);
  response = { candidates: [{ content: { role: 'model', parts: [{ text: 'Seen' }] } }] };
  await ai.agentStep({ provider: 'gemini', model: 'vision-model', apiKey: 'fixture' }, { contents: hydrated, tools: [] });
  assert.equal(body.contents.at(-1).parts.find(part => part.inlineData).inlineData.data, data);
  let claudeMessage;
  const native = createNativeAgents({ resolveExecutable: cfg => cfg.provider === 'codex-sdk' ? path.resolve(__dirname, '../../fixtures/codex-native-stub.cjs') : '/fake/claude', childEnv: () => ({ ...process.env, FVE_NATIVE_FIXTURE_LOG: path.join(dir, 'protocol.jsonl') }),
    loadSdk: async () => ({ ...await import('@anthropic-ai/claude-agent-sdk'), query: ({ prompt }) => ({ async *[Symbol.asyncIterator]() { for await (const message of prompt) claudeMessage = message; yield { type: 'result', subtype: 'success', result: 'Seen', session_id: 'images' }; }, close() {} }) }) });
  try {
    const attached = await service.native('Make no changes', [], [id]);
    assert.equal(attached.images.length, 1);
    assert.ok(!JSON.stringify(attached.history).includes(data));
    const tools = ['get_project', 'add_text', 'inspect_frames', 'complete_edit'].map(name => ({ name, parameters: { type: 'object', properties: {} } }));
    for (const provider of ['codex-sdk', 'claude-agent-sdk']) {
      const result = await native.run({ provider }, { sessionKey: provider, system: 'Use attached images', ...attached, tools, onTool: async () => ({ content: [{ type: 'text', text: '{"ready":true}' }] }), isComplete: async () => true });
      assert.ok(result.text);
    }
    assert.equal(claudeMessage.message.content.find(part => part.type === 'image').source.data, data);
    const protocol = fs.readFileSync(path.join(dir, 'protocol.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(protocol.some(entry => entry.inputTypes?.includes('localImage')), 'Codex receives a native local image input');
  } finally { native.close(); }
  const { normalizeChatSessions, newChatSession, snapshotChatSessions, hasChatContent } = await import('../../../src/features/agent/chatSessions.js');
  const image = { id, name: 'Reference.png', bytes: 100, width: 80, height: 60, inlineData: { data }, path: '/not-saved' };
  const chat = newChatSession(); chat.images = [image]; chat.queue = [{ id: 'queue-image', text: 'Use it next', images: [image] }]; chat.messages = [{ role: 'user', text: 'Reference', images: [image] }]; chat.contents = contents;
  const restored = normalizeChatSessions(snapshotChatSessions({ sessions: [chat], activeSessionId: chat.id }));
  assert.equal(restored.sessions[0].images.length, 1);
  assert.equal(restored.sessions[0].queue[0].images[0].id, id);
  assert.equal(restored.sessions[0].messages[0].images[0].id, id);
  assert.equal(restored.sessions[0].queuePaused, true);
  assert.ok(!JSON.stringify(restored).includes(data) && !JSON.stringify(restored).includes('/not-saved'));
  assert.equal(hasChatContent({ craftAI: { sessions: [{ images: [image] }] } }), true);
  console.log('Chat images: all API transports, native Codex/Claude, persistence, limits and missing-image recovery passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); });
