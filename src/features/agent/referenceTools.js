// Reference videos: how a finished video is edited, so CraftAI can copy the
// editing style of something the user likes. The analysis runs locally
// (electron/media/editStyle.cjs): the model receives a compact edit fingerprint
// (~1–2k tokens whatever the length) and one or two numbered contact sheets of
// sample shots, never the video itself. Vocabulary: docs/agents/edit-vocabulary.md.

const S = { type: 'STRING' }, B = { type: 'BOOLEAN' };

export const REFERENCE_DECLARATIONS = [
  { name: 'analyze_reference', description: 'Measure how a reference video is edited so you can copy its style: pacing (shot lengths, cuts per minute over time, opening/ending), transitions (cut, jump cut, punch in/out with scale, dissolve, fade), camera moves (zoom in/out, moving, static), colour look, loudness, music tempo and how cuts sit on the beat, speech pace (words per minute, pauses kept, silence at cuts), a timed transcript when the speech is clear (the script: hook, structure, where cuts fall), and sound: energy curve and drops, voice level against its pauses (music ducking), sound hits and risers at cuts. Pass reference_id for a video the user attached to the chat, or media_id for a video in the media library. Returns measurements plus numbered contact sheets of sample shots: judge shot sizes, captions/on-screen text and graphics from those images. Measurements are estimates; copy the style with the editing tools, then compare your edit against these numbers.',
    parameters: { type: 'OBJECT', properties: {
      reference_id: { ...S, description: 'ID of a reference video attached to the chat' },
      media_id: { ...S, description: 'Video in the media library to use as the reference' },
      include_speech: { ...B, description: 'Transcribe and measure speech with the local speech model when installed (default true; slower)' },
      transcript_from_sec: { type: 'NUMBER', description: 'Page through a long transcript: start from this time (from next_from_sec)' },
      contact_sheet: { ...B, description: 'Attach sample shots as contact sheets (default true)' } } } },
];

export function createReferenceTools({ project, api, requestId, isCanceled }) {
  // Sample frames of the reference as up to two numbered contact sheets (six cells each).
  const sheets = async (source, samples) => {
    if (!api.agentInspectFrames || !samples?.length) return null;
    const media = { id: 'reference', type: 'video', name: 'reference', path: source.path, width: source.width, height: source.height, duration: source.duration };
    const frames = [], sheetIds = [], cells = [];
    for (let i = 0; i < Math.min(samples.length, 12); i += 6) {
      const group = samples.slice(i, i + 6).map(s => Math.min(Math.max(0, s.t), Math.max(0, source.duration - 0.05)));
      const result = await api.agentInspectFrames({ project: { width: source.width, height: source.height, media: [media], videoClips: [], overlayClips: [], audioClips: [], textClips: [] },
        revision: 'reference', source: 'media', media_id: 'reference', source_times_sec: group, requestId });
      if (isCanceled?.() || result?.canceled) return { error: 'Reference inspection stopped.' };
      if (result?.error) return { error: result.error };
      frames.push(...result.frames);
      if (result.frames.length > 1 && api.agentFrameSheet) {
        const sheet = await api.agentFrameSheet({ frame_ids: result.frames.map(f => f.id), revision: 'reference' });
        if (sheet && !sheet.error) { sheetIds.push(sheet.id); cells.push(...sheet.cells.map(c => ({ sheet: sheetIds.length, cell: c.cell, source_time_sec: c.source_time_sec }))); }
      }
    }
    return { frames, sheetIds, cells };
  };

  return {
    async analyze_reference(a = {}) {
      if (!api.agentAnalyzeReference) return { error: 'Reference analysis requires an updated ClipCraft.' };
      if (!a.reference_id === !a.media_id) return { error: 'Pass exactly one of reference_id (attached to the chat) or media_id (media library).' };
      if (a.reference_id && !/^[a-f0-9]{64}$/.test(a.reference_id)) return { error: 'Unknown reference_id. Use the ID listed with the attached reference video.' };
      const result = await api.agentAnalyzeReference({ reference_id: a.reference_id, media_id: a.media_id, project: a.media_id ? { media: project().media } : undefined,
        speech: a.include_speech !== false, transcript_from_sec: a.transcript_from_sec, requestId });
      if (isCanceled?.() || result?.canceled) return { error: 'Reference analysis stopped.' };
      if (!result?.ok) return { error: result?.error || 'Reference analysis failed.' };
      const out = { reference: result.name, cached: result.cached, ...result.fingerprint,
        note: 'Copy the measured editing with the editing tools (cuts, punch-ins via transform keyframes, transitions, filters/grade, text templates, music on the beat), adapting to the user’s footage. Some devices may have no matching tool: say which, and use the closest available one. Afterwards compare the edit with these numbers.' };
      if (a.contact_sheet === false || a.transcript_from_sec > 0) return out; // paging the transcript needs no new images
      const views = await sheets(result.source, result.fingerprint.samples);
      if (views?.error) return { ...out, contact_sheet_error: views.error };
      if (!views?.frames.length) return out;
      // The runner attaches `frames` (or the sheet) to the next model turn.
      return { ...out, frames: views.frames, ...(views.sheetIds.length === 1 ? { sheet_id: views.sheetIds[0] } : {}),
        sheet_ids: views.sheetIds, sheet_cells: views.cells,
        contact_sheet_note: `${views.frames.length} sample shots of the reference are attached as numbered contact sheets. Use them for shot sizes, subjects, captions and graphics.` };
    },
  };
}
