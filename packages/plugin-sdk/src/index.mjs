import {validateManifest} from '../../../shared/pluginManifest.mjs';
export const SDK_VERSION='0.8.0';
export const HOST_API_VERSION=1;
export class PluginError extends Error{
 constructor(code,message,options){super(message,options);this.name='PluginError';this.code=code;}
}
const fail=(code,message)=>{throw new PluginError(code,message);};
export function definePlugin(manifest){try{validateManifest(manifest);return structuredClone(manifest);}catch(error){throw new PluginError('MANIFEST_INVALID',error.message,{cause:error});}}
export {defineExtension,defineServiceContract,defineHookContract} from './extension.mjs';
