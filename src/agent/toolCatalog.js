// Each group is loaded only when requested; every existing editing tool remains
// available. Core tools cover discovery, project reads and basic settings.
export const TOOL_GROUPS = {
  timeline: ['remove_silences', 'cut_range', 'keep_ranges', 'delete_clip', 'split_at', 'set_speed', 'move_clip', 'trim_clip', 'clip_tools'],
  text: ['transcribe', 'add_captions', 'add_text', 'edit_text'],
  audio: ['set_volume', 'search_sounds', 'add_sound', 'list_voices', 'add_voiceover'],
  visual: ['set_filter', 'set_effects', 'add_transition', 'add_effect', 'set_color', 'set_compositing'],
  motion: ['zoom', 'set_transform', 'add_keyframes', 'set_animation', 'motion_guide'],
  media: ['add_media', 'search_stock', 'add_stock', 'add_scene'],
  style: ['edit_style'],
  export: ['export_video'],
};
export const CORE_TOOLS = ['get_project', 'list_options', 'set_project', 'set_aspect_ratio', 'undo'];
const S = { type: 'STRING' };
export const CONTEXT_TOOLS = [
  { name: 'load_tools', description: 'Load tool groups as needed: timeline (cuts, trim, speed), text (speech, captions, titles), audio (mix, sounds, voices), visual (color, effects, transitions, crop), motion (zoom, keyframes, guides), media (library, stock, scenes), style (reel recipes), export (render), external (configured MCP tools). Load multiple groups together. All tools in a group remain available for this request.',
    parameters: { type: 'OBJECT', properties: { groups: { type: 'ARRAY', items: { ...S, enum: [...Object.keys(TOOL_GROUPS), 'external'] } } }, required: ['groups'] } },
  { name: 'recall_context', description: 'Read original tool output abbreviated in context. ref = context_ref; offset / max_chars page through JSON; optional query locates text. Read data rather than repeating expensive tools. Search/stock ids from older requests expire: search again before adding.',
    parameters: { type: 'OBJECT', properties: { ref: S, offset: { type: 'INTEGER' }, max_chars: { type: 'INTEGER' }, query: S }, required: ['ref'] } },
];

export function createToolCatalog(declarations, external = []) {
  const active = new Set(CORE_TOOLS);
  const groups = new Set();
  return {
    tools: () => [...declarations.filter((t) => active.has(t.name)), ...CONTEXT_TOOLS,
      ...(groups.has('external') ? external : [])],
    load(names) {
      if (!Array.isArray(names) || !names.length || names.some((name) => name !== 'external' && !Object.hasOwn(TOOL_GROUPS, name))) {
        return { error: `groups must contain: ${[...Object.keys(TOOL_GROUPS), 'external'].join(', ')}.` };
      }
      for (const name of names) { groups.add(name); for (const tool of TOOL_GROUPS[name] || []) active.add(tool); }
      return { ok: true, loaded: names, tools: [...new Set(names.flatMap((name) => name === 'external' ? external.map((t) => t.name) : TOOL_GROUPS[name]))] };
    },
  };
}
