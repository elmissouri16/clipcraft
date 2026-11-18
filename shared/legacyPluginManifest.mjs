// Read-only validation of historical package bytes. Never an authoring or execution API.
import {localTools as validateLocalTools} from './pluginLocal.mjs';
import {validateMotionContributions} from './pluginMotion.mjs';
import {validateColorContributions} from './pluginColor.mjs';
import {validateTextStyleContributions} from './pluginStyles.mjs';
import {contentContributions} from './pluginContent.mjs';
import {validateExportDestination} from './pluginMediaJobs.mjs';
import {validateAction} from './pluginActions.mjs';
import {validatePanel} from './pluginPanels.mjs';
import {validateProvider} from './pluginProviders.mjs';
import {GIF_PARAMETERS} from './pluginGif.mjs';
import {validateCommand,COMMAND_PERMISSIONS} from './pluginCommands.mjs';
import {TRANSLATION_LANGUAGES} from './pluginAi.mjs';
import {validateTransitionDefinition} from './pluginTransitions.mjs';
import {validateEffectDefinition} from './pluginEffects.mjs';
// Public, data-only plugin contract. No application or Node imports.
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
export function validateLegacyManifest(input, appVersion = '2.0.0', allowEmpty = false) {
  keys(input, ['id','name','publisher','version','apiVersion','minClipcraftVersion','description','permissions','contributes','entry'], 'manifest');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/.test(input.id)) fail('id must be publisher.name using lowercase letters, digits and hyphens');
  if (!validVersion(input.version)) fail('version must be a stable major.minor.patch');
  if (input.apiVersion !== PLUGIN_API_VERSION) fail('this ClipCraft supports plugin API 1');
  const minimum = input.minClipcraftVersion || '2.0.0';
  if (!validVersion(minimum) || !validVersion(appVersion)) fail('invalid ClipCraft version');
  const a = appVersion.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] > b[i]) break; if (a[i] < b[i]) fail(`requires ClipCraft ${minimum} or newer`); }
  const permissions=input.permissions??[];
  if(!Array.isArray(permissions)||new Set(permissions).size!==permissions.length||permissions.some(p=>!COMMAND_PERMISSIONS.includes(p)))fail('unsupported command permissions');
  for(const permission of ['clips.retime','clips.automation','clips.effects','clips.properties','clips.manage','tracks.write','timeline.ripple','clips.links','clips.linked','timeline.edit','timeline.reorder','clips.write'])if(permissions.includes(permission)&&(!permissions.includes('editor.read')||permissions.some(p=>!['clips.retime','clips.automation','clips.effects','clips.properties','clips.manage','tracks.write','timeline.ripple','clips.links','clips.linked','timeline.edit','timeline.reorder','clips.write','editor.read','project.read'].includes(p))))fail(`${permission} requires editor.read and cannot be mixed with other write, AI or export permissions`);
  if(permissions.includes('ai.chapters')&&(!permissions.includes('captions.read')||!permissions.includes('markers.write')))fail('ai.chapters requires captions.read and markers.write');
  if(permissions.includes('captions.write')&&(!permissions.includes('captions.read')||permissions.includes('markers.write')||permissions.includes('ai.chapters')))fail('caption writing requires captions.read and cannot be mixed with marker writing');
  if(permissions.includes('ai.translateCaptions')&&(!permissions.includes('captions.read')||!permissions.includes('captions.write')))fail('ai.translateCaptions requires captions.read and captions.write');
  if(permissions.includes('export.gif')&&permissions.some(p=>!['export.gif','export.upload','project.read','editor.read'].includes(p)))fail('GIF export cannot be mixed with editor writes or AI permissions');
  if(permissions.includes('media.process')&&!permissions.includes('media.import'))fail('media.process requires media.import');
  if(permissions.includes('media.import')&&permissions.some(p=>!['media.import','media.process','project.read'].includes(p)))fail('media jobs cannot be mixed with editor writes, AI or exports');
  if(permissions.includes('export.upload')&&!permissions.includes('export.gif'))fail('export.upload requires a verified GIF job');
  keys(input.contributes, ['exportPresets','effects','transitions','commands','aiProviders','panels','actions','exportDestinations','sounds','fonts','textStyles','luts','colorPresets','motionPresets','localTools'], 'contributes');
  const localTools=validateLocalTools(input.contributes.localTools);
  if(permissions.includes('local.run')!==!!localTools.length)fail('local tools require local.run');
  if(permissions.includes('local.run')&&permissions.some(p=>!['local.run','project.read'].includes(p)))fail('local jobs cannot be mixed with editor writes, AI, media or exports');
  const motionPresets=validateMotionContributions(input.contributes.motionPresets);
  const content=contentContributions(input.contributes);
  const colorPresets=validateColorContributions(input.contributes.colorPresets,content.luts?.map(l=>l.id)||[]);
  const textStyles=validateTextStyleContributions(input.contributes.textStyles,content.fonts?.map(f=>f.id)||[]);
  const destinationInput=input.contributes.exportDestinations??[];
  if(!Array.isArray(destinationInput)||destinationInput.length>8)fail('at most eight export destinations');
  const destinationIds=new Set(),exportDestinations=destinationInput.map(d=>{const result=validateExportDestination(d);if(destinationIds.has(result.id))fail('duplicate export destination');destinationIds.add(result.id);return result;});
  if(permissions.includes('export.upload')!==!!exportDestinations.length)fail('export destinations require export.upload and an executable GIF command');
  const panelInput=input.contributes.panels??[];
  if(!Array.isArray(panelInput)||panelInput.length>1)fail('this slice supports one panel per package');
  const panels=panelInput.map(validatePanel);
  const providerInput=input.contributes.aiProviders??[];
  if(!Array.isArray(providerInput)||providerInput.length>16)fail('aiProviders supports up to 16 providers');
  const providerIds=new Set();
  const aiProviders=providerInput.map(value=>{const provider=validateProvider(value);if(providerIds.has(provider.id))fail('duplicate provider ID');providerIds.add(provider.id);return provider;});
  const commands=input.contributes.commands??[];
  if(!Array.isArray(commands)||commands.length>100)fail('commands must be an array of at most 100 items');
  const commandIds=new Set();
  const validatedCommands=commands.map(value=>{const command=validateCommand(value);if(commandIds.has(command.id))fail('duplicate command ID');commandIds.add(command.id);return command;});
  const actionInput=input.contributes.actions??[];
  if(!Array.isArray(actionInput)||actionInput.length>32)fail('actions supports at most 32 UI registrations');
  const actionIds=new Set();
  const actions=actionInput.map(value=>{const action=validateAction(value);if(actionIds.has(action.id)||!commandIds.has(action.commandId))fail('UI action IDs must be unique and reference a command in this package');actionIds.add(action.id);return action;});
  for(const panel of panels)if(panel.commands?.length){
    if(panel.commands.some(id=>!commandIds.has(id)))fail('panel commands must refer to commands in the same package');
    // Same-package commands retain canonical permission combinations and host review.
    // Panel opening grants only the panel's separate read/storage permissions.
  }
  if(permissions.includes('export.gif'))for(const command of validatedCommands){
    if(command.parameters.length!==GIF_PARAMETERS.length||GIF_PARAMETERS.some(p=>{
      const actual=command.parameters.find(a=>a.id===p.id);
      if(!actual)return true;
      if(p.type==='enum')return actual.type!=='enum'||actual.default!==p.default||JSON.stringify(actual.options.map(o=>o.value))!==JSON.stringify(p.options.map(o=>o.value));
      return actual.type!==undefined||['min','max','step','default'].some(k=>actual[k]!==p[k])||!!actual.integer;
    }))fail('GIF commands require the standard GIF parameters');
  }
  if(permissions.includes('captions.write'))for(const command of validatedCommands){
    const language=command.parameters.find(p=>p.id==='language');
    if(language?.type!=='enum'||language.options.some(o=>!TRANSLATION_LANGUAGES.some(l=>l.value===o.value)))fail('caption writing requires a supported language enum');
    const track=command.parameters.find(p=>p.id==='source_track');
    if(track&&(track.type||!track.integer||track.min<1||track.max>128))fail('source_track must be an integer from 1 to 128');
  }
  if(commands.length ? input.entry!=='commands.js' : input.entry!==undefined||permissions.length)fail('commands require entry commands.js; data-only plugins cannot request permissions or an entry');
  const presets = input.contributes.exportPresets ?? [];
  const effects = (input.contributes.effects ?? []);
  if(!Array.isArray(effects)||effects.length>100) fail('effects must be an array of at most 100 items');
  const effectIds=new Set();
  const validatedEffects=effects.map(value=>{const effect=validateEffectDefinition(value);if(effectIds.has(effect.id))fail('duplicate effect ID');effectIds.add(effect.id);return effect;});
  const transitions=input.contributes.transitions??[];
  if(!Array.isArray(transitions)||transitions.length>100)fail('transitions must be an array of at most 100 items');
  const transitionIds=new Set();
  const validatedTransitions=transitions.map(value=>{const transition=validateTransitionDefinition(value);if(transitionIds.has(transition.id))fail('duplicate transition ID');transitionIds.add(transition.id);return transition;});
  if (!Array.isArray(presets) || presets.length > 100 || (!allowEmpty && !presets.length && !effects.length && !transitions.length && !commands.length && !aiProviders.length && !panels.length && !content.sounds?.length && !content.fonts?.length && !textStyles.length && !content.luts?.length && !colorPresets.length && !motionPresets.length)) fail('contributes must contain at least one contribution, with at most 100 per kind');
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
    apiVersion:1, minClipcraftVersion:minimum, description:input.description === undefined ? '' : text(input.description, 'description', 1000), permissions:[...permissions], ...(commands.length?{entry:'commands.js'}:{}), contributes:{...content,...(localTools.length?{localTools}:{}),...(motionPresets.length?{motionPresets}:{}),...(colorPresets.length?{colorPresets}:{}),...(textStyles.length?{textStyles}:{}),exportPresets,effects:validatedEffects,transitions:validatedTransitions,commands:validatedCommands,...(aiProviders.length?{aiProviders}:{}),...(panels.length?{panels}:{}),...(actions.length?{actions}:{}),...(exportDestinations.length?{exportDestinations}:{})} };
}
