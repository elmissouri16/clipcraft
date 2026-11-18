import {packFilterLutRef} from '../../../shared/pluginColor.mjs';
// 3D LUTs (.cube files): the bundled ones and the user's own. A clip's LUT is applied by a GPU pass (gl.js
// lutPass), the same in the player and the export.
//
// grade.lut = { ref: { bundled: 'file.cube' } | { path: 'C:\\...\\look.cube' }, name, intensity (0..100) }

export const BUNDLED_LUTS = [
  { file: 'slay-01-amber.cube', name: 'Amber', cat: 'Film' },
  { file: 'slay-02-fade.cube', name: 'Fade', cat: 'Film' },
  { file: 'slay-03-neon.cube', name: 'Neon', cat: 'Creative' },
  { file: 'slay-04-film.cube', name: 'Film', cat: 'Film' },
  { file: 'slay-05-portrait.cube', name: 'Portrait', cat: 'Portrait' },
].map((l) => ({ ...l, ref: { bundled: l.file }, credit: 'slay (CC BY 4.0)' }));
export const LUT_CREDIT_URL = 'https://www.slaycamera.com';

export const lutKey = (ref) => (ref?.pluginDigest&&ref?.assetId ? `pack:${ref.pluginDigest}:${ref.assetId}` : ref?.bundled ? `b:${ref.bundled}` : ref?.path ? `p:${ref.path}` : '');
export const lutOn = (lut) => !!(lut && lutKey(lut.ref) && (lut.intensity ?? 100) > 0);

// .cube text -> { size, data: Uint8Array RGBA laid out as size slices of size x size (red across, green down,
// blue picks the slice) }, or throws.
import {parseCube} from '../../../shared/cubeLut.mjs';
export {parseCube} from '../../../shared/cubeLut.mjs';

const cache = new Map(); // key -> { size, data } | Promise | { error }
const listeners = new Set();
const packRefs=new Map();let packGeneration=0,watchingPacks=false;
function watchPacks(){if(watchingPacks)return;watchingPacks=true;window.api?.onPluginsChanged?.(()=>{packGeneration++;for(const [key,ref] of packRefs){cache.delete(key);loadLut(ref);}listeners.forEach(fn=>fn());});}
export const onLutLoaded = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// The LUT if it is loaded (synchronous, for the draw loops), else null.
export function getLut(ref) {
  const v = cache.get(lutKey(ref));
  return v && v.data ? v : null;
}

// Loads (once) and returns the LUT, or { error }.
export function loadLut(ref) {
  if(ref?.pluginDigest){watchPacks();packRefs.set(lutKey(ref),ref);}
  const generation=packGeneration;
  const key = lutKey(ref);
  if (!key) return Promise.resolve({ error: 'No LUT' });
  const v = cache.get(key);
  if (v) return v.then ? v : Promise.resolve(v);
  const p = window.api.readLut(ref).then((res) => {
    let out;
    try {
      out = res.error ? { error: res.error } : parseCube(res.text);
    } catch (e) {
      out = { error: e.message };
    }
    if(ref?.pluginDigest&&generation!==packGeneration)return {error:'LUT pack changed while loading.'};
    cache.set(key, out);
    listeners.forEach((fn) => fn(key));
    return out;
  }).catch(error=>{const out={error:error.message};if(!ref?.pluginDigest||generation===packGeneration){cache.set(key,out);listeners.forEach(fn=>fn(key));}return out;});
  cache.set(key, p);
  return p;
}

// Every LUT a project uses, loaded (before an export).
export async function loadProjectLuts(project,{strict=false}={}) {
  const clips = [...project.videoClips, ...(project.overlayClips || [])].filter(c=>!c.disabled&&!c.gap);
  const refs = [
    ...clips.filter((c) => lutOn(c.grade?.lut)).map((c) => c.grade.lut.ref),
    ...clips.filter(c=>(c.filterIntensity??100)>0).map(c=>packFilterLutRef(c.filter)||(typeof c.filter==='string'&&c.filter.startsWith('lut:')?{bundled:c.filter.slice(4)}:null)).filter(Boolean),
    ...(project.effectClips||[]).filter(c=>!c.disabled&&c.strength!==0&&typeof c.fx==='string'&&c.fx.startsWith('filter:')).map(c=>packFilterLutRef(c.fx.slice(7))||(c.fx.startsWith('filter:lut:')?{bundled:c.fx.slice(11)}:null)).filter(Boolean),
  ];
  if(strict)for(const ref of refs)if(ref?.pluginDigest)cache.delete(lutKey(ref));
  const values=await Promise.all(refs.map(loadLut));if(strict&&values.some(v=>v.error))throw Error('LUTs need attention before export: '+values.filter(v=>v.error).map(v=>v.error).join('; '));return values;
}
