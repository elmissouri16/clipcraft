(async () => {
  const bridge = window.clipcraftView;
  bridge.onMessage(value => { document.querySelector('output').textContent = JSON.stringify(value); });
  const info = await bridge.getInfo();
  await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  await bridge.postMessage({kind: 'ready', id: info.id, theme: info.theme,
    node: typeof require, editorBridge: typeof window.api, wasm: true,
    color: getComputedStyle(document.querySelector('output')).color});
})().catch(error => { document.querySelector('output').textContent = String(error); });
