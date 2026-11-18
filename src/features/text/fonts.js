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
import { createFontLoader, textFontRequests } from './fontLoading.js';
import { t } from '../../i18n/index.js';

import {F,FONT_LIST} from '../../../shared/fontCatalog.mjs';
export {FONT_LIST} from '../../../shared/fontCatalog.mjs';

const BY_ID = Object.fromEntries(FONT_LIST.map((f) => [f.id, f]));
// Ids used by older projects.
const LEGACY = { arialbd: 'arial' };

// ---- Your fonts (imported .ttf / .otf / .woff / .woff2, kept for every project) ----
// Loaded from their bytes into document.fonts; each gets its own family name so it never clashes with a
// built-in one. A project that uses a font this PC does not have falls back to Arial.
export const CUSTOM_GROUP = 'Your fonts';
let custom = [];
const listeners = new Set();
let revision = 0;
export const getFontRevision = () => revision;
const changed = () => { revision++;listeners.forEach((fn) => fn()); };
// Calls fn when the font list changes (a font added or removed). Returns the unsubscribe function.
export function onFontsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Every font: yours first, then the built-in ones.
export const allFonts = () => [...custom.filter(f=>f.source!=='pack'||f.preferred), ...FONT_LIST];

const faces = {};
let loader;
let customSignature;
async function loadCustom(list) {
  const signature=JSON.stringify(list);if(signature===customSignature)return;customSignature=signature;
  Object.keys(faces).filter((id) => !list.some((f) => f.id === id)).forEach((id) => {
    faces[id].then(list => list.forEach(face=>document.fonts.delete(face)), () => {});
    delete faces[id];
    loader?.invalidate(id);
  });
  custom = list.map(font => {const {id,name}=font;if(font.source!=='pack')return {...F(id,name,`ClipCraft ${id}`,CUSTOM_GROUP),source:'custom'};const weights=font.faces.map(f=>f.weight),regular=weights.reduce((a,b)=>Math.abs(a-400)<=Math.abs(b-400)?a:b),bold=weights.reduce((a,b)=>Math.abs(a-700)<=Math.abs(b-700)?a:b);return {...F(id,name,`ClipCraft ${id}`,'Plugins'),...font,family:`ClipCraft ${id}`,group:'Plugins',regular,bold};});
  changed();
}

function fontLoader() {
  return loader ||= createFontLoader({
    fontSet: document.fonts,
    localFace: family => new FontFace('ClipCraft local font probe', `local(${JSON.stringify(family)})`),
    customFace: async font => {
      if (!faces[font.id]) {const job = (async () => {
        const loaded=[];
        try{for(const [index,descriptor] of (font.faces||[{}]).entries()){
          const data = await window.api.fontData(font.id,index);
          if (!data) throw Error('Font data is unavailable.');
          const face = await new FontFace(font.family, data, font.source==='pack'?{weight:String(descriptor.weight),style:descriptor.style}:{}).load();
          loaded.push(face);
        }
        // A package may be disabled while a decoder is still loading.
        if(!custom.some(f=>f.id===font.id))throw Error('Font pack became unavailable.');
        loaded.forEach(face=>document.fonts.add(face));return loaded;
        }catch(error){loaded.forEach(face=>document.fonts.delete(face));throw error;}
      })().catch(error => { if(faces[font.id]===job)delete faces[font.id];throw error; });faces[font.id]=job;}
      await faces[font.id];
    },
    onChange: () => listeners.forEach(fn => fn()),
  });
}

let customReady = null, watchingPacks=false,fontRequest=0,latestFontRequest=Promise.resolve();
function refreshCustom({clearOnError=false}={}){
  if(!window.api?.fontsList)return Promise.resolve();const request=++fontRequest;
  const job=window.api.fontsList().then(list=>request===fontRequest?loadCustom(list):latestFontRequest).catch(async error=>{if(request!==fontRequest)return latestFontRequest;if(clearOnError)await loadCustom([]);throw error;});
  latestFontRequest=job;return job;
}
function customFonts() {
  if(!watchingPacks){watchingPacks=true;window.api?.onPluginsChanged?.(()=>{customReady=refreshCustom({clearOnError:true}).catch(()=>{});});}
  if (!customReady) customReady = refreshCustom().catch(() => {});
  return customReady;
}

// Adds font files (dropped File objects, or the file picker when none). Returns { added: [ids], skipped, error }.
export async function importFonts(files) {
  const res = await window.api.fontsImport(files || null);
  if (res.error) return res;
  await customFonts();
  await refreshCustom();
  return res;
}

export async function removeFont(id) {
  const res = await window.api.fontsRemove(id);
  if (res.list) await refreshCustom();
  return res;
}

export function fontById(id) {
  return BY_ID[id] || custom.find((f) => f.id === id) || BY_ID[LEGACY[id]] || BY_ID.arial;
}

export function fontDependency(id){const font=fontById(id);return font.source==='pack'?{pluginId:font.pluginId,digest:font.digest,version:font.version,id:font.localId,name:font.name}:undefined;}

export function fontStatus(id) {
  const font = BY_ID[id] || custom.find(f => f.id === id) || BY_ID[LEGACY[id]];
  return font ? loader?.status(font.id) : false;
}

export function cssFont(fontId, sizePx, bold, italic) {
  const f = fontById(fontId);
  const weight = bold ? f.bold ?? f.regular : f.regular;
  return `${italic ? 'italic ' : ''}${weight} ${sizePx}px "${f.family}", Arial, sans-serif`;
}

// Only the requested faces and actual text subsets; callers choose preview fallback or strict export.
export async function fontsReady(clips = [], { strict = false } = {}) {
  await customFonts();
  // Export checks refresh availability even in long-lived offscreen renderers.
  if(strict)await refreshCustom();
  const missing = new Set();
  await Promise.all(textFontRequests(clips).map(async request => {
    const font = BY_ID[request.font] || custom.find(f => f.id === request.font) || BY_ID[LEGACY[request.font]];
    if (!font || !await fontLoader().load(font, request)) missing.add(font?.name || request.font);
  }));
  const names = [...missing].sort();
  if (strict && names.length) throw Error(t('fonts.export_missing', { names: names.join(', ') }));
  return names;
}
