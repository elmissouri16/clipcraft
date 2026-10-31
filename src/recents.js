// Recent-project entries for the home screen (localStorage 'clipcraft.recents').
// The thumbnail is video-derived when possible: the first main-track video's generated
// thumbnail SPRITE (electron makeVisuals) — we keep the sprite URL + frame geometry and the
// home card shows the frame at the project's chosen poster time (project.posterAt, set from
// the Export dialog's cover chooser), or frame 0 when none was chosen. Falls back to the
// first image in the project, else null (the card then shows its placeholder).

import { videoLayout } from './store.js';

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
    // The poster time is a TIMELINE time; the sprite spans the first clip's SOURCE. Map through the
    // layout when the poster sits inside that first clip; anywhere else keeps frame 0 (the sprite
    // has no frames of other clips).
    if (p && typeof p.posterAt === 'number' && p.videoClips && vid.duration) {
      const first = videoLayout(p.videoClips).find((l) => !l.clip.gap && byId.get(l.clip.mediaId) === vid);
      if (first && p.posterAt >= first.start && p.posterAt <= first.end) {
        const srcT = (first.clip.in || 0) + (p.posterAt - first.start) * (first.clip.speed || 1);
        thumb.at = Math.min(1, Math.max(0, srcT / vid.duration));
      }
    }
  } else {
    const img = media.find((m) => m.type === 'image');
    if (img) thumb = { kind: 'image', src: urlFor(img.path) };
  }
  return { path, name: p ? p.name : '', ratio: p ? p.ratio : '', modifiedAt: Date.now(), thumb };
}

// Inline style for the sprite-frame poster inside a card: the frame fills the card width,
// keeps its own aspect (the card clips the overflow). `frac` picks the frame nearest that
// fraction of the source (0 = first frame).
export function spriteFrameStyle(thumb, frac = 0) {
  if (!thumb || thumb.kind !== 'sprite') return null;
  const i = Math.round(Math.min(1, Math.max(0, frac)) * (thumb.count - 1));
  const pct = thumb.count > 1 ? (i / (thumb.count - 1)) * 100 : 0;
  return {
    width: '100%',
    aspectRatio: `${thumb.w} / ${thumb.h}`,
    backgroundImage: `url("${thumb.src}")`,
    backgroundSize: `${thumb.count * 100}% 100%`,
    backgroundPosition: `${pct}% 0`,
    backgroundRepeat: 'no-repeat',
  };
}
export function spritePosterStyle(thumb) {
  return spriteFrameStyle(thumb, thumb && typeof thumb.at === 'number' ? thumb.at : 0);
}

// The Export dialog's cover source: the first main-track video's sprite (or the first image),
// plus the mapping from a TIMELINE time to that sprite's fraction — the same mapping the home
// cards use, parameterized so the cover chooser can scrub. Returns null frac when the time sits
// outside the first clip (the sprite holds no frames of later clips).
export function posterSourceFor(p, urlFor) {
  const media = (p && p.media) || [];
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const c of (p && p.videoClips) || []) {
    const m = byId.get(c.mediaId);
    if (m && m.type === 'video' && m.thumb && m.thumbCount) {
      return { kind: 'sprite', media: m, thumb: { kind: 'sprite', src: urlFor(m.thumb), w: m.thumbW || 160, h: m.thumbH || 90, count: m.thumbCount } };
    }
    if (m && m.type === 'image') return { kind: 'image', media: m, src: urlFor(m.path) };
  }
  const img = media.find((m) => m.type === 'image');
  return img ? { kind: 'image', media: img, src: urlFor(img.path) } : null;
}
export function posterFracAt(p, t) {
  if (!p || !p.videoClips) return null;
  const byId = new Map((p.media || []).map((m) => [m.id, m]));
  const src = posterSourceFor(p, (x) => x);
  if (!src || src.kind !== 'sprite' || !src.media.duration) return null;
  const first = videoLayout(p.videoClips).find((l) => !l.clip.gap && l.clip.mediaId === src.media.id);
  if (!first || t < first.start || t > first.end) return null;
  const srcT = (first.clip.in || 0) + (t - first.start) * (first.clip.speed || 1);
  return Math.min(1, Math.max(0, srcT / src.media.duration));
}
