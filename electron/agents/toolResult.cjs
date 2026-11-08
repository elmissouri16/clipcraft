// The one way an editor tool call reaches an agent (docs/design/external-agent-mcp.md): checked
// against the declared schema, run in the renderer, counted in the run report, and returned as JSON
// text plus labelled JPEG frames. Native agents (agent:runNative) and external MCP agents use it.
const { readImages } = require('./agentImages.cjs');

// A contact sheet replaces its cells as the one image sent for overview checks.
const SHEET_TOOLS = ['inspect_frames', 'get_storyboard', 'review_section', 'export_video', 'complete_edit', 'analyze_reference', 'add_graphic', 'edit_graphic'];
function frameIds(name, result) {
  if (SHEET_TOOLS.includes(name)) return result.sheet_ids?.length ? result.sheet_ids : result.sheet_id ? [result.sheet_id] : result.frames?.map((frame) => frame.id);
  return result.host_frames?.map((frame) => frame.id);
}

// opts: { tools, aliases (wire name -> ClipCraft name), validateToolCall, report, invoke(name, args) -> result,
// agentFrames, ownerId (frame owner: the renderer's webContents id), requestId(), provider, model, checkAbort() }
function createToolCaller({ tools, aliases, validateToolCall, report, invoke, agentFrames, ownerId, requestId, provider, model, checkAbort = () => {} }) {
  return async (name, args) => {
    const error = validateToolCall({ name, args }, tools);
    if (error) { report?.call(aliases.get(name) || name, true); return { isError: true, content: [{ type: 'text', text: error }] }; }
    const tool = aliases.get(name) || name;
    const result = await invoke(tool, args);
    report?.call(tool, !!result?.error);
    checkAbort();
    const ids = frameIds(tool, result) || [];
    const images = agentFrames.images(ownerId, ids);
    const content = [{ type: 'text', text: JSON.stringify(result) }];
    for (const image of readImages(images)) content.push({ type: 'text', text: image.label }, { type: 'image', mimeType: 'image/jpeg', data: image.data });
    agentFrames.markPresented(ownerId, ids, typeof requestId === 'function' ? requestId() : requestId, provider, model);
    return { isError: !!result.error, content };
  };
}

module.exports = { createToolCaller, frameIds };
