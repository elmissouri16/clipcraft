import type {PluginManifest} from './index.js' with {"resolution-mode":"import"};
export class ToolError extends Error {code:string;details?:unknown;constructor(code:string,message:string,details?:unknown);}
export type Template='panel'|'command'|'effect'|'transition'|'export-preset'|'ai-provider';
export const TEMPLATES:Template[];
export interface Validation {key:string;manifest:PluginManifest;files:string[];}
export function createPlugin(directory:string,options:{id:string;name:string;publisher:string;template?:Template}):Promise<{directory:string;template:Template;id:string}>;
export function checkPlugin(directory:string,options?:{appVersion?:string}):Promise<{manifest:PluginManifest;typecheck:'passed'|'not-needed'}>;
export function buildPlugin(directory:string,options?:{appVersion?:string}):Promise<Validation&{directory:string;typecheck:'passed'|'not-needed'}>;
export function validatePlugin(source:string,options?:{appVersion?:string}):Promise<Validation>;
export function packPlugin(source:string,output:string,options?:{appVersion?:string}):Promise<{file:string;key:string;id:string;version:string}>;
