// Effect frames to and from the main process, handed to the preload by transfer
// (electron/preload.cjs "Effect frames") instead of being copied by contextBridge.
// Falls back to the plain bridge calls when the preload does not offer it.
const TAG = 'clipcraft:fx-frames';
const waiting = new Map();
let seq = 0, listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (event.source !== window || !m || m.tag !== TAG || m.dir !== 'reply') return;
    const done = waiting.get(m.seq);
    if (done) { waiting.delete(m.seq); done(m); }
  });
}
function call(op, payload, transfer = []) {
  listen();
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    window.postMessage({ tag: TAG, dir: 'call', seq: id, op, ...payload }, '*', transfer);
  });
}
const transferable = () => typeof window !== 'undefined' && window.api?.fxTransfer === true;

// Resolves like window.api.fxRead: { ok, value } (a frame, { frames }, or pairs).
export function fxRead(id, count) {
  if (!transferable()) return window.api.fxRead(id, count);
  return call('read', { id, count }).then((m) => m.result);
}

// Sends one frame or several; resolves to { result, buffers } where buffers are the
// sent arrays, usable again (they come back with the reply).
export function fxWrite(id, bytes) {
  const list = Array.isArray(bytes) ? bytes : [bytes];
  if (!transferable()) return window.api.fxWrite(id, bytes).then((result) => ({ result, buffers: list }));
  return call('write', { id, bytes }, [...new Set(list.map((b) => b.buffer))]).then((m) => ({ result: m.result, buffers: m.returned || [] }));
}
