// Recent-project entries for the home screen (localStorage 'clipcraft.recents').
// The thumbnail is video-derived when possible: the first main-track video's generated
// thumbnail SPRITE (electron makeVisuals) — we keep the sprite URL + frame geometry and the
// home card shows frame 0. Falls back to the first image in the project, else null
// (the card then shows its placeholder). Pure: the caller passes its file-URL maker.

export function recentEntryFor(p, path, urlFor) {
  const media = (p && p.media) || [];
  const byId = new Map(media.map((m) => [m.id, m]));
  let vid = null;
  for (const c of (p && p.videoClips) || []) {
    const m = byId.get(c.mediaId);
    if (m && m.type === 'video') { vid = m; break; }
  }
  if (!vid) vid = media.find((m) => m.type === 'video') || null;
  let thumb = null;
  if (vid && vid.thumb && vid.thumbCount) {
    thumb = { kind: 'sprite', src: urlFor(vid.thumb), w: vid.thumbW || 160, h: vid.thumbH || 90, count: vid.thumbCount };
  } else {
    const img = media.find((m) => m.type === 'image');
    if (img) thumb = { kind: 'image', src: urlFor(img.path) };
  }
  return { path, name: p ? p.name : '', ratio: p ? p.ratio : '', modifiedAt: Date.now(), thumb };
}

// Inline style for the sprite-frame poster inside a card: the frame fills the card width,
// keeps its own aspect (the card clips the overflow), background shows frame 0 only.
export function spritePosterStyle(thumb) {
  if (!thumb || thumb.kind !== 'sprite') return null;
  return {
    width: '100%',
    aspectRatio: `${thumb.w} / ${thumb.h}`,
    backgroundImage: `url("${thumb.src}")`,
    backgroundSize: `${thumb.count * 100}% 100%`,
    backgroundPosition: '0 0',
    backgroundRepeat: 'no-repeat',
  };
}
