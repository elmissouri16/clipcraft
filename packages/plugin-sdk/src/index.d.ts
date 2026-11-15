/** ClipCraft SDK 0.7.0; permission and runtime validation remain host-owned. */
export declare const SDK_VERSION: '0.7.0';
export declare const HOST_API_VERSION: 1;
export type ErrorCode='MANIFEST_INVALID'|'INVALID_ARGUMENT'|'UNKNOWN_COMMAND'|'HOST_UNAVAILABLE'|'API_MISMATCH'|'PERMISSION_DENIED'|'HOST_REJECTED'|'DISPOSED'|'BUSY';
export declare class PluginError extends Error {readonly code:ErrorCode;constructor(code:ErrorCode,message:string,options?:ErrorOptions);}
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type CommandPermission='clips.linked'|'timeline.edit'|'timeline.reorder'|'clips.write'|'editor.read'|'project.read'|'markers.write'|'captions.read'|'ai.chapters'|'captions.write'|'ai.translateCaptions'|'export.gif';
export type PanelPermission='editor.read'|'project.read'|'storage.local';
export interface NumericParameter {id:string;name:string;min:number;max:number;step:number;default:number;integer?:boolean;}
export interface EnumParameter {id:string;name:string;type:'enum';options:{value:string;label:string}[];default:string;}
export type CommandParameter=NumericParameter|EnumParameter;
export type CommandInput=Readonly<Record<string,number|string>>;
export interface CommandDefinition {id:string;name:string;description?:string;parameters?:CommandParameter[];}
export type ActionIcon='command'|'sparkles'|'scissors'|'export'|'text'|'audio'|'layers'|'info';
export interface ActionDefinition {id:string;commandId:string;label:string;icon?:ActionIcon;locations:('plugins-menu'|'clip-menu')[];when?:{selection?:'any'|'none'|'single'|'multiple';lanes?:EditorLane[]};}
export interface EffectDefinition {id:string;name:string;expression:string;parameters?:Omit<NumericParameter,'integer'>[];}
export interface TransitionDefinition extends EffectDefinition {duration?:number;}
export interface ExportSettings {mode:'crf'|'bitrate';crf:number;bitrateMbps:number;encoderPreset:'ultrafast'|'superfast'|'veryfast'|'faster'|'fast'|'medium'|'slow'|'slower'|'veryslow';audioKbps:96|128|192|256|320;resCap:0|480|720|1080|1440|2160;fps:0|24|25|30|50|60;codec:'h264'|'h265';}
export interface ExportPreset {id:string;name:string;settings:ExportSettings;}
export interface PanelDefinition {id:string;name:string;entry:'panel.html';script?:'panel.js';style?:'panel.css';permissions?:PanelPermission[];commands?:string[];}
export interface AiProviderDefinition {id:string;name:string;description?:string;protocol:'openai';baseUrl:string;needsKey:boolean;models:{id:string;name:string;vision:boolean}[];defaultModel:string;}
export interface PluginManifest {id:string;name:string;publisher:string;version:string;apiVersion:1;minClipcraftVersion?:string;description?:string;entry?:'commands.js';permissions?:CommandPermission[];contributes:{actions?:ActionDefinition[];commands?:CommandDefinition[];panels?:PanelDefinition[];effects?:EffectDefinition[];transitions?:TransitionDefinition[];exportPresets?:ExportPreset[];aiProviders?:AiProviderDefinition[];};}
export declare function definePlugin<T extends PluginManifest>(manifest:T):T;
export interface Marker {time:number;label:string;}
export interface CommandProject {duration_sec:number;fps:number;markers:Marker[];markers_total:number;}
export interface CaptionCue {start_sec:number;end_sec:number;text:string;}
export type TranslationLanguage='en'|'fr'|'es'|'ar'|'de'|'it'|'pt'|'ja'|'ko'|'zh'|'tr'|'hi';
export interface TranslatedCue {index:number;text:string;}
export interface GifInput {start_sec:number;end_sec:number;max_size:'size-320'|'size-480'|'size-720'|'size-960';fps:'fps-5'|'fps-10'|'fps-20';}
export interface GifPlan {staged:true;start_sec:number;end_sec:number;width:number;height:number;fps:number;frame_count:number;duration_sec:number;}
/** Only declared permissions are granted. Effects/providers/presets are declarative, not context methods. */
export interface CommandContext {
 readonly command:{readonly id:string};
 readonly editor:{read():Promise<EditorSnapshot>;stage(transaction:ClipTransaction):Promise<{staged:number}>};
 readonly project:{read():Promise<CommandProject>};
 readonly markers:{add(markers:Marker[]):Promise<{staged:number}>};
 readonly transcript:{read():Promise<CaptionCue[]>};
 readonly ai:{chapters(input:{count:number}):Promise<Marker[]>;translateCaptions(input:{language:TranslationLanguage}):Promise<TranslatedCue[]>};
 readonly captions:{addTranslation(input:{language:TranslationLanguage;translations:TranslatedCue[]}):Promise<{staged:number}>};
 readonly exports:{gif(input:GifInput):Promise<GifPlan>};
 progress(fraction:number,message?:string):Promise<{ok:true}>;
}
export type CommandResult=void|{message?:string};
export type CommandHandler<Input extends CommandInput=CommandInput>=(context:CommandContext,input:Input)=>CommandResult|Promise<CommandResult>;
export declare function defineCommand<Input extends CommandInput=CommandInput>(handler:CommandHandler<Input>):CommandHandler<Input>;
export declare function defineCommand(handlers:Record<string,CommandHandler>):CommandHandler;
/** Optional editor.read capability; handles are opaque and scoped to one document load. */
export type EditorLane='video'|'overlay'|'audio'|'text'|'effect';
export interface EditorTrack {readonly id:string;readonly lane:EditorLane;readonly layer:number;readonly locked:boolean;readonly hidden:boolean;readonly muted:boolean;readonly solo:boolean;}
export interface EditorClip {readonly id:string;readonly trackId:string;readonly start_sec:number;readonly end_sec:number;readonly gap:boolean;readonly link?:{readonly groupId:string;readonly partnerId:string|null;readonly members_total:number};readonly main?:{readonly index:number;readonly transition:boolean;readonly overlap_sec:number};}
export interface EditorSnapshot {
 readonly version:1;readonly documentId:string;readonly revision:number;
 readonly playhead:{readonly time_sec:number;readonly playing:boolean};
 readonly selection:{readonly clipIds:readonly string[];readonly total:number};
 readonly timeline:{readonly tracks:readonly EditorTrack[];readonly tracks_total:number;readonly clips:readonly EditorClip[];readonly clips_total:number;readonly main_total?:number};
}
export type ClipEdit={type:'split-linked';clipId:string;partnerClipId:string;at_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'trim-linked';clipId:string;partnerClipId:string;start_sec:number;end_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'split';clipId:string;at_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'trim-main';clipId:string;start_sec:number;end_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'reorder';clipId:string;beforeClipId:string|null;gaps:'preserve';transitions:'reject'|'clear-boundaries'}|{type:'move';clipId:string;start_sec:number}|{type:'trim';clipId:string;start_sec:number;end_sec:number};
export interface ClipTransaction {documentId:string;revision:number;operations:readonly ClipEdit[];}
export interface EditorEvent {readonly changes:readonly ('timeline'|'selection'|'playhead')[];readonly snapshot:EditorSnapshot;}
export interface PanelEditor {read():Promise<EditorSnapshot>;onChanged(callback:(event:EditorEvent)=>void):Unsubscribe;}
export interface PanelSummary {name:string;duration_sec:number;fps:number;width:number;height:number;counts:Record<'video'|'overlay'|'audio'|'text'|'effect'|'media'|'markers',number>;markers:Marker[];}
export type PanelTheme=Record<'background'|'surface'|'text'|'muted'|'accent'|'border',string>;
export interface PanelInfo {apiVersion:1;panelId:string;name:string;pluginName:string;version:string;permissions:PanelPermission[];commands:{id:string;name:string;parameters:CommandParameter[]}[];theme:PanelTheme;}
export interface PanelProgress {phase:'permission'|'running'|'applying'|'completed'|'denied'|'canceled'|'failed';progress:number;}
export type PanelCommandResult={status:'completed';markers_added:number;clips_changed?:number}|{status:'denied'|'canceled'|'failed'};
export type Unsubscribe=()=>void;
export interface PanelStorage {get(key:string):Promise<JsonValue>;set(key:string,value:JsonValue):Promise<true>;remove(key:string):Promise<true>;keys():Promise<string[]>;clear():Promise<true>;}
/** Raw isolated preload bridge; do not use the privileged editor API. */
export interface PanelBridge {
 getInfo():Promise<PanelInfo>;
 editor?:PanelEditor;
 project:{read():Promise<PanelSummary>;onChanged(callback:(summary:PanelSummary)=>void):Unsubscribe};
 theme:{onChanged(callback:(theme:PanelTheme)=>void):Unsubscribe};
 storage:PanelStorage;
 commands:{run(commandId:string,input?:CommandInput):Promise<PanelCommandResult>;cancel():Promise<boolean>;onProgress(callback:(progress:PanelProgress)=>void):Unsubscribe};
}
export interface PanelClient extends Omit<PanelBridge,'getInfo'|'editor'> {readonly editor:PanelEditor;readonly info:Readonly<PanelInfo>;supports(permission:PanelPermission):boolean;dispose():void;}
export declare function connectPanel(options?:{host?:PanelBridge;signal?:AbortSignal}):Promise<Readonly<PanelClient>>;
