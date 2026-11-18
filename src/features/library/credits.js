// Credits belong to the timeline, regardless of media type or how an item was imported.
export function projectCredits(project) {
  if (!project) return [];
  const used = new Set(['videoClips', 'overlayClips', 'audioClips'].flatMap(k => (project[k] || []).map(c => c.mediaId)));
  return [...new Set((project.media || []).filter(m => used.has(m.id) && m.credit&&(m.credit.license === 'by'||m.origin==='plugin-pack'))
    .map(m => m.credit.line).filter(Boolean))];
}
