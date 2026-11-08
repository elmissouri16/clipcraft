// Retain MCP's typed/structured output. Image bytes are transport-only: replace
// them with host-owned frame references before results enter saved chat JSON.
async function prepareMcpResult(result, importImage) {
  if (!result || typeof result !== 'object') return result;
  const frames = [];
  const content = [];
  for (const block of result.content || []) {
    const image = block.type === 'image' ? block : block.type === 'resource' && /^image\//.test(block.resource?.mimeType || '') && block.resource?.blob
      ? { mimeType: block.resource.mimeType, data: block.resource.blob } : null;
    if (!image) { content.push(block); continue; }
    const metadata = block.type === 'resource' ? { ...block, resource: { ...block.resource, blob: undefined } } : { ...block, data: undefined };
    try {
      if (frames.length >= 6) throw new Error('Image attachment limit reached; this image was not presented.');
      const frame = await importImage(image);
      frames.push(frame); content.push({ ...metadata, frame_id: frame.id, note: 'Image attached to the next model turn.' });
    } catch (error) { content.push({ ...metadata, error: error.message }); }
  }
  return { ...result, content, host_frames: frames };
}
module.exports = { prepareMcpResult };
