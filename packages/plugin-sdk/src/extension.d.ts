import type {EditorSnapshot,ClipTransaction} from './index.js';
export type {EditorSnapshot,EditorClip,EditorTrack,EditorLane,ClipTransaction,ClipEdit,LinkedClipPair,ClipTextStyle,ClipPictureTransform,ClipAudioProperties,ClipCurvePoint,ClipCurveProperty} from './index.js';
/** Trusted Node host APIs. Pre-alpha development contract. */
export interface HostCapabilities {apiVersion:1;features:Readonly<Record<string,number|undefined>>}
export type ServiceSchema=
 {readonly type:'null'|'boolean'}|
 {readonly type:'number'|'integer';readonly minimum?:number;readonly maximum?:number}|
 {readonly type:'string';readonly minLength?:number;readonly maxLength?:number;readonly enum?:readonly string[]}|
 {readonly type:'bytes';readonly maxLength?:number}|
 {readonly type:'array';readonly items:ServiceSchema;readonly maxItems?:number}|
 {readonly type:'object';readonly properties:Readonly<Record<string,ServiceSchema>>;readonly required?:readonly string[]};
export type InferServiceSchema<S extends ServiceSchema>=
 S extends {type:'null'}?null:S extends {type:'boolean'}?boolean:
 S extends {type:'number'|'integer'}?number:
 S extends {type:'string';enum:readonly (infer E extends string)[]}?E:
 S extends {type:'string'}?string:S extends {type:'bytes'}?Uint8Array:
 S extends {type:'array';items:infer I extends ServiceSchema}?InferServiceSchema<I>[]:
 S extends {type:'object';properties:infer P extends Record<string,ServiceSchema>}?
 {[K in keyof P as S extends {required:readonly (infer R)[]}?K extends R?K:never:never]:InferServiceSchema<P[K]>}&
 {[K in keyof P as S extends {required:readonly (infer R)[]}?K extends R?never:K:K]?:InferServiceSchema<P[K]>}:never;
export interface ServiceContract {readonly version:number;readonly methods:Readonly<Record<string,{readonly input:ServiceSchema;readonly output:ServiceSchema;readonly stream?:boolean}>>}
export type ServiceImplementation<C extends ServiceContract>={[K in keyof C['methods']]:(input:InferServiceSchema<C['methods'][K]['input']>,control:{signal:AbortSignal})=>C['methods'][K] extends {stream:true}?AsyncIterable<InferServiceSchema<C['methods'][K]['output']>>:InferServiceSchema<C['methods'][K]['output']>|Promise<InferServiceSchema<C['methods'][K]['output']>>};
type ServiceMethodNames<C extends ServiceContract,S extends boolean>={[K in keyof C['methods']]:C['methods'][K] extends {stream:true}?S extends true?K:never:S extends false?K:never}[keyof C['methods']];
export interface ServiceClient<C extends ServiceContract>{
 call<K extends ServiceMethodNames<C,false>>(method:K,input:InferServiceSchema<C['methods'][K]['input']>):Promise<InferServiceSchema<C['methods'][K]['output']>>;
 stream<K extends ServiceMethodNames<C,true>>(method:K,input:InferServiceSchema<C['methods'][K]['input']>,options?:{signal?:AbortSignal}):AsyncIterable<InferServiceSchema<C['methods'][K]['output']>>;
}
export interface ServiceDescription {id:string;extensionId:string;host?:boolean;contract?:ServiceContract;[key:string]:unknown}
export declare function defineServiceContract<const C extends ServiceContract>(contract:C):C;
export type ConfigurationScope={scope?:'global';documentId?:never}|{scope:'project';documentId:string};
/** A host-rendered message. Dismissal, expiry, cancellation or stop returns undefined. message and detail are single lines without control characters; at most three actions; timeoutMs 1–240 s; at most three messages wait at once. */
export interface ExtensionMessage {message:string;detail?:string;kind?:'info'|'warning'|'error';actions?:{id:string;title:string}[];timeoutMs?:number}
export interface Disposable {dispose():void|Promise<void>}
export interface JobContext {signal:AbortSignal;progress(fraction:number,message?:string):Promise<void>}
export interface MediaArtifact {readonly id:string;readonly name:string;readonly type:'image'|'video'|'audio';readonly duration:number;readonly width:number;readonly height:number;readonly hasAudio:boolean;readonly hasVideo:boolean;readonly bytes:number}
export interface MediaPlacement {id:string;documentId?:string;lane?:'video'|'overlay'|'audio';trackId?:string;start_sec?:number;index?:number}
export interface CaptionCueInput {text:string;start_sec:number;end_sec:number}
export type CaptionWriteInput={documentId:string;revision:number;projectRevision?:number;cues:CaptionCueInput[]}&({mode:'append'|'replace';trackId?:string;newTrack?:never}|{mode:'create-track';trackId?:never;newTrack:{name:string;hidden?:boolean;language?:string}});
export type MarkerOperation={type:'add';time_sec:number;label?:string}|{type:'update';id:string;time_sec?:number;label?:string}|{type:'remove';id:string};
export interface MarkerTransaction extends InspectionScope {operations:MarkerOperation[]}
export interface ExtensionFileFilter {name:string;extensions:string[]}
export interface ExtensionFileDialogOptions {title?:string;buttonLabel?:string;defaultPath?:string;filters?:ExtensionFileFilter[]}
export interface ExtensionOpenDialogOptions extends ExtensionFileDialogOptions {kind?:'file'|'directory';multiple?:boolean}
export interface PublishedFile {path:string;bytes:number;sha256:string;atomic:boolean;warning?:string}
export interface FilePublicationOptions {path:string;destination:string;overwrite?:boolean}
export interface ExtensionHostInfo {appVersion:string;apiVersion:1;platform:'aix'|'android'|'darwin'|'freebsd'|'haiku'|'linux'|'openbsd'|'sunos'|'win32'|'cygwin'|'netbsd';arch:string;tools:{ffmpeg:string;ffprobe:string}}
export interface NativeActionContext {location:'context';editor:EditorSnapshot;clipId:string|null}
export type NativeUiLocation='toolbar'|'inspector'|'context'|'export'|'settings.voice'|'settings.plugins';
/** default is shown in the form and returned by configuration.get until the user changes the value. */
export interface NativeActionIcon {paths:string[];fill?:'none'|'currentColor'}
export interface NativeActionOptions {title?:string;enabled?:boolean;disabledReason?:string;order?:number;icon?:NativeActionIcon|null}
export interface NativeActionRegistration extends Disposable {update(patch:NativeActionOptions):Promise<boolean>}
export type NativeInspectorProperty="opacity"|"transform.scale"|"transform.scaleX"|"transform.scaleY"|"transform.uniform"|"transform.x"|"transform.y"|"transform.rot"|"audio.volume"|"audio.muted"|"audio.fadeIn_sec"|"audio.fadeOut_sec"|"text.content"|"text.style.font"|"text.style.size"|"text.style.bold"|"text.style.italic"|"text.style.underline"|"text.style.uppercase"|"text.style.color"|"text.style.align"|"text.style.letterSpacing"|"text.style.lineHeight"|"text.style.maxWidth"|"text.style.x"|"text.style.y"|"text.style.rotation"|"text.style.opacity"|"text.style.stroke.width"|"text.style.stroke.color"|"text.style.shadow.on"|"text.style.shadow.color"|"text.style.shadow.blur"|"text.style.shadow.x"|"text.style.shadow.y"|"text.style.shadow.opacity"|"text.style.bg.on"|"text.style.bg.color"|"text.style.bg.opacity"|"text.style.bg.radius"|"text.style.bg.padding"|"text.style.bg.mode";
export interface NativeInspectorField {key:string;label:string;property:NativeInspectorProperty;type?:'number'|'range'|'boolean'|'select'|'string'|'color';min?:number;max?:number;step?:number;options?:{label:string;value:string}[];description?:string;readOnly?:boolean;measuredWords?:'reject'|'invalidate'}
export interface NativeInspectorRegistration {id:string;title:string;fields:NativeInspectorField[];lanes?:('video'|'overlay'|'audio'|'text')[];order?:number}
export interface NativeSettingField {key:string;label:string;type:'string'|'secret'|'number'|'boolean'|'select';description?:string;default?:string|number|boolean;min?:number;max?:number;step?:number;options?:{label:string;value:string}[]}
/** Consistency anchor for complete document inspection, independent of playback/selection. */
export interface InspectionScope {documentId:string;projectRevision:number}
export type InspectionScalar=string|number|boolean|null;
/** Expand nested data with workspace.readValue, rather than receiving unbounded JSON. */
export interface InspectionReference {ref:string;type:'object'|'array'|'string';size:number}
export type InspectionValue=InspectionScalar|InspectionReference;
export type InspectionLane='video'|'overlay'|'audio'|'text'|'effect';
export interface InspectionProject {kind:'project';id:string;properties:InspectionReference}
export interface InspectionTrack {kind:'track';id:string;lane:InspectionLane;layer:number;name:InspectionValue;locked:boolean;hidden:boolean;muted:boolean;solo:boolean}
export interface InspectionClip {kind:'clip';id:string;trackId:string;lane:InspectionLane;start_sec:number;end_sec:number;gap:boolean;mediaId:string|null;main?:{index:number;transition:boolean;overlap_sec:number};link?:{groupId:string;partnerId:string|null;members_total:number};properties:InspectionReference}
export interface InspectionMedia {kind:'media';id:string;properties:InspectionReference}
export interface InspectionMarker {kind:'marker';id:string;time_sec:number|null;label:InspectionValue;properties:InspectionReference}
export interface InspectionRows {project:InspectionProject;tracks:InspectionTrack;clips:InspectionClip;media:InspectionMedia;markers:InspectionMarker}
export type InspectionSection=keyof InspectionRows;
export type InspectionRequest<S extends InspectionSection>=Partial<InspectionScope>&{section:S;cursor?:number;limit?:number;lane?:S extends 'clips'|'tracks'?InspectionLane:never;trackId?:S extends 'clips'?string:never;ids?:S extends 'clips'|'media'|'markers'?string[]:never;sourceIds?:S extends 'clips'|'media'?string[]:never};
export type InspectionPage<S extends InspectionSection>=InspectionScope&{section:S;total:number;next:number|null;items:InspectionRows[S][]};
export interface InspectionValueRequest extends InspectionScope {ref:string;path?:(string|number)[];cursor?:number;limit?:number}
export type InspectionValuePage=InspectionScope&(
 {kind:'string';total:number;next:number|null;text:string}|
 {kind:'array';total:number;next:number|null;items:InspectionValue[]}|
 {kind:'object';total:number;next:number|null;entries:{key:string|InspectionReference;value:InspectionValue}[]}|
 {kind:'scalar';value:InspectionScalar}
);

export interface ExtensionView extends Disposable {dispose():Promise<void>;postMessage(value:unknown):Promise<boolean>;reveal():Promise<boolean>;onMessage(callback:(value:unknown,context:{signal:AbortSignal})=>void|Promise<void>):Disposable;onDidClose(callback:(event:{id:string;error:string})=>void|Promise<void>):Disposable}
export interface ExtensionViewInfo {apiVersion:1;id:string;title:string;extensionId:string;theme:Record<'background'|'surface'|'text'|'muted'|'accent'|'border',string>}
/** Available in a view renderer, which has no Node or application IPC bridge. */
export interface ExtensionViewClient {getInfo():Promise<ExtensionViewInfo>;postMessage(value:unknown):Promise<boolean>;onMessage(callback:(value:unknown)=>void):()=>void;onThemeChanged(callback:(theme:ExtensionViewInfo['theme'])=>void):()=>void}
declare global {interface Window {clipcraftView:ExtensionViewClient}}
export type DocumentHookName='project.validateSave'|'project.willSave'|'export.validate'|'export.willRender';
export interface DocumentHookContext {operationId:string;kind:'save'|'export';phase:'validate'|'prepare';destination?:{path:string;saveAs?:boolean;review?:boolean};document:{documentId:string;name?:string;width:number;height:number;fps:number;duration_sec:number;export_duration_sec?:number}}
export interface HookOptions {timeoutMs?:number}
export interface HookControl {signal:AbortSignal}
export type DocumentHookResult=void|{cancel:string};
export interface ExtensionExportOptions {documentId?:string;name?:string;file_path?:string;overwrite?:boolean;showCompletion?:boolean;range?:{start_sec:number;end_sec:number};quality?:'low'|'medium'|'high'|'ultra';codec?:'h264'|'h265';resolution?:0|2160|1440|1080|720|480;fps?:0|24|25|30|50|60;audio_kbps?:96|128|192|256|320;encoder_preset?:'ultrafast'|'superfast'|'veryfast'|'faster'|'fast'|'medium'|'slow'|'slower'|'veryslow';crf?:number;bitrate_mbps?:number}
export interface ExtensionExportProgress {progress:number;phase?:string;stage?:string;phaseProgress?:number;elapsedSeconds?:number;remainingSeconds?:number}
export interface ExtensionExportSettings {preset:'low'|'medium'|'high'|'ultra'|'custom';presetName:string;codecFamily:'h264'|'h265';codecLabel:string;mode:'crf'|'bitrate';crf:number|null;bitrateMbps:number|null;encoderPreset:string;audioKbps:number;resCap:number;fpsChoice:number;outW:number;outH:number;outFps:number;notes:string[]}
export interface ExtensionExportResult {ok:true;file:string;size:number;metadata:{duration_sec:number;width:number;height:number;fps:number;video_codec:string;audio_codec:string|null;has_audio:boolean};elapsed_seconds:number;settings:ExtensionExportSettings;warning?:string}
export interface ExtensionEventSource {readonly kind:'user'|'extension'|'agent'|'system'|'unknown';readonly extensionId?:string;readonly extensionIds?:readonly string[];readonly operationId?:string}
export interface ExtensionEventContext {readonly sequence:number;readonly publication:number;readonly timestamp:number;readonly source:ExtensionEventSource;readonly missed:number;readonly replay?:boolean;readonly documentId?:string;readonly projectRevision?:number;readonly reason?:string;readonly changes?:readonly ('document'|'selection'|'playback'|'cache')[];readonly signal:AbortSignal}
export interface EventSubscription extends Disposable {readonly ready:Promise<void>;dispose():Promise<void>}
export interface ExtensionEventMap {
 'project.opened':EditorSnapshot;
 'project.closed':null;
 'project.changed':InspectionScope&{revision:number};
 'editor.changed':EditorSnapshot;
 'selection.changed':{documentId:string;clipIds:string[];total:number};
 'playback.changed':{documentId:string;time_sec:number;playing:boolean};
 'application.configurationChanged':{keys:readonly string[]};
 'configuration.changed':{extensionId:string;key:string;scope:'settings'|'secrets'|'project';deleted:boolean;documentId?:string};
 'media.previewClosed':{extensionId:string;id:string};
 'extension.changed':{extensionId:string;key:string;generation:string;state:'activating'|'running'|'stopping'|'stopped'};
 'export.changed':{operationId:string;documentId:string;status:'preparing'|'rendering'|'completed'|'canceled'|'failed';progress?:number;phase?:string;phaseProgress?:number;stage?:string;elapsedSeconds?:number;remainingSeconds?:number|null;file?:string;size?:number;metadata?:ExtensionExportResult['metadata'];error?:string;review?:boolean};
}
/** One of the editor's own tools: the set CraftAI uses (text, transitions, filters, colour, keyframes, effects, audio, project settings…). parameters is its JSON schema. */
export interface EditorToolDescription {name:string;description:string;parameters:unknown}
export interface EditorToolCall {name:string;args?:Record<string,unknown>}
/** One result per call that ran, in order. A failed call's result has an error string. */
export interface EditorToolRun {results:Record<string,unknown>[];changed:boolean}
export interface EditorTools {
 /** The tools this editor version offers. Read it at run time; names and schemas follow the application. */
 list():Promise<EditorToolDescription[]>;
 /** Runs 1–64 calls in order as one edit and one Undo step. Every write is validated by the editor.
  * atomic (default true): the first failing call rolls back the whole run and rejects.
  * atomic false: each result is returned; a failed call has an error and later calls still run.
  * Rejects while CraftAI, an outside agent or a drag holds the editor, and inside save/export hooks. */
 run(calls:EditorToolCall|EditorToolCall[],options?:{atomic?:boolean}):Promise<EditorToolRun>;
}
export interface ExtensionContext {
 readonly extension:{id:string;path:string;storagePath:string;generation:string};
 readonly subscriptions:Disposable[];
 host:{read():Promise<ExtensionHostInfo>;capabilities():Promise<HostCapabilities>};
 files:{publish(input:FilePublicationOptions,options?:{signal?:AbortSignal}):Promise<PublishedFile>};
 editor:{read(input?:{clipIds:string[]}):Promise<EditorSnapshot>;apply(transaction:ClipTransaction):Promise<{applied:number}>;tools:EditorTools};
 workspace:{read():Promise<{documentId:string;name:string;width:number;height:number;fps:number;duration_sec:number;export_duration_sec:number}>;inspect<S extends InspectionSection>(input:InspectionRequest<S>):Promise<InspectionPage<S>>;readValue(input:InspectionValueRequest):Promise<InspectionValuePage>};
 media:{/** With bytes, name is required and its suffix selects the format. A picture that does not decode is refused. */import(input:({path:string;bytes?:never}|{path?:never;bytes:Uint8Array})&{name?:string}):Promise<MediaArtifact>;preview(input:{id:string;autoplay?:boolean}):Promise<{shown:true}>;/** handle is the public clip handle for editor.read/apply. The lane defaults to the named track's. A placement that does not fit on that track is refused. */insert(input:MediaPlacement):Promise<{mediaId:string;clipId:string;handle?:string;lane:'video'|'overlay'|'audio'}>;release(input:{id:string}):Promise<boolean>};
 captions:{read(input?:{trackId?:string;cursor?:number;limit?:number}):Promise<{documentId:string;revision:number;total:number;next:number|null;cues:(CaptionCueInput&{id:string|null})[]}>;write(input:CaptionWriteInput):Promise<{written:number;trackId?:string}>};
 markers:{apply(transaction:MarkerTransaction):Promise<{applied:number}>};
 exports:{render(input?:ExtensionExportOptions,options?:{signal?:AbortSignal;onProgress?:(progress:ExtensionExportProgress)=>void}):Promise<ExtensionExportResult>};
 ui:{showOpenDialog(input?:ExtensionOpenDialogOptions,options?:{signal?:AbortSignal}):Promise<string[]|undefined>;showSaveDialog(input?:ExtensionFileDialogOptions,options?:{signal?:AbortSignal}):Promise<string|undefined>;registerShortcut(input:{id:string;title:string;command:string;keys:string[];scope?:'editor'|'app'}):Promise<Disposable>;showMessage(input:ExtensionMessage,options?:{signal?:AbortSignal}):Promise<string|undefined>;registerView(input:{id:string;title:string;entry:string}):Promise<ExtensionView>;registerSettings(input:{id:string;title:string;location:'settings.voice'|'settings.plugins';fields:NativeSettingField[];validate?:string}):Promise<Disposable>;registerAction(input:{id:string;title:string;location:NativeUiLocation;command:string}&NativeActionOptions):Promise<NativeActionRegistration>;registerInspector(input:NativeInspectorRegistration):Promise<Disposable>;registerIntegration(input:{id:string;title:string;point:'ai.engines'|'voice.engines';service:string;order?:number;aliases?:string[]}):Promise<Disposable>};
 commands:{register<T=unknown,R=unknown>(id:string,handler:(input:T,context:{signal:AbortSignal})=>R|Promise<R>):Promise<Disposable>;execute<T=unknown>(id:string,input?:unknown):Promise<T>};
 events:{on<K extends keyof ExtensionEventMap>(name:K,handler:(value:ExtensionEventMap[K],context:ExtensionEventContext)=>void|Promise<void>,options?:{replay?:boolean}):EventSubscription;on<T=unknown>(name:string,handler:(value:T,context:ExtensionEventContext)=>void|Promise<void>,options?:{replay?:boolean}):EventSubscription;emit(name:string,value?:unknown):Promise<{name:string;publication:number}>};
 hooks:{register(name:DocumentHookName,handler:(context:DocumentHookContext,control:HookControl)=>DocumentHookResult|Promise<DocumentHookResult>,options?:HookOptions):Promise<Disposable>};
 services:{register(id:string,implementation:Record<string,(input:any,context:{signal:AbortSignal})=>any>,metadata?:Record<string,unknown>):Promise<Disposable>;registerTyped<const C extends ServiceContract>(id:string,contract:C,implementation:ServiceImplementation<C>,metadata?:Record<string,unknown>):Promise<Disposable>;connect<const C extends ServiceContract>(id:string,contract:C):Promise<ServiceClient<C>>;describe(id:string):Promise<ServiceDescription>;list():Promise<ServiceDescription[]>;call<T=unknown>(id:string,method:string,input?:unknown):Promise<T>;stream<T=unknown>(id:string,method:string,input?:unknown,options?:{signal?:AbortSignal}):AsyncIterable<T>};
 configuration:{get<T=unknown>(key:string,options?:ConfigurationScope):Promise<T|undefined>;update(input:{key:string;value:unknown}&ConfigurationScope):Promise<boolean>};
 secrets:{get(key:string):Promise<string|undefined>;store(input:{key:string;value:string}):Promise<boolean>;delete(key:string):Promise<boolean>};
 /** timeoutMs 1 ms–30 min (default 5 min); stdout and stderr share maxOutputBytes (default 1 MiB, at most 8 MiB); stdin at most 1 MiB. result rejects on timeout, kill, abort or output overflow. */
 processes:{spawn(input:{file:string;args:string[];cwd?:string;env?:Record<string,string>;stdin?:string;timeoutMs?:number;maxOutputBytes?:number;signal?:AbortSignal}):Promise<{id:string;pid:number|null;result:Promise<{code:number|null;signal:string|null;stdout:string;stderr:string}>;kill():Promise<boolean>}>};
 /** Long work belongs here: a command has five minutes, and time spent in a job, a managed process, a dialog, a message, an export, another extension or editor.tools.run does not count against it. timeoutMs 1 s–30 min. */
 jobs:{run<T>(title:string,work:(context:JobContext)=>Promise<T>,options?:{timeoutMs?:number;signal?:AbortSignal}):Promise<T>};
 log(message:string,level?:'info'|'warning'|'error'):Promise<void>;
}
export interface ExtensionModule {activate(context:ExtensionContext):void|Promise<void>;deactivate?():void|Promise<void>}
export declare function defineExtension<T extends ExtensionModule>(extension:T):T;
