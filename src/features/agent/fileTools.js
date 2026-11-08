// Local source ingestion. Heavy filesystem/probing stays in the main process.
import { clipLen, exportDuration, videoLayout } from '../../state/store.js';
const S = { type: 'STRING' }, N = { type: 'NUMBER' }, I = { type: 'INTEGER' }, B = { type: 'BOOLEAN' };
const FILE_ARGS = { paths: { type: 'ARRAY', items: S }, recursive: B, offset: I, limit: I, pick: { ...S, enum: ['files', 'folder'] } };
export const FILE_DECLARATIONS = [
  { name: 'list_local_media', description: 'List supported local media from paths supplied by the user. Folders use natural filename order, recursive optional. Paginated, limit 1–64. With no paths, let the user choose files or a folder (pick). Reports skipped/unreadable/truncated results.',
    parameters: { type: 'OBJECT', properties: FILE_ARGS } },
  { name: 'import_media', description: 'Import user-supplied local files/folders into the project. Same paging as list_local_media. as library (default), main, overlay or audio. Timeline insertion preserves file order; optional start_sec/main_index. Never invent paths. With no paths, opens a file/folder chooser.',
    parameters: { type: 'OBJECT', properties: { ...FILE_ARGS, as: { ...S, enum: ['library', 'main', 'overlay', 'audio'] }, start_sec: N, main_index: I } } },
];
export function createFileTools(env) {
  const { api, project, after, addProbed, place, settle, findClip } = env;
  const job = async (action, args) => {
    if (!api.agentFileJob) throw Error('Restart ClipCraft to load local file tools.');
    const result = await api.agentFileJob({ ...args, action, requestId: env.requestId });
    if (result?.error) throw Error(result.error);
    if (result?.canceled) throw Error('The user canceled file selection. Do not reopen it unless requested.');
    return result;
  };
  return {
    async list_local_media(args) {
      const result = await job('list', args);
      return { ...result, revision: env.revision(project()) };
    },
    async import_media(args) {
      const as = args.as || 'library';
      if (!['library', 'main', 'overlay', 'audio'].includes(as)) throw Error('as must be library, main, overlay or audio.');
      if (args.start_sec !== undefined && (!Number.isFinite(args.start_sec) || args.start_sec < 0)) throw Error('start_sec must be nonnegative.');
      if (args.main_index !== undefined && (!Number.isInteger(args.main_index) || args.main_index < 0)) throw Error('main_index must be nonnegative.');
      const result = await job('import', args), imported = [];
      if (!result.items?.length) throw Error(result.failures?.[0]?.error || 'No supported, readable media was found in that page.');
      if (as === 'audio' && result.items.some(item => item.type !== 'audio')) throw Error('For as audio, choose audio files. Import video into the library and use extract_audio for its soundtrack.');
      for (const item of result.items) {
        const existing = project().media.find(m => m.path === item.path), media = existing || addProbed(item);
        if (!media) throw Error(`Could not import ${item.name || item.path}.`);
        imported.push(media);
      }
      await settle();
      const clips = [];let start = args.start_sec ?? 0, index = args.main_index;
      for (const media of imported) if (as !== 'library') {
        const placed = await place(media, { as, start_sec: start, main_index: index });
        if (placed.error) throw Error(placed.error);
        clips.push(placed);
        const clip = findClip(placed.clip_id)?.clip;
        if (placed.track === 'video') {
          if (index !== undefined) index++;
          start = videoLayout(project().videoClips).find(row => row.clip.id === placed.clip_id)?.end ?? start;
        } else start += clip ? clipLen(clip) : 0;
      }
      const output = await after({ media: imported.map(m => ({ media_id: m.id, name: m.name, type: m.type, duration_sec: m.duration, width: m.width, height: m.height })),
        clips, failures: result.failures || [], warnings: result.warnings || [], total: result.total,
        next_offset: result.next_offset, truncated: result.truncated, export_duration_sec: exportDuration(project()) });
      if (result.failures?.length || result.warnings?.length) output.error = 'Some requested files could not be read. Imported items are listed; inspect failures/warnings before retrying or reporting completion.';
      return output;
    },
  };
}
