import assert from 'node:assert/strict';
import { recentEntryFor, spritePosterStyle } from '../src/recents.js';
const url = (p) => 'file://' + p;
// video with sprite wins over image, follows main-track order
const p = { name: 'Demo', ratio: '9:16',
  media: [ { id: 'i1', type: 'image', path: '/x/pic.jpg' },
           { id: 'v2', type: 'video', path: '/x/b.mp4', thumb: '/c/b.png', thumbCount: 40, thumbW: 50, thumbH: 90 },
           { id: 'v1', type: 'video', path: '/x/a.mp4', thumb: '/c/a.png', thumbCount: 30, thumbW: 160, thumbH: 90 } ],
  videoClips: [ { mediaId: 'v1' }, { mediaId: 'v2' } ] };
const e = recentEntryFor(p, '/proj/p.json', url);
assert.equal(e.thumb.kind, 'sprite'); assert.equal(e.thumb.src, 'file:///c/a.png'); assert.equal(e.thumb.count, 30);
// video without visuals yet -> image fallback
const e2 = recentEntryFor({ ...p, media: p.media.map(m => ({...m, thumb: undefined, thumbCount: 0})) }, '/p', url);
assert.equal(e2.thumb.kind, 'image'); assert.equal(e2.thumb.src, 'file:///x/pic.jpg');
// nothing usable -> null (placeholder)
assert.equal(recentEntryFor({ media: [], videoClips: [] }, '/p', url).thumb, null);
assert.equal(recentEntryFor(null, '/p', url).thumb, null);
// sprite style: background spans count frames
const st = spritePosterStyle(e.thumb);
assert.equal(st.backgroundSize, '3000% 100%'); assert.equal(st.aspectRatio, '160 / 90');
assert.equal(spritePosterStyle(null), null);
console.log('recents OK: video sprite poster preferred, image fallback, null placeholder, style math verified');
