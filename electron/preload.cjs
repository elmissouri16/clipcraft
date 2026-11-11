const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  importMedia: () => ipcRenderer.invoke('media:import'),
  wasRecovered: () => ipcRenderer.invoke('app:recovered'),
  readLut: (ref) => ipcRenderer.invoke('lut:read', ref),
  importLut: () => ipcRenderer.invoke('lut:import'),
  openCrashLog: () => ipcRenderer.invoke('app:openCrashLog'),
  probePaths: (paths) => ipcRenderer.invoke('media:probe', paths),
  favoritesList: () => ipcRenderer.invoke('favorites:list'),
  favoritesToggle: (entry) => ipcRenderer.invoke('favorites:toggle', entry),
  probeFiles: (files) => ipcRenderer.invoke('media:probe', files.map((f) => webUtils.getPathForFile(f))),
  saveRecording: (bytes) => ipcRenderer.invoke('media:saveRecording', bytes),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  screenChoose: (id, audio) => ipcRenderer.invoke('screen:choose', id, audio),
  screenBegin: (kind) => ipcRenderer.invoke('screen:begin', kind),
  screenChunk: (id, bytes) => ipcRenderer.invoke('screen:chunk', id, bytes),
  screenFinish: (id) => ipcRenderer.invoke('screen:finish', id),
  screenDiscard: (id) => ipcRenderer.invoke('screen:discard', id),
  screenBar: (show, sourceId) => ipcRenderer.invoke('screen:bar', show, sourceId),
  screenBarState: (state) => ipcRenderer.invoke('screen:barState', state),
  screenWindow: (action) => ipcRenderer.invoke('screen:window', action),
  screenCamera: (show, opts) => ipcRenderer.invoke('screen:camera', show, opts),
  screenCamGeom: (sourceId) => ipcRenderer.invoke('screen:camGeom', sourceId),
  onScreenCamConfig: (fn) => {
    const h = (_e, c) => fn(c);
    ipcRenderer.on('screen:camConfig', h);
    return () => ipcRenderer.removeListener('screen:camConfig', h);
  },
  onScreenStop: (fn) => {
    const h = () => fn();
    ipcRenderer.on('screen:stopRequested', h);
    return () => ipcRenderer.removeListener('screen:stopRequested', h);
  },
  onScreenPause: (fn) => {
    const h = () => fn();
    ipcRenderer.on('screen:pauseRequested', h);
    return () => ipcRenderer.removeListener('screen:pauseRequested', h);
  },
  fontsList: () => ipcRenderer.invoke('fonts:list'),
  // files: dropped File objects; none opens the file picker.
  fontsImport: (files) => ipcRenderer.invoke('fonts:import', files ? files.map((f) => webUtils.getPathForFile(f)) : null),
  fontData: (id) => ipcRenderer.invoke('fonts:data', id),
  fontsRemove: (id) => ipcRenderer.invoke('fonts:remove', id),
  librarySearch: (opts) => ipcRenderer.invoke('library:search', opts),
  soundzaStatus: () => ipcRenderer.invoke('soundza:status'),
  soundzaSearch: (opts) => ipcRenderer.invoke('soundza:search', opts),
  soundzaTest: (key) => ipcRenderer.invoke('soundza:test', key),
  soundzaPreview: (item) => ipcRenderer.invoke('soundza:preview', item),
  libraryFile: (item) => ipcRenderer.invoke('library:file', item),
  libraryAdd: (item, opts) => ipcRenderer.invoke('library:add', item, opts),
  ensureVisuals: (items) => ipcRenderer.invoke('media:ensureVisuals', items),
  colorSample: (item, from, to) => ipcRenderer.invoke('color:sample', item, from, to),
  stabilizeRun: (item, from, to, level) => ipcRenderer.invoke('stabilize:run', item, from, to, level),
  reverseRun: (item, from, to) => ipcRenderer.invoke('reverse:run', item, from, to),
  agentMediaJob: (req) => ipcRenderer.invoke('agent:mediaJob', req),
  agentExportBegin: (req) => ipcRenderer.invoke('agent:exportBegin', req),
  agentReviewRendered: (req) => ipcRenderer.invoke('agent:reviewRendered', req),
  agentFileJob: (req) => ipcRenderer.invoke('agent:fileJob', req),
  reverseCancel: () => ipcRenderer.invoke('reverse:cancel'),
  detachRun: (item, from, to) => ipcRenderer.invoke('detach:run', item, from, to),
  detachCancel: () => ipcRenderer.invoke('detach:cancel'),
  enhanceRun: (item, from, to, strength) => ipcRenderer.invoke('enhance:run', item, from, to, strength),
  enhanceCancel: () => ipcRenderer.invoke('enhance:cancel'),
  onEnhanceProgress: (handler) => {
    const h = (_e, payload) => handler(payload);
    ipcRenderer.on('enhance:progress', h);
    return () => ipcRenderer.removeListener('enhance:progress', h);
  },
  onDetachProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('detach:progress', h);
    return () => ipcRenderer.removeListener('detach:progress', h);
  },
  onReverseProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('reverse:progress', h);
    return () => ipcRenderer.removeListener('reverse:progress', h);
  },
  frameImage: (mediaPath, at) => ipcRenderer.invoke('media:frameImage', mediaPath, at),
  stabilizeCancel: () => ipcRenderer.invoke('stabilize:cancel'),
  onStabilizeProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('stabilize:progress', handler);
    return () => ipcRenderer.removeListener('stabilize:progress', handler);
  },
  trackRun: (item, from, to, pick, box) => ipcRenderer.invoke('track:run', item, from, to, pick, box),
  trackCancel: () => ipcRenderer.invoke('track:cancel'),
  onTrackProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('track:progress', handler);
    return () => ipcRenderer.removeListener('track:progress', handler);
  },
  proxyStatus: () => ipcRenderer.invoke('proxy:status'),
  foregroundWork: (state) => ipcRenderer.invoke('media:foregroundWork', state),
  proxySet: (on) => ipcRenderer.invoke('proxy:set', on === true),
  qualitySet: (q) => ipcRenderer.invoke('proxy:setQuality', q),
  perfGetMode: () => ipcRenderer.invoke('perf:getMode'),
  perfSetMode: (m) => ipcRenderer.invoke('perf:setMode', m),
  proxyClear: () => ipcRenderer.invoke('proxy:clear'),
  onMediaVisuals: (cb) => {
    const handler = (_e, v) => cb(v);
    ipcRenderer.on('media:visuals', handler);
    return () => ipcRenderer.removeListener('media:visuals', handler);
  },
  saveProject: (json, file, opts) => ipcRenderer.invoke('project:save', json, file, opts),
  autosaveProject: (file, json, chat) => ipcRenderer.invoke('project:autosave', file, json, chat),
  closeNow: () => ipcRenderer.invoke('app:closeNow'),
  closeCancel: () => ipcRenderer.invoke('app:closeCancel'),
  onCloseRequest: (fn) => {
    const h = () => fn();
    ipcRenderer.on('app:closeRequest', h);
    return () => ipcRenderer.removeListener('app:closeRequest', h);
  },
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (filePath) => ipcRenderer.invoke('project:openPath', filePath),
  slotWrite: (record) => ipcRenderer.invoke('slots:write', record),
  slotList: () => ipcRenderer.invoke('slots:list'),
  slotWriteChat: (id, json) => ipcRenderer.invoke('slots:writeChat', id, json),
  slotForFile: (filePath) => ipcRenderer.invoke('slots:forFile', filePath),
  slotRead: (id) => ipcRenderer.invoke('slots:read', id),
  slotDelete: (id) => ipcRenderer.invoke('slots:delete', id),
  exportBegin: (suggested) => ipcRenderer.invoke('export:begin', suggested),
  exportCover: (file, mediaPath, at) => ipcRenderer.invoke('export:cover', file, mediaPath, at),
  frameGrab: (mediaPath, at) => ipcRenderer.invoke('media:frame', mediaPath, at),
  exportCoverFrame: (project, at) => ipcRenderer.invoke('export:coverFrame', project, at),
  exportCaps: () => ipcRenderer.invoke('export:caps'),
  // Text layer: begin, then one call per frame (pixels, or { blank: n } / { same: n }), then end (frame count).
  exportTextBegin: (dir, width, height, fps, options) => ipcRenderer.invoke('export:textBegin', dir, width, height, fps, options),
  exportTextCached: (dir, width, height, fps, count, key) => ipcRenderer.invoke('export:textCached', dir, width, height, fps, count, key),
  exportTextFrame: (dir, frame) => ipcRenderer.invoke('export:textFrame', dir, frame),
  exportTextEnd: (dir) => ipcRenderer.invoke('export:textEnd', dir),
  exportAbort: (dir) => ipcRenderer.invoke('export:abort', dir),
  exportRun: (project, target, textFrames) => ipcRenderer.invoke('export:run', project, target, textFrames),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  exportActivity: (state) => ipcRenderer.invoke('export:activity',state),
  fxBegin: (project, spec) => ipcRenderer.invoke('fx:begin', project, spec),
  fxRead: (id, count) => ipcRenderer.invoke('fx:read', id, count),
  fxWrite: (id, bytes) => ipcRenderer.invoke('fx:write', id, bytes),
  fxEnd: (id) => ipcRenderer.invoke('fx:end', id),
  fxLut: (size, bytes) => ipcRenderer.invoke('fx:lut', size, bytes),
  fxTransfer: true, // effect frames also travel by transfer: see "Effect frames" below
  fxClear: () => ipcRenderer.invoke('fx:clear'),
  exportAudio: (project, format, name) => ipcRenderer.invoke('export:audio', project, format, name),
  showInFolder: (file) => ipcRenderer.invoke('shell:show', file),
  openFile: (file) => ipcRenderer.invoke('shell:open', file),
  openHelp: (url) => ipcRenderer.invoke('app:openHelp', url),
  agentStep: (req) => ipcRenderer.invoke('agent:step', req),
  agentAttachImages: files => ipcRenderer.invoke('agent:attachImages', files ? files.map(file => ({ path: webUtils.getPathForFile(file) })) : null),
  agentPasteImages: items => ipcRenderer.invoke('agent:attachImages', items),
  agentImagePreview: id => ipcRenderer.invoke('agent:imagePreview', id),
  agentValidateImages: ids => ipcRenderer.invoke('agent:validateImages', ids),
  agentAttachVideos: files => ipcRenderer.invoke('agent:attachVideos', files ? files.map(file => ({ path: webUtils.getPathForFile(file) })) : null),
  agentVideoPreview: id => ipcRenderer.invoke('agent:videoPreview', id),
  agentPickAttachments: () => ipcRenderer.invoke('agent:pickAttachments'),
  agentValidateVideos: ids => ipcRenderer.invoke('agent:validateVideos', ids),
  agentAnalyzeReference: req => ipcRenderer.invoke('agent:analyzeReference', req),
  onReferenceProgress: (cb) => { const handler = (_e, p) => cb(p); ipcRenderer.on('agent:referenceProgress', handler); return () => ipcRenderer.removeListener('agent:referenceProgress', handler); },
  // External agents over MCP (docs/design/external-agent-mcp.md).
  externalHostReady: manifest => ipcRenderer.invoke('external:hostReady', manifest),
  externalResult: req => ipcRenderer.invoke('external:result', req),
  externalProgress: req => ipcRenderer.invoke('external:progress', req),
  externalApproval: req => ipcRenderer.invoke('external:approval', req),
  externalStatus: () => ipcRenderer.invoke('external:status'),
  externalSetEnabled: on => ipcRenderer.invoke('external:setEnabled', on),
  externalDisconnect: () => ipcRenderer.invoke('external:disconnect'),
  externalForget: name => ipcRenderer.invoke('external:forget', name),
  externalAgents: () => ipcRenderer.invoke('external:agents'),
  externalInstall: id => ipcRenderer.invoke('external:install', id),
  externalUninstall: id => ipcRenderer.invoke('external:uninstall', id),
  externalManualConfig: () => ipcRenderer.invoke('external:manualConfig'),
  externalCraftBusy: busy => ipcRenderer.invoke('external:craftBusy', busy),
  saveProjectAgent: (json, target, current, chat) => ipcRenderer.invoke('project:saveAgent', json, target, current, chat),
  onExternalCall: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:call', handler); return () => ipcRenderer.removeListener('external:call', handler); },
  onExternalCancel: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:cancel', handler); return () => ipcRenderer.removeListener('external:cancel', handler); },
  onExternalStatus: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:status', handler); return () => ipcRenderer.removeListener('external:status', handler); },
  onExternalReleased: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:released', handler); return () => ipcRenderer.removeListener('external:released', handler); },
  onExternalApprove: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:approve', handler); return () => ipcRenderer.removeListener('external:approve', handler); },
  onExternalApproveDone: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('external:approveDone', handler); return () => ipcRenderer.removeListener('external:approveDone', handler); },
  agentRunNative: req => ipcRenderer.invoke('agent:runNative', req),
  agentNativeToolResult: req => ipcRenderer.invoke('agent:nativeToolResult', req),
  onAgentNativeTool: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('agent:nativeTool', handler); return () => ipcRenderer.removeListener('agent:nativeTool', handler); },
  onAgentNativeStop: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('agent:nativeStop', handler); return () => ipcRenderer.removeListener('agent:nativeStop', handler); },
  onAgentNativeProgress: cb => { const handler = (_event, req) => cb(req); ipcRenderer.on('agent:nativeProgress', handler); return () => ipcRenderer.removeListener('agent:nativeProgress', handler); },
  onAgentSearch: (cb) => { const handler = (_e, value) => cb(value); ipcRenderer.on('agent:search', handler); return () => ipcRenderer.removeListener('agent:search', handler); },
  openWebSource: (url) => ipcRenderer.invoke('agent:openSource', url),
  agentAnalyzeScenes: req => ipcRenderer.invoke('agent:analyzeScenes', req),
  agentAnnotateScene: req => ipcRenderer.invoke('agent:annotateScene', req),
  agentInspectFrames: (req) => ipcRenderer.invoke('agent:inspectFrames', req),
  agentFrameSheet: (req) => ipcRenderer.invoke('agent:frameSheet', req),
  agentRenderGraphic: (req) => ipcRenderer.invoke('agent:renderGraphic', req),
  renderGraphic: (req) => ipcRenderer.invoke('graphics:render', req),
  graphicsMissing: (items) => ipcRenderer.invoke('graphics:missing', items),
  graphicsInUse: (keys) => ipcRenderer.invoke('graphics:inUse', keys),
  graphicsUsage: () => ipcRenderer.invoke('graphics:usage'),
  graphicsClear: () => ipcRenderer.invoke('graphics:clear'),
  onGraphicProgress: (cb) => { const h = (_e, v) => cb(v); ipcRenderer.on('agent:graphicProgress', h); return () => ipcRenderer.removeListener('agent:graphicProgress', h); },
  cancelGraphicRender: (requestId) => ipcRenderer.invoke('graphics:cancelRender', requestId),
  openLiveGraphic: (req) => ipcRenderer.invoke('graphics:liveOpen', req),
  drawLiveGraphic: (req) => ipcRenderer.invoke('graphics:liveDraw', req),
  closeLiveGraphic: (owner) => ipcRenderer.invoke('graphics:liveClose', owner),
  agentGenerateImage: (req) => ipcRenderer.invoke('agent:generateImage', req),
  agentGenerateImages: (req) => ipcRenderer.invoke('agent:generateImages', req),
  onAgentImageProgress: cb => { const handler = (_event, progress) => cb(progress); ipcRenderer.on('agent:imageProgress', handler); return () => ipcRenderer.removeListener('agent:imageProgress', handler); },
  agentCancel: (requestId) => ipcRenderer.invoke('agent:cancel', requestId),
  agentSilences: (project, opts) => ipcRenderer.invoke('agent:silences', project, opts),
  agentBeats: (project, opts) => ipcRenderer.invoke('agent:beats', project, opts),
  agentLoudness: (project, opts) => ipcRenderer.invoke('agent:loudness', project, opts),
  agentRefineCuts: (project, opts) => ipcRenderer.invoke('agent:refineCuts', project, opts),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  platform: process.platform,
  messageBoxSync: (req) => ipcRenderer.sendSync('dialog:messageSync', req),
  onAppCommand: (cb) => { const handler = (_e, command) => cb(command); ipcRenderer.on('app:command', handler); return () => ipcRenderer.removeListener('app:command', handler); },
  settingsSetMcpServers: (list) => ipcRenderer.invoke('settings:setMcpServers', list),
  settingsSetShortcuts: (map) => ipcRenderer.invoke('settings:setShortcuts', map),
  settingsSetVoiceDefault: (value) => ipcRenderer.invoke('settings:setVoiceDefault', value),
  mcpTools: (opts) => ipcRenderer.invoke('mcp:tools', opts),
  mcpCall: (req) => ipcRenderer.invoke('mcp:call', req),
  mcpTest: (server) => ipcRenderer.invoke('mcp:test', server),
  settingsSave: (patch) => ipcRenderer.invoke('settings:save', patch),
  settingsSetModel: (provider, model) => ipcRenderer.invoke('settings:setModel', provider, model),
  settingsSetReasoningEffort: (provider, model, effort) => ipcRenderer.invoke('settings:setReasoningEffort', provider, model, effort),
  settingsClearKey: (provider) => ipcRenderer.invoke('settings:clearKey', provider),
  settingsSaveServiceKey: (name, key) => ipcRenderer.invoke('settings:saveServiceKey', name, key),
  settingsClearServiceKey: (name) => ipcRenderer.invoke('settings:clearServiceKey', name),
  appVersion: () => ipcRenderer.invoke('app:version'),
  telemetryStatus: () => ipcRenderer.invoke('telemetry:status'),
  telemetrySetConsent: (on) => ipcRenderer.invoke('telemetry:setConsent', on),
  stockTest: (key) => ipcRenderer.invoke('stock:test', key),
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  ttsElevenVoices: (opts) => ipcRenderer.invoke('tts:elevenVoices', opts),
  ttsElevenUsage: () => ipcRenderer.invoke('tts:elevenUsage'),
  ttsTestKey: (key) => ipcRenderer.invoke('tts:testKey', key),
  ttsGeminiTestKey: (key) => ipcRenderer.invoke('tts:geminiTestKey', key),
  ttsSpeak: (req) => ipcRenderer.invoke('tts:speak', req),
  ttsSpeakLines: (req) => ipcRenderer.invoke('tts:speakLines', req),
  ttsPiperDownload: (target) => ipcRenderer.invoke('tts:piperDownload', target),
  ttsPiperCancel: (target) => ipcRenderer.invoke('tts:piperCancel', target),
  ttsPiperRemove: (target) => ipcRenderer.invoke('tts:piperRemove', target),
  onTtsPiperProgress: (cb) => { const h = (_e, value) => cb(value); ipcRenderer.on('tts:piperProgress', h); return () => ipcRenderer.removeListener('tts:piperProgress', h); },
  onTtsProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('tts:progress', h);
    return () => ipcRenderer.removeListener('tts:progress', h);
  },
  templatesList: (params) => ipcRenderer.invoke('templates:list', params),
  templatesBundledList: () => ipcRenderer.invoke('templates:bundledList'),
  templatesBundledUse: (slug) => ipcRenderer.invoke('templates:bundledUse', slug),
  templatesThumb: (t) => ipcRenderer.invoke('templates:thumb', t),
  templatesPreview: (t) => ipcRenderer.invoke('templates:preview', t),
  templatesUse: (id) => ipcRenderer.invoke('templates:use', id),
  templatesPack: (projectJson, meta) => ipcRenderer.invoke('templates:pack', projectJson, meta),
  onTemplatesProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('templates:progress', h);
    return () => ipcRenderer.removeListener('templates:progress', h);
  },
  openFolder: (dir) => ipcRenderer.invoke('shell:openFolder', dir),
  genStatus: () => ipcRenderer.invoke('gen:status'),
  genList: () => ipcRenderer.invoke('gen:list'),
  genModels: () => ipcRenderer.invoke('gen:models'),
  avatarsList: () => ipcRenderer.invoke('avatars:list'),
  avatarsAdd: (file) => ipcRenderer.invoke('avatars:add', file),
  avatarsRemove: (file) => ipcRenderer.invoke('avatars:remove', file),
  genRun: (jobId, kind, opts) => ipcRenderer.invoke('gen:run', jobId, kind, opts),
  genStop: (jobId) => ipcRenderer.invoke('gen:stop', jobId),
  onGenProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('gen:progress', h);
    return () => ipcRenderer.removeListener('gen:progress', h);
  },
  assetsList: () => ipcRenderer.invoke('assets:list'),
  firstRunGet: () => ipcRenderer.invoke('firstrun:get'),
  firstRunSet: (patch) => ipcRenderer.invoke('firstrun:set', patch),
  stockSearch: (opts) => ipcRenderer.invoke('stock:search', opts),
  stockThumb: (url) => ipcRenderer.invoke('stock:thumb', url),
  stockAdd: (item, opts) => ipcRenderer.invoke('stock:add', item, opts),
  makeScene: (opts) => ipcRenderer.invoke('scene:make', opts),
  aiTest: (draft) => ipcRenderer.invoke('ai:test', draft),
  aiModels: (draft) => ipcRenderer.invoke('ai:models', draft),
  aiModelCapabilities: (draft) => ipcRenderer.invoke('ai:modelCapabilities', draft),
  aiRuntimeInstall: (provider) => ipcRenderer.invoke('ai:runtimeInstall', provider),
  aiRuntimeCancel: (provider) => ipcRenderer.invoke('ai:runtimeCancel', provider),
  onAiRuntimeProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    ipcRenderer.on('ai:runtimeProgress', handler);
    return () => ipcRenderer.removeListener('ai:runtimeProgress', handler);
  },
  aiSdkStatus: (draft) => ipcRenderer.invoke('ai:sdkStatus', draft),
  aiPickExecutable: (provider) => ipcRenderer.invoke('ai:pickExecutable', provider),
  captionsStatus: () => ipcRenderer.invoke('captions:status'),
  runCaptions: (project, opts) => ipcRenderer.invoke('captions:run', project, opts),
  runCaptionsCloud: (project, opts) => ipcRenderer.invoke('captions:runCloud', project, opts),
  testCaptionsCloud: (provider, key) => ipcRenderer.invoke('captions:testCloud', provider, key),
  onCaptionsProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('captions:progress', handler);
    return () => ipcRenderer.removeListener('captions:progress', handler);
  },
  onExportProgress: (cb) => {
    const handler = (_e, p, detail) => cb(p,detail);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },
});

// Effect frames (src/features/export/fxChannel.js). contextBridge copies every typed array
// it passes, so a 1080p frame was copied twice more on its way through the effects pass
// (~6 ms each way). Here the page and this preload hand frames over as transferred buffers
// in window messages (same process: no copy); only the IPC call itself serializes them.
// Only the two frame calls of the effects pass are served, for this window's own page.
const FX_TAG = 'clipcraft:fx-frames';
const buffersOf = (value) => {
  const out = new Set();
  const add = (v) => { if (ArrayBuffer.isView(v)) out.add(v.buffer); else if (v && typeof v === 'object') Object.values(v).forEach(add); };
  add(value);
  return [...out];
};
window.addEventListener('message', async (event) => {
  const m = event.data;
  if (event.source !== window || !m || m.tag !== FX_TAG || m.dir !== 'call' || typeof m.seq !== 'number' || typeof m.id !== 'string') return;
  let result, returned = [];
  try {
    if (m.op === 'read') result = await ipcRenderer.invoke('fx:read', m.id, Number(m.count) || 1);
    else if (m.op === 'write') {
      const pending = ipcRenderer.invoke('fx:write', m.id, m.bytes); // serialized here: the buffers are free again
      returned = Array.isArray(m.bytes) ? m.bytes : [m.bytes];
      result = await pending;
    } else return;
  } catch (error) { result = { ok: false, error: error.message }; }
  const reply = { tag: FX_TAG, dir: 'reply', seq: m.seq, result, returned };
  window.postMessage(reply, '*', buffersOf([result, returned]));
});
