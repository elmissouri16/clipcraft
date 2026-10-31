// Drag & drop between the asset panels, the preview and the timeline.
// dragover handlers can't read dataTransfer data, so the active payload is also kept here.
export const DND_TYPE = 'application/x-clipcraft';

let current = null;

// payload: { kind: 'media', id, mediaType } | { kind: 'sticker', emoji } | { kind: 'text', patch }
//        | { kind: 'filter' | 'effect' | 'transition', id }
export function dragProps(payload) {
  return {
    draggable: true,
    onDragStart: (e) => {
      current = payload;
      e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    },
    onDragEnd: () => {
      current = null;
    },
  };
}

export const activeDrag = () => current;
export const isInternal = (e) => [...e.dataTransfer.types].includes(DND_TYPE);
export const isFiles = (e) => [...e.dataTransfer.types].includes('Files');

export function readPayload(e) {
  try {
    return JSON.parse(e.dataTransfer.getData(DND_TYPE));
  } catch {
    return current;
  }
}

// Timeline lane that naturally receives a payload.
export function laneFor(p) {
  if (!p) return null;
  if (p.kind === 'media') return p.mediaType === 'audio' ? 'audio' : 'video';
  if (p.kind === 'sticker') return 'sticker';
  if (p.kind === 'text') return 'text';
  return 'clip'; // filter / effect / transition: dropped onto a video clip
}
