// Library pictures in motion graphics. A component input of type 'image' holds the media id of a
// picture in the library; the project stores only that id. When the graphic is drawn, the ids its
// inputs name become [{ id, path }] references for the main process, which prepares each file once
// (electron/graphics/images.cjs) and hands the data to the sandbox, where kit.image(id) reads it.
const MAX = 8;

export const isLibraryPicture = (m) => !!m && m.type === 'image' && typeof m.path === 'string' && !!m.path;

// The library's pictures, for the inspector's picker: [{ id, name }].
export function libraryPictures(project) {
  return (project?.media || []).filter(isLibraryPicture).map((m) => ({ id: m.id, name: m.name || m.id }));
}

// Picture ids may be nested inside any object/list. Resolve each once, at most 8.
export function graphicImageRefs(project, inputs) {
  const pictures = new Map((project?.media || []).filter(isLibraryPicture).map((m) => [m.id, m]));
  const refs = new Map();
  const pending = [inputs], seen = new WeakSet(); let visited = 0;
  while (pending.length && refs.size < MAX && visited++ < 50000) {
    const value = pending.pop(), media = typeof value === 'string' && pictures.get(value);
    if (media) refs.set(media.id, { id: media.id, path: media.path });
    else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      const children = Object.values(value);
      for (let index = Math.min(children.length, 50000 - visited) - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
  return [...refs.values()];
}
