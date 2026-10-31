// CraftAI loop: ask the model for a step, run the tools it requests, give the results back, repeat until
// it answers in plain text. The model lives in the main process (the API key never reaches the interface);
// the tools run here, next to the project.
import { TOOL_DECLARATIONS, createToolRunner } from './tools.js';

export const SYSTEM_PROMPT = `You are CraftAI, the assistant inside ClipCraft, a desktop video editor. You help the user edit their project by calling tools.

How to work:
- Never guess clip ids, times or names. Call get_project first when you need them, and again after cuts because times shift.
- Do the edit with the tools, then answer in one to three short sentences saying what you changed and the important numbers. The user can undo everything with one click, so do not ask for confirmation unless the request is genuinely ambiguous or would remove most of the video.
- Reply in the language the user writes in. If they write Arabic or Darija, answer in Arabic script, never in Latin transliteration. Keep tool names and technical words (FFmpeg, Undo) as they are.
- Only use what your tools can do. If something is not possible with them, say so plainly and suggest the closest thing you can do.
- Times are in seconds on the timeline. Only the main (video) track is cut by cutting tools; music, text and stickers keep their own time.
- Use transcribe when the request depends on what is said (highlights, summaries, finding a moment). It can be slow on long videos, so use it once and reuse the result.
- For captions in Arabic or Darija pass language "ar". Auto-detect is unreliable.
- Zoom (punch-in), size, position, rotation, opacity, keyframes and In / Out / Combo animations are all possible: use zoom, set_transform, add_keyframes and set_animation. For "zoom on the important moments", transcribe first, pick a few short moments (1 to 3 s each, a few seconds apart) and call zoom for each.
- You can reach everything in the editor: sounds (search_sounds + add_sound: music, sound effects, meme sounds), voice-over (list_voices + add_voiceover), stock b-roll (search_stock + add_stock), text and captions (add_text, edit_text; clip_id "captions" restyles all captions), stickers, effects over a range, moving / trimming / duplicating clips, overlays, colors, green screen, project settings, export. If a step went wrong, use undo (it only undoes your own changes).
- A full edit ("edit this video", "make it ready for TikTok / Reels / YouTube") usually means, in this order, adapted to the video: get_project; set the format if a platform is named (9:16 for TikTok / Reels / Shorts); remove_silences; transcribe once; captions in the video's language with a fitting style; a few zooms on strong moments; a title or hook text at the start when it helps; background music at a low volume (about 0.2) with fades, ending with the video; a few sound effects on key moments (whoosh on zooms or cuts, pop on texts) without overdoing it; b-roll from stock only when it clearly illustrates what is said; then get_project to check, and a short summary. Do not export unless asked.
- Named editing styles: when the user names a style for the edit ("Moon Drift", "App Story", "Tube TV", "Loud & Clear", "Silver Screen"...), call edit_style with that name first and follow its recipe on the whole video.
- Motion graphics (intro, hook, title card, kinetic text, lower third, logo reveal, end card, list, nicer captions): read motion_guide for the topic first, then build it; add_scene makes a color or gradient background when there is no footage. Prefer eased keyframes (spring, back, out) over linear ones.
- Be concise. No filler, no restating the question.`;

const MAX_STEPS = 40; // a full edit takes many tool calls
const providerName = (p) => ({ gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI', openrouter: 'OpenRouter', claude: 'Claude', custom: 'Custom', ollama: 'Ollama' }[p] || p);

// Tool arguments shown as a short phrase in the chat.
export function describeCall(name, args) {
  const a = args || {};
  switch (name) {
    case 'get_project': return 'Reading the project';
    case 'remove_silences': return 'Removing silences';
    case 'cut_range': return `Cutting ${a.start_sec}s to ${a.end_sec}s`;
    case 'keep_ranges': return `Keeping ${(a.ranges || []).length} range(s)`;
    case 'transcribe': return 'Transcribing the speech';
    case 'add_captions': return 'Adding captions';
    case 'add_text': return `Adding text "${String(a.text || '').slice(0, 30)}"`;
    case 'delete_clip': return 'Deleting a clip';
    case 'split_at': return `Splitting at ${a.time_sec}s`;
    case 'set_speed': return `Setting speed to ${a.speed}x`;
    case 'set_volume': return `Setting volume to ${a.volume}`;
    case 'set_filter': return `Applying filter ${a.filter_id}`;
    case 'set_effects': return 'Setting effects';
    case 'add_transition': return `Adding transition ${a.type}`;
    case 'set_aspect_ratio': return `Changing format to ${a.ratio}`;
    case 'add_media': return `Adding ${a.media_name}`;
    case 'zoom': return `Zooming ${a.scale || 1.3}x from ${a.start_sec}s to ${a.end_sec}s`;
    case 'set_transform': return 'Changing size / position';
    case 'add_keyframes': return `Adding ${a.property} keyframes`;
    case 'set_animation': return 'Setting the animation';
    case 'search_sounds': return `Searching ${a.kind || 'sounds'}: "${a.query || ''}"`;
    case 'add_sound': return `Adding a sound at ${a.start_sec || 0}s`;
    case 'list_voices': return 'Listing voices';
    case 'add_voiceover': return `Recording a voice-over "${String(a.text || '').slice(0, 30)}"`;
    case 'search_stock': return `Searching stock ${a.kind || 'videos'}: "${a.query || ''}"`;
    case 'add_stock': return `Adding stock ${a.as === 'main' ? 'clip' : 'b-roll'}`;
    case 'edit_text': return a.clip_id === 'captions' ? 'Styling the captions' : 'Editing a text';
    case 'list_options': return `Looking up ${String(a.what || 'options').replace(/_/g, ' ')}`;
    case 'add_sticker': return `Adding ${a.emoji || 'a sticker'}`;
    case 'add_effect': return `Adding effect ${a.effect_id}`;
    case 'move_clip': return 'Moving a clip';
    case 'trim_clip': return 'Trimming a clip';
    case 'clip_tools': return `${String(a.action || 'Clip action').replace(/_/g, ' ')}`;
    case 'set_color': return 'Adjusting colors';
    case 'set_compositing': return a.chroma_key === false ? 'Turning off the green screen' : 'Setting green screen / blend';
    case 'set_project': return 'Changing project settings';
    case 'undo': return 'Undoing the last step';
    case 'edit_style': return `Using the ${a.name || ''} style`;
    case 'motion_guide': return `Reading the ${String(a.topic || '').replace(/_/g, ' ')} recipe`;
    case 'add_scene': return `Adding a ${a.color2 ? 'gradient' : 'color'} scene`;
    case 'export_video': return 'Opening the export';
    default: return name;
  }
}

// contents: the running conversation (mutated). onEvent: UI callback. isCanceled(): polled between steps.
// ctx: { getProject, dispatch, api, settle }.
export async function runAgent({ contents, ctx, onEvent, isCanceled }) {
  const runner = createToolRunner(ctx);
  // MCP servers configured in Settings contribute their tools for this run, prefixed
  // mcp_<server>_<tool>; a server that fails to start is skipped, never fatal.
  let tools = TOOL_DECLARATIONS;
  try {
    const mcpRes = await ctx.api.mcpTools?.();
    if (mcpRes?.ok && mcpRes.tools?.length) tools = [...TOOL_DECLARATIONS, ...mcpRes.tools];
    if (mcpRes?.problems?.length) {
      onEvent({ type: 'tool', id: 'mcp-warn', name: 'mcp', label: `MCP server(s) unavailable: ${mcpRes.problems.map((p) => `${p.server} (${p.error})`).join('; ')}`, status: 'error' });
    }
  } catch { /* MCP is optional */ }
  let changed = false;
  let provider; // once a fallback answered, the rest of the request stays on it
  for (let step = 0; step < MAX_STEPS; step++) {
    if (isCanceled()) return { text: '', canceled: true, changed };
    const res = await ctx.api.agentStep({ system: SYSTEM_PROMPT, contents, tools, provider });
    if (!res.ok) return { error: res };
    if (res.fellBack?.length) {
      const why = res.fellBack.map((f) => `${f.name} ${f.reason}`).join(', ');
      onEvent({ type: 'tool', id: `switch-${step}`, name: 'switch', label: `${why}: switched to ${providerName(res.provider)} (${res.model})`, status: 'switch' });
    }
    provider = res.provider;
    contents.push(res.content);
    if (!res.calls.length) return { text: res.text, changed };

    const responses = [];
    for (const call of res.calls) {
      if (isCanceled()) return { text: '', canceled: true, changed };
      const id = `${step}-${responses.length}`;
      onEvent({ type: 'tool', id, name: call.name, label: describeCall(call.name, call.args), status: 'running' });
      const result = call.name.startsWith('mcp_')
        ? await (async () => {
          const r = await ctx.api.mcpCall({ name: call.name, args: call.args });
          return r?.ok ? (typeof r.result === 'string' ? { text: r.result } : r.result) : { error: r?.error || 'MCP call failed' };
        })()
        : await runner.run(call.name, call.args);
      const failed = !!result.error;
      if (!failed && !call.name.startsWith('mcp_') && runner.mutates(call.name)) changed = true;
      onEvent({ type: 'tool', id, name: call.name, label: describeCall(call.name, call.args), status: failed ? 'error' : 'done', detail: failed ? result.error : undefined });
      responses.push({ functionResponse: { name: call.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { text: 'I stopped after several steps without finishing. Tell me what to continue with.', changed };
}
