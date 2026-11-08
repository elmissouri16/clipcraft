import { videoLayout, clipLen, exportDuration } from '../../state/store.js';
import { stateAtPinned } from '../timeline/track.js';
import { motionQuality } from '../timeline/motionQuality.js';

const N = { type: 'NUMBER' };
export const REVIEW_DECLARATIONS = [{
  name: 'review_section',
  description: 'Render 0–30 seconds of the current edit to a cached, playable MP4. Decode locally for frame changes, black/still/timestamp candidates and audio levels/clipping/silence; attach up to six sampled images from that actual encoded section to the existing model. No new service, video upload or semantic audio listening. Signals can flag intentional edits; compare timeline intent. start_sec/end_sec required. Optional sample_times_sec are absolute timeline times inside the section. Does not change the project or export preferences.',
  parameters: { type: 'OBJECT', properties: { start_sec: N, end_sec: N, sample_times_sec: { type: 'ARRAY', maxItems: 6, items: N } }, required: ['start_sec', 'end_sec'] },
}];

export function reviewTimelineData(p, start, end) {
  const layout = videoLayout(p.videoClips), cuts = layout.filter(row => row.start > start && row.start < end).map(row => ({ time_sec: row.start, clip_id: row.clip.id, transition: row.clip.transition || null }));
  const rows = [...layout.map(row => ({ ...row, track: 'video' })), ...(p.overlayClips || []).map(clip => ({ clip, track: 'overlay', start: clip.start, end: clip.start + clipLen(clip) }))];
  const motion = [];
  for (const row of rows.filter(row => row.start < end && row.end > start && !row.clip.gap).slice(0, 32)) {
    const from = Math.max(start, row.start), to = Math.min(end, row.end), fps = p.fps || 30, len = clipLen(row.clip);
    if (!row.clip.keyframes && !row.clip.anim && !row.clip.pin) continue;
    let previous, maximumStep = 0, maximumScale = 0;const candidates = [];
    for (let i = 0; i <= Math.ceil((to - from) * fps); i++) {
      const time = Math.min(to, from + i / fps), current = stateAtPinned(p, row, time - row.start, len);
      if (previous) {
        const move = Math.hypot(current.transform.x - previous.transform.x, current.transform.y - previous.transform.y), scale = Math.abs(current.transform.scale - previous.transform.scale);
        maximumStep = Math.max(maximumStep, move);maximumScale = Math.max(maximumScale, scale);
        if ((move > .05 || scale > .1 || Math.abs(current.transform.rot - previous.transform.rot) > 12) && candidates.length < 6) candidates.push(time);
      }
      previous = current;
    }
    // Smoothness, measured over the whole clip and reported inside this section.
    const q = motionQuality(lt => stateAtPinned(p, row, lt, len), { len, fps, width: p.width || 1920, height: p.height || 1080, start: row.start, entrance: row.track === 'overlay' });
    const inside = list => list.filter(v => { const t = typeof v === 'number' ? v : v.at_sec; return t >= start && t <= end; });
    motion.push({ clip_id: row.clip.id, maximum_translation_per_frame: maximumStep, maximum_scale_per_frame: maximumScale, abrupt_transform_candidates_sec: candidates,
      smooth: !inside(q.stops).length && !inside(q.jerks).length && !inside(q.rotation_jumps).length, stops_sec: inside(q.stops), jerks_sec: inside(q.jerks), rotation_jumps_sec: inside(q.rotation_jumps),
      reversals: inside(q.reversals), fast: inside(q.fast), peak_pan_frame_widths_per_sec: q.peak_pan_frame_widths_per_sec, peak_zoom_pct_per_sec: q.peak_zoom_pct_per_sec });
  }
  return { expected_cuts: cuts.slice(0, 32), planned_motion: motion, note: 'Transform and cut metadata describe the requested timeline, not proof of rendered quality. Motion smoothness is measured frame by frame from the timeline: stops (stop-and-go at keyframes), jerks (sudden speed changes), rotation jumps and reversals (not after_hold) are defects unless intended; the still images cannot show them.' };
}
export function createReviewTools({ project, revision, startExport, api, requestId, isCanceled, editActive, onProgress }) {
  return {
    async review_section({ start_sec, end_sec, sample_times_sec }) {
      const p = project(), before = revision(p), total = exportDuration(p);
      if (![start_sec, end_sec].every(n => typeof n === 'number' && Number.isFinite(n)) || start_sec < 0 || end_sec > total + 1e-6 || end_sec <= start_sec || end_sec - start_sec > 30) throw Error('Choose a timeline section of at most 30 seconds inside the video.');
      if (sample_times_sec !== undefined && (!Array.isArray(sample_times_sec) || !sample_times_sec.length || sample_times_sec.length > 6 || sample_times_sec.some(t => !Number.isFinite(t) || t < start_sec || t >= end_sec))) throw Error('Choose one to six sample times inside the review section.');
      if (!startExport || !api.agentReviewRendered) throw Error('Restart ClipCraft to load local rendered-section review.');
      const current = () => { if (isCanceled?.() || editActive?.() === false || revision(project()) !== before) throw Error('The project changed or review was stopped. Render the current section again.'); };
      current();
      const output = await startExport({ review: true, start_sec, end_sec, quality: 'medium', resolution: 720, encoder_preset: 'veryfast' }, { requestId, revision: before, isCanceled: () => isCanceled?.() || editActive?.() === false || revision(project()) !== before, onProgress });
      current();
      if (output?.canceled) return { error: 'Section render canceled.', canceled: true };
      if (!output?.ok || !output.file || !output.metadata) throw Error(output?.error || (output?.canceled ? 'Section render canceled.' : 'Section rendering did not return a verified file.'));
      if (Math.abs(output.metadata.duration_sec - (end_sec - start_sec)) > Math.max(.1, 2 / (output.metadata.fps || p.fps || 30))) throw Error('The rendered duration does not match the requested review section.');
      const result = await api.agentReviewRendered({ requestId, file: output.file, revision: before, sample_times: sample_times_sec?.map(t => t - start_sec) });
      current();
      if (result?.error || !result?.frames?.length || !result.video || !result.audio) throw Error(result?.error || 'Local rendered review did not return complete measurements and sampled images.');
      return { ...result, ok: true, revision: before, start_sec, end_sec, timeline: reviewTimelineData(p, start_sec, end_sec),
        artifact: { type: 'video', path: output.file, bytes: output.size, mime_type: 'video/mp4', ...output.metadata },
        note: 'Inspect the attached encoded images alongside local diagnostics. Audio has been measured, not heard by the model; continuous semantic motion/audio review is unavailable.' };
    },
  };
}
