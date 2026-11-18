// Each group is loaded only when requested; every existing editing tool remains
// available. Core tools cover discovery, project reads and basic settings.
export const TOOL_GROUPS = {
  plugins: ['run_plugin_command'],
  discovery: ['get_video_analysis', 'index_video', 'read_video_transcript', 'find_video_moments', 'review_video_moment', 'propose_video_clips', 'add_video_clip'],
  reference: ['analyze_reference'],
  graphics: ['graphics_guide', 'add_graphic', 'edit_graphic'],
  editorial: ['edit_guide', 'log_footage', 'remove_fillers', 'remove_retakes', 'find_highlights', 'propose_edit_plan', 'critique_edit'],
  timeline: ['remove_silences', 'cut_range', 'keep_ranges', 'delete_clip', 'split_at', 'set_speed', 'move_clip', 'trim_clip', 'clip_tools'],
  layers: ['layer_tools'],
  files: ['list_local_media', 'import_media'],
  captions: ['edit_caption_words', 'caption_tools', 'export_subtitles'],
  text: ['transcribe', 'add_captions', 'add_text', 'edit_text'],
  audio: ['get_beats', 'set_volume', 'set_audio_effects', 'set_volume_envelope', 'duck_audio', 'search_sounds', 'add_sound', 'list_voices', 'add_voiceover', 'add_narration'],
  visual: ['set_filter', 'set_effects', 'add_transition', 'add_effect', 'set_color', 'set_compositing'],
  motion: ['zoom', 'set_transform', 'add_keyframes', 'move_along_path', 'set_animation', 'motion_guide', 'track_subject', 'pin_to_subject'],
  media: ['analyze_scenes', 'get_storyboard', 'annotate_scene', 'add_media', 'generate_image', 'inspect_frames', 'search_stock', 'add_stock', 'add_scene'],
  export: ['export_video', 'review_section'],
};
export const CORE_TOOLS = ['list_plugin_commands', 'get_project', 'list_options', 'set_project', 'set_aspect_ratio', 'undo'];
const S = { type: 'STRING' };
export const CONTEXT_TOOLS = [
  { name: 'load_tools', description: 'Load groups from the enum for this request. discovery indexes/reviews source footage and proposes clips; reference measures edits; graphics draws; editorial plans/critiques; timeline edits timing; audio handles speech/music; motion tracks/animates; media searches/inspects; plugins runs discovered commands; external exposes configured MCP. Load several; groups stay available.',
    parameters: { type: 'OBJECT', properties: { groups: { type: 'ARRAY', items: { ...S, enum: [...Object.keys(TOOL_GROUPS), 'external'] } } }, required: ['groups'] } },
  { name: 'recall_context', description: 'Read archived output by context_ref or turn:N. offset/max_chars page JSON; query locates text. Reuse evidence instead of rerunning tools. Re-search expired stock ids.',
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
      const available = new Set([...declarations, ...external].map(t => t.name));
      return { ok: true, loaded: names, tools: [...new Set(names.flatMap((name) => name === 'external' ? external.map((t) => t.name) : TOOL_GROUPS[name]))].filter(name => available.has(name)) };
    },
  };
}
