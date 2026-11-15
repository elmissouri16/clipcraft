const { SourceIndex } = require('../media/sourceIndex.cjs');
// All heavyweight work shares the existing request owner and Stop handling.
function registerSourceDiscovery({ ipcMain, root, withAgentJob, agentFrames, transcribe }) {
  const service = new SourceIndex(root, { transcribe });
  ipcMain.handle('agent:sourceDiscovery', (event, req = {}) => withAgentJob(event, req.requestId, async signal => {
    if (typeof req.requestId !== 'string' || !req.requestId) throw Error('Source discovery requires a request ID.');
    const media = req.project?.media?.find(m => m.id === req.media_id);
    if (!media) throw Error('Source video is no longer in the media library.');
    const owner = `${event.sender.id}:${req.requestId}`;
    switch (req.action) {
      case 'describe': return service.describe(media, req.options);
      case 'index': return service.index(media, req.options, { signal, onProgress: progress => { if (!event.sender.isDestroyed()) event.sender.send('agent:sourceProgress', { requestId: req.requestId, ...progress }); } });
      case 'transcript': return service.transcript(media, req.index_id, req.options);
      case 'find': return service.find(media, req.index_id, req.options);
      case 'review': return service.review(media, req, { owner, signal });
      case 'propose': return service.propose(media, req, { owner, evidence: ids => agentFrames.evidence(event.sender.id, ids, req.requestId) });
      case 'pick': return service.pick(media, req.index_id, req.pick_id);
      default: throw Error('Unknown source discovery action.');
    }
  }));
  return service;
}
module.exports = { registerSourceDiscovery };
