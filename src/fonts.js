// Fonts available to text clips. Bundled fonts are open-source (OFL) packages from @fontsource;
// system fonts ship with Windows. Text is rendered on a canvas for both preview and export,
// so a font only needs to be loadable by the renderer.
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/900.css';
import '@fontsource/anton/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/bangers/400.css';
import '@fontsource/luckiest-guy/400.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/lobster/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/righteous/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/900.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/dancing-script/700.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/900.css';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/tajawal/900.css';
import '@fontsource/lalezar/400.css';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/rakkas/400.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/900.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/900.css';
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/900.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/titan-one/400.css';
import '@fontsource/russo-one/400.css';
import '@fontsource/black-ops-one/400.css';
import '@fontsource/bungee/400.css';
import '@fontsource/creepster/400.css';
import '@fontsource/monoton/400.css';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/audiowide/400.css';
import '@fontsource/chewy/400.css';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/abril-fatface/400.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/kaushan-script/400.css';
import '@fontsource/satisfy/400.css';
import '@fontsource/shadows-into-light/400.css';
import '@fontsource/sacramento/400.css';
import '@fontsource/yellowtail/400.css';
import '@fontsource/almarai/400.css';
import '@fontsource/almarai/800.css';
import '@fontsource/changa/400.css';
import '@fontsource/changa/800.css';
import '@fontsource/el-messiri/400.css';
import '@fontsource/el-messiri/700.css';
import '@fontsource/reem-kufi/400.css';
import '@fontsource/reem-kufi/700.css';
import '@fontsource/aref-ruqaa/400.css';
import '@fontsource/aref-ruqaa/700.css';
import '@fontsource/marhey/400.css';
import '@fontsource/marhey/700.css';
import '@fontsource/lemonada/400.css';
import '@fontsource/lemonada/700.css';
import '@fontsource/noto-kufi-arabic/400.css';
import '@fontsource/noto-kufi-arabic/900.css';
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '@fontsource/baloo-bhaijaan-2/400.css';
import '@fontsource/baloo-bhaijaan-2/800.css';
import '@fontsource/readex-pro/400.css';
import '@fontsource/readex-pro/700.css';

// bold: weight used when the clip is bold (null = the font has a single weight).
const F = (id, name, family, group, bold = 700, regular = 400) => ({ id, name, family, group, bold, regular });

export const FONT_LIST = [
  F('montserrat', 'Montserrat', 'Montserrat', 'Popular', 900),
  F('poppins', 'Poppins', 'Poppins', 'Popular', 900),
  F('anton', 'Anton', 'Anton', 'Popular', null),
  F('bebas', 'Bebas Neue', 'Bebas Neue', 'Popular', null),
  F('oswald', 'Oswald', 'Oswald', 'Popular'),
  F('arialblack', 'Arial Black', 'Arial Black', 'Popular', null),
  F('impact', 'Impact', 'Impact', 'Popular', null),
  F('roboto', 'Roboto', 'Roboto', 'Popular', 900),
  F('rubik', 'Rubik', 'Rubik', 'Popular', 900),
  F('kanit', 'Kanit', 'Kanit', 'Popular', 900),
  F('archivoblack', 'Archivo Black', 'Archivo Black', 'Popular', null),
  F('barlowcond', 'Barlow Condensed', 'Barlow Condensed', 'Popular', 800),
  F('lilita', 'Lilita One', 'Lilita One', 'Popular', null),
  F('fredoka', 'Fredoka', 'Fredoka', 'Popular'),
  F('bangers', 'Bangers', 'Bangers', 'Display', null),
  F('luckiest', 'Luckiest Guy', 'Luckiest Guy', 'Display', null),
  F('marker', 'Permanent Marker', 'Permanent Marker', 'Display', null),
  F('righteous', 'Righteous', 'Righteous', 'Display', null),
  F('pixel', 'Press Start 2P', 'Press Start 2P', 'Display', null),
  F('showcard', 'Showcard Gothic', 'Showcard Gothic', 'Display', null),
  F('cooper', 'Cooper Black', 'Cooper Black', 'Display', null),
  F('stencil', 'Stencil', 'Stencil', 'Display', null),
  F('broadway', 'Broadway', 'Broadway', 'Display', null),
  F('titan', 'Titan One', 'Titan One', 'Display', null),
  F('russo', 'Russo One', 'Russo One', 'Display', null),
  F('blackops', 'Black Ops One', 'Black Ops One', 'Display', null),
  F('bungee', 'Bungee', 'Bungee', 'Display', null),
  F('creepster', 'Creepster', 'Creepster', 'Display', null),
  F('monoton', 'Monoton', 'Monoton', 'Display', null),
  F('orbitron', 'Orbitron', 'Orbitron', 'Display', 900),
  F('audiowide', 'Audiowide', 'Audiowide', 'Display', null),
  F('chewy', 'Chewy', 'Chewy', 'Display', null),
  F('playfair', 'Playfair Display', 'Playfair Display', 'Elegant', 900),
  F('georgia', 'Georgia', 'Georgia', 'Elegant'),
  F('garamond', 'Garamond', 'Garamond', 'Elegant'),
  F('times', 'Times New Roman', 'Times New Roman', 'Elegant'),
  F('cinzel', 'Cinzel', 'Cinzel', 'Elegant', 900),
  F('abril', 'Abril Fatface', 'Abril Fatface', 'Elegant', null),
  F('dmserif', 'DM Serif Display', 'DM Serif Display', 'Elegant', null),
  F('cormorant', 'Cormorant Garamond', 'Cormorant Garamond', 'Elegant'),
  F('pacifico', 'Pacifico', 'Pacifico', 'Script', null),
  F('lobster', 'Lobster', 'Lobster', 'Script', null),
  F('dancing', 'Dancing Script', 'Dancing Script', 'Script'),
  F('caveat', 'Caveat', 'Caveat', 'Script'),
  F('brush', 'Brush Script', 'Brush Script MT', 'Script', null),
  F('segoescript', 'Segoe Script', 'Segoe Script', 'Script'),
  F('inkfree', 'Ink Free', 'Ink Free', 'Script', null),
  F('greatvibes', 'Great Vibes', 'Great Vibes', 'Script', null),
  F('kaushan', 'Kaushan Script', 'Kaushan Script', 'Script', null),
  F('satisfy', 'Satisfy', 'Satisfy', 'Script', null),
  F('shadows', 'Shadows Into Light', 'Shadows Into Light', 'Script', null),
  F('sacramento', 'Sacramento', 'Sacramento', 'Script', null),
  F('yellowtail', 'Yellowtail', 'Yellowtail', 'Script', null),
  F('cairo', 'Cairo (Arabic)', 'Cairo', 'Arabic', 900),
  F('tajawal', 'Tajawal (Arabic)', 'Tajawal', 'Arabic', 900),
  F('lalezar', 'Lalezar (Arabic)', 'Lalezar', 'Arabic', null),
  F('amiri', 'Amiri (Arabic)', 'Amiri', 'Arabic'),
  F('rakkas', 'Rakkas (Arabic)', 'Rakkas', 'Arabic', null),
  F('majalla', 'Sakkal Majalla', 'Sakkal Majalla', 'Arabic'),
  F('tahoma', 'Tahoma', 'Tahoma', 'Arabic'),
  F('almarai', 'Almarai (Arabic)', 'Almarai', 'Arabic', 800),
  F('changa', 'Changa (Arabic)', 'Changa', 'Arabic', 800),
  F('elmessiri', 'El Messiri (Arabic)', 'El Messiri', 'Arabic'),
  F('reemkufi', 'Reem Kufi (Arabic)', 'Reem Kufi', 'Arabic'),
  F('arefruqaa', 'Aref Ruqaa (Arabic)', 'Aref Ruqaa', 'Arabic'),
  F('marhey', 'Marhey (Arabic)', 'Marhey', 'Arabic'),
  F('lemonada', 'Lemonada (Arabic)', 'Lemonada', 'Arabic'),
  F('notokufi', 'Noto Kufi (Arabic)', 'Noto Kufi Arabic', 'Arabic', 900),
  F('notonaskh', 'Noto Naskh (Arabic)', 'Noto Naskh Arabic', 'Arabic'),
  F('baloo', 'Baloo Bhaijaan (Arabic)', 'Baloo Bhaijaan 2', 'Arabic', 800),
  F('readex', 'Readex Pro (Arabic)', 'Readex Pro', 'Arabic'),
  F('arial', 'Arial', 'Arial', 'Basic'),
  F('segoe', 'Segoe UI', 'Segoe UI', 'Basic'),
  F('segoeblack', 'Segoe UI Black', 'Segoe UI Black', 'Basic', null),
  F('bahnschrift', 'Bahnschrift', 'Bahnschrift', 'Basic'),
  F('calibri', 'Calibri', 'Calibri', 'Basic'),
  F('verdana', 'Verdana', 'Verdana', 'Basic'),
  F('trebuchet', 'Trebuchet MS', 'Trebuchet MS', 'Basic'),
  F('comic', 'Comic Sans', 'Comic Sans MS', 'Basic'),
  F('consolas', 'Consolas', 'Consolas', 'Basic'),
];

const BY_ID = Object.fromEntries(FONT_LIST.map((f) => [f.id, f]));
// Ids used by older projects.
const LEGACY = { arialbd: 'arial' };

// ---- Your fonts (imported .ttf / .otf / .woff / .woff2, kept for every project) ----
// Loaded from their bytes into document.fonts; each gets its own family name so it never clashes with a
// built-in one. A project that uses a font this PC does not have falls back to Arial.
export const CUSTOM_GROUP = 'Your fonts';
let custom = [];
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());
// Calls fn when the font list changes (a font added or removed). Returns the unsubscribe function.
export function onFontsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Every font: yours first, then the built-in ones.
export const allFonts = () => [...custom, ...FONT_LIST];

const faces = {};
async function loadCustom(list) {
  const next = [];
  for (const { id, name } of list) {
    const family = `ClipCraft ${id}`;
    if (!faces[id]) {
      try {
        const data = await window.api.fontData(id);
        if (!data) continue;
        const face = new FontFace(family, data);
        await face.load();
        document.fonts.add(face);
        faces[id] = face;
      } catch {
        continue; // not a font the browser can read
      }
    }
    next.push(F(id, name, family, CUSTOM_GROUP));
  }
  Object.keys(faces).filter((id) => !list.some((f) => f.id === id)).forEach((id) => {
    document.fonts.delete(faces[id]);
    delete faces[id];
  });
  custom = next;
  changed();
}

let customReady = null;
function customFonts() {
  if (!customReady) customReady = window.api?.fontsList ? window.api.fontsList().then(loadCustom).catch(() => {}) : Promise.resolve();
  return customReady;
}

// Adds font files (dropped File objects, or the file picker when none). Returns { added: [ids], skipped, error }.
export async function importFonts(files) {
  const res = await window.api.fontsImport(files || null);
  if (res.error) return res;
  await customFonts();
  await loadCustom(res.list);
  return res;
}

export async function removeFont(id) {
  const res = await window.api.fontsRemove(id);
  if (res.list) await loadCustom(res.list);
  return res;
}

export function fontById(id) {
  return BY_ID[id] || custom.find((f) => f.id === id) || BY_ID[LEGACY[id]] || BY_ID.arial;
}

export function cssFont(fontId, sizePx, bold, italic) {
  const f = fontById(fontId);
  const weight = bold ? f.bold ?? f.regular : f.regular;
  return `${italic ? 'italic ' : ''}${weight} ${sizePx}px "${f.family}", Arial, sans-serif`;
}

// Resolves once every bundled font face and your fonts have been loaded (canvas text needs loaded fonts).
let ready = null;
export function fontsReady() {
  if (!ready) {
    const loads = [customFonts()];
    FONT_LIST.forEach((f) => {
      const weights = [f.regular, f.bold].filter((w, i, a) => w != null && a.indexOf(w) === i);
      weights.forEach((w) => loads.push(document.fonts.load(`${w} 32px "${f.family}"`, 'Aa أب').catch(() => {})));
    });
    ready = Promise.all(loads).then(() => document.fonts.ready);
  }
  return ready;
}
