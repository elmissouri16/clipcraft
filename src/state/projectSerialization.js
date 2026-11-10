import { projectDoc, projectChat } from './projectFile.js';

// The three persistence destinations share one serialization of an immutable
// snapshot. Bound the cache so history cannot retain a string copy per edit.
export function createProjectSerializer(makeWorker) {
  let worker, broken = false, next = 0;
  const pending = new Map(), recent = [];
  const serialize = project => {
    const cached = recent.find(entry => entry.project === project);
    if (cached) return cached.promise;
    const promise = new Promise((resolve, reject) => {
      if (!worker && !broken) {
        try {
          worker = makeWorker();
          worker.onmessage = ({ data }) => {
            const request = pending.get(data.id);if (!request) return;
            pending.delete(data.id);
            if (data.error) request.reject(new Error(data.error));else request.resolve(data.value);
          };
          worker.onerror = event => {
            broken = true;worker.terminate();worker = null;
            for (const request of pending.values()) request.reject(new Error(event.message || 'Project serializer stopped.'));
            pending.clear();
          };
        } catch { broken = true; }
      }
      if (!worker) {
        try { resolve({ compact: JSON.stringify(project), pretty: JSON.stringify(project, null, 2) }); }
        catch (error) { reject(error); }
        return;
      }
      const id = ++next;pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, project }); }
      catch (error) { pending.delete(id);reject(error); }
    });
    const entry = { project, promise };recent.push(entry);
    if (recent.length > 4) recent.shift();
    promise.catch(() => { const index = recent.indexOf(entry);if (index >= 0) recent.splice(index, 1); });
    return promise;
  };
  return serialize;
}

export const serializeProject = createProjectSerializer(() => new Worker(new URL('./projectSerializer.worker.js', import.meta.url), { type: 'module' }));

// The document and the chat as separate strings (docs/architecture/project-file.md): chat is null
// when the project has no conversations worth storing.
export async function serializeProjectParts(project) {
  const chat = projectChat(project);
  const [doc, chatOut] = await Promise.all([serializeProject(projectDoc(project)), chat ? serializeProject(chat) : null]);
  return { doc, chat: chatOut };
}
