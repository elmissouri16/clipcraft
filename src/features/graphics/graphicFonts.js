// Fonts for motion graphics. A graphic is an SVG drawn as an image in the sandbox, which loads
// nothing external, so its fonts travel with the job as data. They come from the app's own bundled
// fonts: the @font-face rules this page already loaded (dev server or packaged build alike).
// "Montserrat 800" picks that weight; a bare family takes 400 and 700 when present. Variable fonts
// answer to their family with or without " Variable" ("Inter" finds "Inter Variable"). A weight the
// family does not ship uses its nearest bundled weight; only a family that is not bundled is missing.

const cache = new Map();
const unquote = (s) => String(s || '').trim().replace(/^["']|["']$/g, '');
const base64 = (buffer) => {
  const bytes = new Uint8Array(buffer); let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
// Decode inline assets locally: CSP permits font data, but not fetch(data:) connections.
const inlineBase64 = url => {
  const comma = url.indexOf(','), header = url.slice(0, comma), payload = url.slice(comma + 1);
  if (/;base64$/i.test(header)) return btoa(atob(decodeURIComponent(payload)));
  const bytes = [];
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === '%') {
      const hex = payload.slice(i + 1, i + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw Error('Invalid inline font.');
      bytes.push(parseInt(hex, 16));i += 2;
    } else bytes.push(payload.charCodeAt(i));
  }
  return base64(new Uint8Array(bytes).buffer);
};
// Font-face rules of every same-origin stylesheet.
function faces(doc) {
  const out = [];
  for (const sheet of Array.from(doc?.styleSheets || [])) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules || [])) if (rule.type === 5 || rule.constructor?.name === 'CSSFontFaceRule') out.push(rule);
  }
  return out;
}
const weightMatches = (declared, wanted) => {
  const [lo, hi = lo] = String(declared || '400').split(/\s+/).map(Number);
  return wanted >= lo && wanted <= hi;
};

// specs: ["Montserrat 800", "Inter"]. Resolves { fonts: [{ family, weight, style, unicodeRange, data }], missing: [...] }.
export async function resolveGraphicFonts(specs = [], { doc = globalThis.document, fetchImpl = globalThis.fetch } = {}) {
  if (!Array.isArray(specs) || !specs.length) return { fonts: [], missing: [] };
  if (!doc || !fetchImpl) return { fonts: [], missing: specs.map(String) };
  const rules = faces(doc), fonts = [], missing = [];
  for (const spec of specs.slice(0, 6)) {
    const m = /^(.*?)(?:\s+(\d{3}))?$/.exec(String(spec).trim()), family = m[1], weights = m[2] ? [Number(m[2])] : [400, 700];
    let found = false, failed = false;
    const ofFamily = rules.filter((r) => [family.toLowerCase(), `${family.toLowerCase()} variable`].includes(unquote(r.style.getPropertyValue('font-family')).toLowerCase())
      && (r.style.getPropertyValue('font-style') || 'normal') === 'normal');
    for (const weight of weights) {
      // The exact weight, or the family's nearest bundled one drawn at the requested weight
      // (Montserrat ships 400/700/900: an 800 uses the 900 face).
      let matching = ofFamily.filter((r) => weightMatches(r.style.getPropertyValue('font-weight'), weight));
      if (!matching.length && ofFamily.length) {
        const declared = (r) => Number(String(r.style.getPropertyValue('font-weight') || '400').split(/\s+/)[0]);
        const nearest = ofFamily.reduce((best, r) => Math.abs(declared(r) - weight) < Math.abs(declared(best) - weight) ? r : best);
        matching = ofFamily.filter((r) => declared(r) === declared(nearest));
      }
      for (const rule of matching) {
        // Vite may inline small subsets instead of emitting a .woff2 asset.
        const url = [...rule.style.getPropertyValue('src').matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g)]
          .map(match => match[1] || match[2] || match[3]).find(value => /\.woff2(?:[?#]|$)/i.test(value) || /^data:(?:font\/woff2|application\/(?:font-woff2|x-font-woff2))(?:;|,)/i.test(value));
        if (!url) { failed = true;continue; }
        const absolute = new URL(url, rule.parentStyleSheet?.href || doc.baseURI).href;
        if (!cache.has(absolute)) cache.set(absolute, absolute.startsWith('data:')
          ? Promise.resolve().then(() => inlineBase64(absolute))
          : fetchImpl(absolute).then((r) => { if (!r.ok) throw Error(String(r.status)); return r.arrayBuffer(); }).then(base64));
        try {
          fonts.push({ family, weight, style: 'normal', unicodeRange: rule.style.getPropertyValue('unicode-range') || undefined, data: await cache.get(absolute) });
          found = true;
        } catch { cache.delete(absolute);failed = true; }
      }
    }
    if (!found || failed) missing.push(String(spec));
  }
  return { fonts, missing };
}

// The families a graphic can use: every bundled @font-face family with its weights, e.g.
// ["Montserrat 400/700/900", "Inter 100-900"]. " Variable" is dropped (Inter works).
export function bundledGraphicFamilies(doc = globalThis.document) {
  const weights = new Map();
  for (const rule of faces(doc)) {
    const family = unquote(rule.style.getPropertyValue('font-family')).replace(/ Variable$/i, '');
    if (!family || (rule.style.getPropertyValue('font-style') || 'normal') !== 'normal') continue;
    if (!weights.has(family)) weights.set(family, new Set());
    weights.get(family).add(String(rule.style.getPropertyValue('font-weight') || '400').replace(' ', '-'));
  }
  return [...weights].map(([family, w]) => `${family} ${[...w].sort().join('/')}`).sort();
}
