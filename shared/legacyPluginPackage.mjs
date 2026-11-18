// Compatibility for immutable historical bytes, not an executable contribution
// schema. Public authoring uses pluginManifest.mjs and rejects these recipes.
import {validateManifest} from './pluginManifest.mjs';
import {validateLegacyManifest} from './legacyPluginManifest.mjs';
export const CREATIVE_KINDS=Object.freeze(['exportPresets','effects','transitions','sounds','fonts','textStyles','luts','colorPresets','motionPresets']);
export function readPackageManifest(input,appVersion){
 try{return {manifest:validateManifest(input,appVersion),historical:null};}
 catch(error){
  if(!input||input.main!==undefined||!(input.entry!==undefined||input.permissions?.length||['commands','panels','aiProviders','localTools','actions','exportDestinations'].some(kind=>Object.hasOwn(input.contributes||{},kind))))throw error;
  const historical=validateLegacyManifest(input,appVersion),contributes=Object.fromEntries(CREATIVE_KINDS.filter(kind=>historical.contributes[kind]?.length).map(kind=>[kind,historical.contributes[kind]]));
  const manifest=validateManifest({id:historical.id,name:historical.name,publisher:historical.publisher,version:historical.version,apiVersion:historical.apiVersion,minClipcraftVersion:historical.minClipcraftVersion,...(historical.description?{description:historical.description}:{}),contributes},appVersion,true);
  const types=['commands','panels','aiProviders','localTools','actions','exportDestinations'].filter(kind=>historical.contributes[kind]?.length);
  if(types.length||historical.entry||historical.permissions.length)manifest.legacyExecutable={types,creative:CREATIVE_KINDS.some(kind=>contributes[kind]?.length)};
  const panels=(historical.contributes.panels||[]).filter(panel=>panel.permissions.includes('storage.local')).map(panel=>({id:panel.id}));
  if(panels.length)manifest.legacyPreferences={panels};
  return {manifest,historical};
 }
}
