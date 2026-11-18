import {extensionManifest} from './pluginExtension.mjs';
import {pluginIconPath} from './pluginIcon.mjs';
import {validateMotionContributions} from './pluginMotion.mjs';
import {validateColorContributions} from './pluginColor.mjs';
import {validateTextStyleContributions} from './pluginStyles.mjs';
import {contentContributions} from './pluginContent.mjs';
import {validateTransitionDefinition} from './pluginTransitions.mjs';
import {validateEffectDefinition} from './pluginEffects.mjs';
export const PLUGIN_API_VERSION = 1;
export const MANIFEST_LIMIT = 256 * 1024;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = message => { throw Error(`Invalid plugin: ${message}`); };
const keys = (v, allowed, where) => {
  if (!record(v)) fail(`${where} must be an object`);
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail(`unsupported ${where} field ${key}`);
};
const text = (v, where, max = 160) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v)) fail(`${where} must be plain text (1–${max} characters)`); return v; };
export const validVersion = v => typeof v === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(v);
export function validateManifest(input, appVersion='2.0.0', allowEmpty=false){
  if(input?.entry!==undefined||input?.permissions?.length||['aiProviders','panels','localTools','actions','exportDestinations'].some(kind=>Object.hasOwn(input?.contributes||{},kind)))fail('legacy executable declarations are retired; use main: dist/extension.cjs and the general extension API');
  if(input?.main!==undefined){
    const ext=extensionManifest(input);
    const {main,activationEvents,...base}=input;
    const {views,shortcuts,...contributions}=base.contributes||{};
    const validated=validateManifest({...base,contributes:{...contributions,commands:[]}},appVersion,true);
    return {...validated,main:ext.main,activationEvents:ext.activationEvents,contributes:{...validated.contributes,commands:ext.commands,views:ext.views,shortcuts:ext.shortcuts}};
  }
  keys(input, ['id','name','publisher','version','apiVersion','minClipcraftVersion','description','icon','permissions','contributes'], 'manifest');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/.test(input.id)) fail('id must be publisher.name using lowercase letters, digits and hyphens');
  if (!validVersion(input.version)) fail('version must be a stable major.minor.patch');
  if (input.apiVersion !== PLUGIN_API_VERSION) fail('this ClipCraft supports plugin API 1');
  const minimum = input.minClipcraftVersion || '2.0.0';
  if (!validVersion(minimum) || !validVersion(appVersion)) fail('invalid ClipCraft version');
  const a = appVersion.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] > b[i]) break; if (a[i] < b[i]) fail(`requires ClipCraft ${minimum} or newer`); }
  if(input.permissions!==undefined&&(!Array.isArray(input.permissions)||input.permissions.length))fail('creative packs cannot request permissions');
  keys(input.contributes,['exportPresets','effects','transitions','commands','sounds','fonts','textStyles','luts','colorPresets','motionPresets'],'contributes');
  if(input.contributes.commands!==undefined&&(!Array.isArray(input.contributes.commands)||input.contributes.commands.length))fail('commands require a Node extension main entry');
  const motionPresets=validateMotionContributions(input.contributes.motionPresets),content=contentContributions(input.contributes);
  const colorPresets=validateColorContributions(input.contributes.colorPresets,content.luts?.map(l=>l.id)||[]),textStyles=validateTextStyleContributions(input.contributes.textStyles,content.fonts?.map(f=>f.id)||[]);
  const presets = input.contributes.exportPresets ?? [];
  const effects = (input.contributes.effects ?? []);
  if(!Array.isArray(effects)||effects.length>100) fail('effects must be an array of at most 100 items');
  const effectIds=new Set();
  const validatedEffects=effects.map(value=>{const effect=validateEffectDefinition(value);if(effectIds.has(effect.id))fail('duplicate effect ID');effectIds.add(effect.id);return effect;});
  const transitions=input.contributes.transitions??[];
  if(!Array.isArray(transitions)||transitions.length>100)fail('transitions must be an array of at most 100 items');
  const transitionIds=new Set();
  const validatedTransitions=transitions.map(value=>{const transition=validateTransitionDefinition(value);if(transitionIds.has(transition.id))fail('duplicate transition ID');transitionIds.add(transition.id);return transition;});
  if (!Array.isArray(presets) || presets.length > 100 || (!allowEmpty && !presets.length && !effects.length && !transitions.length && !content.sounds?.length && !content.fonts?.length && !textStyles.length && !content.luts?.length && !colorPresets.length && !motionPresets.length)) fail('contributes must contain at least one contribution, with at most 100 per kind');
  const ids = new Set();
  const exportPresets = presets.map(p => {
    keys(p, ['id','name','settings'], 'preset');
    if (typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(p.id) || ids.has(p.id)) fail('preset IDs must be unique lowercase names');
    ids.add(p.id);
    const s = p.settings;
    keys(s, ['mode','crf','bitrateMbps','encoderPreset','audioKbps','resCap','fps','codec'], 'settings');
    if (!['crf','bitrate'].includes(s.mode) || !['h264','h265'].includes(s.codec)) fail('unsupported quality mode or codec');
    if (!Number.isInteger(s.crf) || s.crf < 0 || s.crf > 51) fail('crf must be 0–51');
    if (!Number.isFinite(s.bitrateMbps) || s.bitrateMbps < 0.5 || s.bitrateMbps > 100) fail('bitrateMbps must be 0.5–100');
    if (!['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'].includes(s.encoderPreset)) fail('unsupported encoderPreset');
    for (const [key, values] of Object.entries({ audioKbps:[96,128,192,256,320], resCap:[0,2160,1440,1080,720,480], fps:[0,24,25,30,50,60] })) if (!values.includes(s[key])) fail(`unsupported ${key}`);
    return { id:p.id, name:text(p.name, 'preset name'), settings:{...s} };
  });
  return { id:input.id, name:text(input.name, 'name'), publisher:text(input.publisher, 'publisher'), version:input.version,
    apiVersion:1, minClipcraftVersion:minimum, ...(input.icon===undefined?{}:{icon:pluginIconPath(input.icon)}), description:input.description === undefined ? '' : text(input.description, 'description', 1000), permissions:[], contributes:{...content,...(motionPresets.length?{motionPresets}:{}),...(colorPresets.length?{colorPresets}:{}),...(textStyles.length?{textStyles}:{}),exportPresets,effects:validatedEffects,transitions:validatedTransitions,commands:[]} };
}
