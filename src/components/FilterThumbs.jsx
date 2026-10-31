import React, { useEffect, useRef, useState } from 'react';
import { samplePhotoUrl, samplePictureUrl } from '../fx/previews.jsx';
import { filterExpr } from '../fx/filters.js';
import { getLut, loadLut, onLutLoaded } from '../fx/lut.js';
import { fxGL } from '../fx/gl.js';

const TW = 160;
const TH = 90;

// The picture the Filters tab previews on: a REAL bundled photograph (public/preview/), rotated
// per filter so tiles differ — never the user's own clips, so their videos and faces are not
// shown as examples. Resolves to a TW x TH canvas; the drawn sample stands in only if a
// photo cannot load.
const samplesByKey = new Map();
function sourceCanvas(seedKey = 'default') {
  if (!samplesByKey.has(seedKey)) {
    samplesByKey.set(seedKey, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = TW;
        c.height = TH;
        const k = Math.max(TW / img.naturalWidth, TH / img.naturalHeight);
        const w = TW / k;
        const h = TH / k;
        c.getContext('2d').drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, TW, TH);
        resolve(c);
      };
      img.onerror = () => { img.onerror = () => resolve(null); img.src = samplePictureUrl(); };
      img.src = samplePhotoUrl(seedKey);
    }));
  }
  return samplesByKey.get(seedKey);
}

// One tile picture: the source with the filter (or the LUT) applied by the same GPU pass the player uses.
export function LookThumb({ filterId, lutRef }) {
  const ref = useRef(null);
  const [tick, setTick] = useState(0);
  useEffect(() => (lutRef ? onLutLoaded(() => setTick((n) => n + 1)) : undefined), [lutRef]);
  useEffect(() => {
    if (lutRef) loadLut(lutRef);
  }, [lutRef]);
  useEffect(() => {
    let alive = true;
    sourceCanvas(filterId || (lutRef ? 'lut' : 'default')).then((src) => {
      const cv = ref.current;
      if (!alive || !cv || !src) return;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, 0, 0);
      try {
        let passes = [];
        if (filterId) {
          const e = filterExpr({ filter: filterId });
          if (e) passes = [{ expr: e, T: 0.5 }];
        } else if (lutRef) {
          const lut = getLut(lutRef);
          if (lut) passes = [{ lut, K: 1 }];
        }
        if (passes.length) ctx.drawImage(fxGL().effects(src, TW, TH, passes), 0, 0);
      } catch {
        // no WebGL: the plain picture stays
      }
    });
    return () => { alive = false; };
  }, [filterId, lutRef && JSON.stringify(lutRef), tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={TW} height={TH} className="look-thumb" aria-hidden="true" />;
}
