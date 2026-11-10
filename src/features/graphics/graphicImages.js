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

// Every string in the inputs (top level, and one level into lists of rows, so a series can carry a
// picture per row) that is the id of a library picture: [{ id, path }], each once, at most 8.
export function graphicImageRefs(project, inputs) {
  const pictures = new Map((project?.media || []).filter(isLibraryPicture).map((m) => [m.id, m]));
  const refs = new Map();
  const take = (value) => { const m = typeof value === 'string' && pictures.get(value); if (m && !refs.has(m.id) && refs.size < MAX) refs.set(m.id, { id: m.id, path: m.path }); };
  for (const value of Object.values(inputs || {})) {
    take(value);
    if (Array.isArray(value)) for (const row of value) { take(row); if (row && typeof row === 'object' && !Array.isArray(row)) for (const v of Object.values(row)) take(v); }
  }
  return [...refs.values()];
}
