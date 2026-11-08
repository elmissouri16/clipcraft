const fs = require('node:fs');
const { qualityTargetSize } = require('./quality.cjs');

// Prepare the copy the user will actually play before thumbnails/waveforms.
// High and the compatibility proxy share one file/encode. Lower copies defer
// the separate Full fallback until Full is requested.
async function preparePreview(item, quality, cache, emit, services) {
  let current = { ...item };
  const send = patch => {
    if (patch.proxies) patch = { ...patch, proxies: { ...(current.proxies || {}), ...patch.proxies } };
    current = { ...current, ...patch };emit(patch);
  };
  const exists = services.exists || fs.existsSync;
  try {
    const info = item.pixFmt === undefined || item.hdr === undefined ? { ...item, ...(await services.probe(item.path)) } : item;
    const required = services.needsProxy(info);
    let proxy = item.proxy && exists(item.proxy) ? item.proxy : null;
    const size = quality !== 'full' && qualityTargetSize(info.width, info.height, quality);
    send({ proxyRequired: required && !proxy, optimizing: info.type === 'video' && (required && !proxy || !!size) });
    if (info.type === 'video' && size) {
      const old = item.proxies?.[quality];
      let file = typeof old === 'string' && exists(old) ? old : null;
      if (!file && old !== false) {
        try { file = await services.makeQualityProxy(info, cache, quality); }
        catch { send({ proxies: { [quality]: false } }); }
      }
      if (file) {
        if (quality === 'high' && required) proxy = file;
        send({ ...(proxy ? { proxy } : {}), proxies: { [quality]: file }, proxyRequired: required && !proxy, proxyFailed: false, optimizing: false });
      } else if (required && !proxy) proxy = await services.makeProxy(info, cache);
    } else if (required && !proxy) proxy = await services.makeProxy(info, cache);
    if (proxy) send({ proxy, proxyRequired: false, proxyFailed: false, optimizing: false });
    if (info.type === 'video' && quality !== 'full' && !size) send({ proxies: { [quality]: proxy || item.path } });
    send({ optimizing: false });
  } catch {
    send({ proxyFailed: true, optimizing: false });
  }
  await services.makeVisuals(current, cache, send).catch(() => {});
  return current;
}
module.exports = { preparePreview };
