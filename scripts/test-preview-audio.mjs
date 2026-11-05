import assert from 'node:assert/strict';

const store = new Map([['clipcraft.previewAudio', JSON.stringify({ volume: 0.35, muted: true })]]);
globalThis.localStorage = { getItem: (k) => store.get(k), setItem: (k, value) => store.set(k, value) };
class Node {
  gain = { value: 1 };
  connections = [];
  connect(node) { this.connections.push(node); }
}
let sourceCount = 0;
globalThis.AudioContext = class {
  destination = new Node();
  createGain() { return new Node(); }
  createAnalyser() { return new Node(); }
  createChannelSplitter() { return new Node(); }
  createMediaElementSource() { sourceCount++; return new Node(); }
};
const audio = await import('../src/audioTap.js?monitor-test');
const graph = audio.ensureAudioGraph();
assert.equal(graph.monitor.gain.value, 0, 'saved mute applies before any playback');
assert.equal(graph.master.gain.value, 1);
assert.ok(graph.master.connections.includes(graph.monitor));
assert.ok(!graph.master.connections.includes(graph.ctx.destination), 'no unattenuated speaker route');
assert.ok(graph.monitor.connections.includes(graph.ctx.destination));
assert.ok(!graph.monitor.connections.includes(audio.meterAnalysers().left), 'meters stay before monitoring gain');
const el = { volume: 1 };
audio.wireElement(el); audio.wireElement(el);
assert.equal(sourceCount, 1, 'media sources are wired once');
audio.applyElementVolume(el, 2);
assert.equal(el.volume, 1, 'per-clip gain staging stays independent of monitor mute');
audio.setPreviewAudio({ muted: false });
assert.equal(graph.monitor.gain.value, 0.35);
let changes = 0;
const unsubscribe = audio.subscribePreviewAudio(() => changes++);
audio.setPreviewAudio({ volume: 0.6 });
assert.equal(graph.monitor.gain.value, 0.6);
assert.equal(changes, 1);
assert.deepEqual(JSON.parse(store.get('clipcraft.previewAudio')), { volume: 0.6, muted: false });
audio.setPreviewAudio({ volume: 0.6 });
assert.equal(changes, 1);
audio.setPreviewAudio({ volume: Infinity });
assert.equal(graph.monitor.gain.value, 0.6);
audio.setPreviewAudio({ volume: -1 });
assert.equal(graph.monitor.gain.value, 0);
audio.setPreviewAudio({ volume: 5 });
assert.equal(graph.monitor.gain.value, 1);
unsubscribe();
globalThis.localStorage.setItem = () => { throw new Error('storage unavailable'); };
audio.setPreviewAudio({ volume: 0.25 });
assert.equal(graph.monitor.gain.value, 0.25, 'storage errors cannot block audio controls');

// Native media fallback still follows monitoring when Web Audio is unavailable.
globalThis.AudioContext = class { constructor() { throw new Error('unavailable'); } };
const fallback = await import('../src/audioTap.js?native-fallback-test');
fallback.setPreviewAudio({ volume: 0.4, muted: false });
const native = { volume: 1 };
fallback.wireElement(native);
fallback.applyElementVolume(native, 0.5);
assert.equal(native.volume, 0.2);
fallback.setPreviewAudio({ muted: true });
fallback.applyElementVolume(native, 0.5);
assert.equal(native.volume, 0);
console.log('preview audio ok (monitor routing, meter isolation, clip gain, preference restore, native fallback)');
