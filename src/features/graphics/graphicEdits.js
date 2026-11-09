// Valid edits are saved on clips immediately. Baking is deferred/coalesced, and can finish after
// the inspector closes. A late render never replaces a newer edit, another project, or Undo.
import { renderGraphicMedia, swapGraphicActions } from './graphicMedia.js';
import { videoLayout } from '../../state/store.js';

export function graphicDraftRows(project) {
  return [...videoLayout(project.videoClips).map(row => ({ ...row, track: 'video' })),
    ...(project.overlayClips || []).map(clip => ({ clip, start: clip.start, track: 'overlay' }))]
    .filter(row => row.clip.graphicDraft && project.media.some(m => m.id === row.clip.mediaId && m.graphic));
}

export function createGraphicEdits({ getProject, getGesture = () => false, dispatch, api, render = renderGraphicMedia, delay = 300 }) {
  const jobs = new Map(), listeners = new Set(), statuses = new Map();
  let generation = 0;
  const timing = clip => `${clip.in}:${clip.out}:${clip.speed || 1}`;
  const notify = (id, status) => { statuses.set(id, status); for (const fn of listeners) fn(); };
  const matches = job => {
    const p = getProject();
    return p.id === job.projectId && `${p.width}:${p.height}:${p.fps}` === job.canvas && graphicDraftRows(p).some(row => row.clip.id === job.id && row.clip.graphicDraft === job.draft && row.clip.mediaId === job.mediaId && timing(row.clip) === job.timing);
  };
  const cancel = job => { clearTimeout(job.timer); job.canceled = true; api.cancelGraphicRender?.(job.requestId); };
  const run = (job, force = false) => {
    clearTimeout(job.timer);
    if (job.promise) return job.promise;
    if (job.canceled || !matches(job)) return Promise.resolve();
    if (!force && getGesture()) { job.timer = setTimeout(() => run(job), 100); return Promise.resolve(); }
    job.promise = (async () => {
      notify(job.id, { pending: true });
      const p = getProject(), row = graphicDraftRows(p).find(row => row.clip.id === job.id);
      const m = p.media.find(m => m.id === row.clip.mediaId), g = m.graphic;
      try {
        const out = await render({ api, project: p, code: g.code, fonts: g.fonts || [], inputs: job.draft.inputs,
          duration_sec: row.clip.out, start_sec: row.start, name: m.name, requestId: job.requestId });
        if (job.canceled || !matches(job)) return;
        if (out.error) throw Error(out.error);
        const current = getProject(), clip = graphicDraftRows(current).find(row => row.clip.id === job.id).clip;
        const action = swapGraphicActions(current, row.track, clip, out.media);
        // A trim/speed edit may happen while settings are pending. Preserve the current source
        // interval; the new render covers it, rather than resetting the timeline adjustment.
        Object.assign(action.actions[1].patch, { in: clip.in, out: clip.out });
        const coverage = action.actions.find(a => a.type === 'extendVideoTo');
        if (coverage) coverage.end = clip.start + (clip.out - clip.in) / (clip.speed || 1);
        dispatch({ ...action, transient: true });
        // Let React publish the new project before export takes its snapshot.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (matches(job)) throw Error('The graphic could not be updated; check whether its layer is locked.');
        notify(job.id, {});
      } catch (error) {
        if (!job.canceled && matches(job)) { job.error = error.message; notify(job.id, { error: job.error }); }
      }
    })();
    return job.promise;
  };
  const sync = () => {
    const p = getProject(), rows = graphicDraftRows(p);
    for (const [id, job] of jobs) if (!matches(job)) { cancel(job); jobs.delete(id); notify(id, {}); }
    for (const { clip } of rows) {
      if (jobs.has(clip.id)) continue;
      const job = { id: clip.id, projectId: p.id, canvas: `${p.width}:${p.height}:${p.fps}`, timing: timing(clip), mediaId: clip.mediaId, draft: clip.graphicDraft, requestId: `graphic-edit-${++generation}` };
      jobs.set(clip.id, job); notify(clip.id, { pending: true });
      job.timer = setTimeout(() => run(job), delay);
    }
  };
  return { sync,
    previewError(id, error) { notify(id, { ...statuses.get(id), previewError: error }); },
    status: id => statuses.get(id) || {},
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    retry(id) { const job = jobs.get(id); if (job) { job.promise = null; job.error = null; run(job, true); } },
    async flush() {
      const projectId = getProject().id;
      for (;;) {
        if (getProject().id !== projectId) throw Error('The project changed while preparing graphics.');
        sync();
        const active = [...jobs.values()].filter(matches);
        if (!active.length) return;
        const failed = active.find(job => job.error);
        if (failed) throw Error(`Graphic update failed: ${failed.error}`);
        await Promise.all(active.map(job => run(job, true)));
      }
    },
    dispose() { for (const job of jobs.values()) cancel(job); jobs.clear(); statuses.clear(); },
  };
}

// One editor owns the project in a renderer. Shared only for inspector status/export coordination;
// components themselves still run exclusively in the privileged service's isolated sandbox.
let connected;
const listeners = new Set();
export const graphicEdits = {
  connect(options) {
    connected?.dispose(); connected = createGraphicEdits(options);
    const off = connected.subscribe(() => { for (const fn of listeners) fn(); });
    return () => { off(); connected?.dispose(); connected = null; };
  },
  sync: () => connected?.sync(), flush: () => connected?.flush() || Promise.resolve(),
  status: id => connected?.status(id) || {}, retry: id => connected?.retry(id),
  previewError: (id, error) => connected?.previewError(id, error),
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
