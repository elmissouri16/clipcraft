import type {EditorSnapshot,ClipTransaction,PackTextStyle,PackBuiltinFont,JsonValue,ClipPictureTransform} from './index.js';
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
export type CaptionStyle=Omit<PackTextStyle,'font'>&{font?:PackBuiltinFont};
export interface ExtensionInputOptions {title:string;prompt?:string;value?:string;placeholder?:string;password?:boolean;minLength?:number;maxLength?:number;timeoutMs?:number}
export interface ExtensionMessage {message:string;detail?:string;kind?:'info'|'warning'|'error';actions?:{id:string;title:string}[];timeoutMs?:number}
export interface Disposable {dispose():void|Promise<void>}
export interface JobContext {signal:AbortSignal;progress(fraction:number,message?:string):Promise<void>}
export interface MediaArtifact {readonly id:string;readonly name:string;readonly type:'image'|'video'|'audio';readonly duration:number;readonly width:number;readonly height:number;readonly hasAudio:boolean;readonly hasVideo:boolean;readonly bytes:number}
export type MediaSourceKind = 'photo' | 'video' | 'music' | 'sfx' | 'trolls';
export interface MediaSourceDescription {
  kinds: MediaSourceKind[];
  configured?: boolean;
  categories?: Partial<Record<MediaSourceKind, string[]>>;
  attribution?: boolean;
  orientation?: boolean;
  sourceLinks?: boolean;
  notice?: string;
  licenseSummary?: string;
}
export interface MediaSourceSearch {
  kind: MediaSourceKind;
  q?: string;
  categoryId?: string;
  licenses?: 'cc0' | 'attribution';
  orientation?: '' | 'horizontal' | 'vertical';
  page?: number;
}
export interface MediaSourceItem {
  id: string;
  title: string;
  thumb?: string;
  creator?: string;
  license?: string;
  licenseName?: string;
  duration?: number;
  [key: string]: JsonValue | undefined;
}
export interface MediaSourcePage {results: MediaSourceItem[]; total: number; page: number; pages: number}
export type MediaSourceService<T extends MediaSourceItem = MediaSourceItem> = {
  describe(): Promise<MediaSourceDescription>;
  search(input: MediaSourceSearch, control: {signal: AbortSignal}): Promise<MediaSourcePage>;
  preview(input: {item:T}, control: {signal: AbortSignal}): Promise<{path:string}>;
  download(input: {item:T}, control: {signal: AbortSignal}): Promise<{artifact:MediaArtifact; credit:Record<string, string | boolean>}>;
  source?(input: {item:T}, control: {signal: AbortSignal}): Promise<{url:string}>;
};
export interface MediaPlacement {id:string;documentId?:string;lane?:'video'|'overlay'|'audio';trackId?:string;start_sec?:number;index?:number}
export interface CaptionCueInput {text:string;start_sec:number;end_sec:number;style?:CaptionStyle}
export type CaptionWriteInput={documentId:string;revision:number;projectRevision?:number;style?:CaptionStyle;cues:CaptionCueInput[]}&({mode:'append'|'replace';trackId?:string;newTrack?:never}|{mode:'create-track';trackId?:never;newTrack:{name:string;hidden?:boolean;language?:string}});
export type MarkerOperation={type:'add';time_sec:number;label?:string}|{type:'update';id:string;time_sec?:number;label?:string}|{type:'remove';id:string};
export interface MarkerTransaction extends InspectionScope {operations:MarkerOperation[]}
export interface ExtensionFileFilter {name:string;extensions:string[]}
export interface ExtensionFileDialogOptions {title?:string;buttonLabel?:string;defaultPath?:string;filters?:ExtensionFileFilter[]}
export interface ExtensionOpenDialogOptions extends ExtensionFileDialogOptions {kind?:'file'|'directory';multiple?:boolean}
export interface PublishedFile {path:string;bytes:number;sha256:string;atomic:boolean;warning?:string}
export interface FilePublicationOptions {path:string;destination:string;overwrite?:boolean}
export interface ExtensionHostInfo {appVersion:string;apiVersion:1;platform:'aix'|'android'|'darwin'|'freebsd'|'haiku'|'linux'|'openbsd'|'sunos'|'win32'|'cygwin'|'netbsd';arch:string;tools:{ffmpeg:string;ffprobe:string}}
export interface NativeActionContext {location:'context';editor:EditorSnapshot;clipId:string|null}
export type NativeUiLocation='toolbar'|'inspector'|'context'|'export'|'settings.voice'|'settings.plugins'|'menu.project'|'menu.timeline';
/** default is shown in the form and returned by configuration.get until the user changes the value. */
export interface NativeActionIcon {paths:string[];fill?:'none'|'currentColor'}
export interface NativeActionOptions {title?:string;enabled?:boolean;disabledReason?:string;order?:number;icon?:NativeActionIcon|null}
export interface NativeActionRegistration extends Disposable {update(patch:NativeActionOptions):Promise<boolean>}
export interface NativeStatusOptions extends NativeActionOptions {tooltip?:string}
export interface NativeStatusRegistration extends Disposable {update(patch:NativeStatusOptions):Promise<boolean>}
export type ExtensionViewPlacement='workbench'|'left-rail'|'library'|'bottom'|'player-overlay'|'timeline-overlay'|'floating'|'modal';
export interface ExtensionViewDestination {placement:ExtensionViewPlacement;bounds?:{x:number;y:number;width:number;height:number};width?:number;height?:number}
export type NativeInspectorProperty='speed'|`curve.${'scale'|'x'|'y'|'rot'|'opacity'|'volume'}`|'effect.enabled'|'effect.strength'|'effect.parameter'|"opacity"|"transform.scale"|"transform.scaleX"|"transform.scaleY"|"transform.uniform"|"transform.x"|"transform.y"|"transform.rot"|"audio.volume"|"audio.muted"|"audio.fadeIn_sec"|"audio.fadeOut_sec"|"text.content"|"text.style.font"|"text.style.size"|"text.style.bold"|"text.style.italic"|"text.style.underline"|"text.style.uppercase"|"text.style.color"|"text.style.align"|"text.style.letterSpacing"|"text.style.lineHeight"|"text.style.maxWidth"|"text.style.x"|"text.style.y"|"text.style.rotation"|"text.style.opacity"|"text.style.stroke.width"|"text.style.stroke.color"|"text.style.shadow.on"|"text.style.shadow.color"|"text.style.shadow.blur"|"text.style.shadow.x"|"text.style.shadow.y"|"text.style.shadow.opacity"|"text.style.bg.on"|"text.style.bg.color"|"text.style.bg.opacity"|"text.style.bg.radius"|"text.style.bg.padding"|"text.style.bg.mode";
export interface NativeInspectorField {key:string;label:string;property:NativeInspectorProperty;type?:'number'|'range'|'boolean'|'select'|'string'|'color'|'curve';effect?:({id:string;index?:never}|{index:number|null;id?:never})&{parameter?:string};min?:number;max?:number;step?:number;options?:{label:string;value:string}[];description?:string;readOnly?:boolean;measuredWords?:'reject'|'invalidate'}
export interface NativeInspectorRegistration {id:string;title:string;fields:NativeInspectorField[];lanes?:('video'|'overlay'|'audio'|'text'|'effect')[];order?:number}
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

export interface ExtensionView extends Disposable {setPlacement(destination:ExtensionViewDestination):Promise<boolean>;dispose():Promise<void>;postMessage(value:unknown):Promise<boolean>;reveal():Promise<boolean>;onMessage(callback:(value:unknown,context:{signal:AbortSignal})=>void|Promise<void>):Disposable;onDidClose(callback:(event:{id:string;error:string})=>void|Promise<void>):Disposable}
export interface ExtensionViewInfo {apiVersion:1;id:string;title:string;extensionId:string;theme:Record<'background'|'surface'|'text'|'muted'|'accent'|'border',string>}
/** Available in a view renderer, which has no Node or application IPC bridge. */
export interface ExtensionViewClient {getInfo():Promise<ExtensionViewInfo>;postMessage(value:unknown):Promise<boolean>;onMessage(callback:(value:unknown)=>void):()=>void;onThemeChanged(callback:(theme:ExtensionViewInfo['theme'])=>void):()=>void}
declare global {interface Window {clipcraftView:ExtensionViewClient}}
export type DocumentHookName='project.validateSave'|'project.willSave'|'export.validate'|'export.willRender'|'project.validateClose'|'project.willClose'|'project.didOpen'|'project.didCreate'|'project.didClose';
/** Close validation may veto; preparation edits publish atomically before leaving.
 * didOpen/didCreate/didClose observe a private read-only snapshot after transition.
 * Their failure is logged and cannot reverse a completed transition. */
export interface DocumentHookContext {operationId:string;kind:'save'|'export'|'close'|'opened'|'created'|'closed';phase:'validate'|'prepare'|'observe';transition?:{reason:'create'|'open'|'home'|'quit'|'restore'|'import';path?:string};destination?:{path:string;saveAs?:boolean;review?:boolean};document:{documentId:string;name?:string;width:number;height:number;fps:number;duration_sec:number;export_duration_sec?:number}}
export interface HookOptions {timeoutMs?:number;order?:number}
export interface HookControl {signal:AbortSignal}
export type DocumentHookResult=void|{cancel:string};
export interface HookContract {readonly version:number;readonly input:ServiceSchema;readonly output:ServiceSchema}
export declare function defineHookContract<const C extends HookContract>(contract:C):C;
export interface CustomHookControl extends HookControl {runId:string;hookId:string;ownerId:string}
export interface CustomHookPoint<C extends HookContract> extends Disposable {readonly id:string;run(input:InferServiceSchema<C['input']>,options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<{runId:string;results:{extensionId:string;value:InferServiceSchema<C['output']>}[]}>}
export interface ExtensionHooksApi {
 register(name:DocumentHookName,handler:(context:DocumentHookContext,control:HookControl)=>DocumentHookResult|Promise<DocumentHookResult>,options?:HookOptions):Promise<Disposable>;
 register<const C extends HookContract>(name:string,contract:C,handler:(input:InferServiceSchema<C['input']>,control:CustomHookControl)=>InferServiceSchema<C['output']>|Promise<InferServiceSchema<C['output']>>,options?:HookOptions):Promise<Disposable>;
 define<const C extends HookContract>(id:string,contract:C):Promise<CustomHookPoint<C>>;
 list(input?:{cursor?:number;limit?:number;extensionId?:string}):Promise<{items:{id:string;extensionId:string;contract:HookContract}[];total:number;next:number|null}>;
}
export type NativeExportFormat='mp4'|'mov'|'mkv'|'webm';
export interface ExtensionExportOptions {format?:NativeExportFormat;documentId?:string;name?:string;file_path?:string;overwrite?:boolean;showCompletion?:boolean;range?:{start_sec:number;end_sec:number};quality?:'low'|'medium'|'high'|'ultra';codec?:'h264'|'h265'|'vp9';resolution?:0|2160|1440|1080|720|480;fps?:0|24|25|30|50|60;audio_kbps?:96|128|192|256|320;encoder_preset?:'ultrafast'|'superfast'|'veryfast'|'faster'|'fast'|'medium'|'slow'|'slower'|'veryslow';crf?:number;bitrate_mbps?:number}
export interface ExtensionExportProgress {progress:number;phase?:string;stage?:string;phaseProgress?:number;elapsedSeconds?:number;remainingSeconds?:number}
export interface ExtensionExportSettings {format:NativeExportFormat;formatLabel:string;extension:string;available:boolean;audioCodec:'aac'|'opus';preset:'low'|'medium'|'high'|'ultra'|'custom';presetName:string;codecFamily:'h264'|'h265'|'vp9';codecLabel:string;mode:'crf'|'bitrate';crf:number|null;bitrateMbps:number|null;encoderPreset:string;audioKbps:number;resCap:number;fpsChoice:number;outW:number;outH:number;outFps:number;notes:string[]}
export interface ExtensionExportResult {ok:true;file:string;size:number;metadata:{container:string;duration_sec:number;width:number;height:number;fps:number;video_codec:string;audio_codec:string|null;has_audio:boolean};elapsed_seconds:number;settings:ExtensionExportSettings;warning?:string}
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
export interface ProjectStatus {open:boolean;documentId:string|null;name?:string;file:string|null}
export interface ProjectTarget {documentId:string|null}
export type ProcessEncoding = 'utf8' | 'bytes';
export interface ManagedProcessOptions<E extends ProcessEncoding = 'utf8'> {
 file:string; args:string[]; cwd?:string; env?:Record<string,string>;
 stdin?:string|Uint8Array; timeoutMs?:number; maxOutputBytes?:number;
 /** capture (default), stream (bounded unread queue), or both. Overflow terminates the child. */
 output?:'capture'|'stream'|'both'; encoding?:E; signal?:AbortSignal;
}
export interface ManagedProcess<E extends ProcessEncoding = 'utf8'> {
 id:string; pid:number|null;
 result:Promise<{code:number|null;signal:string|null;stdout:E extends 'bytes'?Uint8Array:string;stderr:E extends 'bytes'?Uint8Array:string}>;
 /** One pull consumer; data preserves bytes and each OS stream's order. Break closes only the output subscription. */
 output:AsyncIterable<{stream:'stdout'|'stderr';data:Uint8Array}>;
 kill():Promise<boolean>;
}
export interface ManagedServerOptions<E extends ProcessEncoding = 'utf8'> extends ManagedProcessOptions<E> {
 /** Only loopback HTTP endpoints; redirects refuse. timeoutMs defaults to 10 seconds. */
 ready:{url:string;timeoutMs?:number};
}
export interface RenderingDefinition {id:string;kind:'effect'|'transition';name:string;program:'glsl'|'expression';pluginId:string;digest:string;version:string;preferred:boolean;parameters:{id:string;name:string;min:number;max:number;step:number;default:number}[];duration?:number}
export type CustomDataSchema=
 {type:'null'|'boolean'}|{type:'number'|'integer';minimum?:number;maximum?:number}|{type:'string';minLength?:number;maxLength?:number;enum?:string[]}|{type:'array';items:CustomDataSchema;maxItems?:number}|{type:'object';properties:Record<string,CustomDataSchema>;required?:string[]};
export interface CustomTypeBase {id:string;name:string;schema?:Extract<CustomDataSchema,{type:'object'}>;defaults?:Record<string,JsonValue>;labels?:Record<string,string>}
export interface CustomTrackTypeDefinition extends CustomTypeBase {kind:'visual'|'audio'|'metadata';color?:string;height?:number}
export interface CustomClipTypeDefinition extends CustomTypeBase {trackType:string;render:{kind:'shader';effect:string;parameters?:Record<string,string>}|{kind:'media'|'none'};color?:string;labelField?:string}
export type CustomTypeDescriptor=({category:'track'}&CustomTrackTypeDefinition|{category:'clip'}&CustomClipTypeDefinition)&{typeId:string;pluginId:string;digest:string;version:string;preferred:boolean};
export interface CustomTrack {id:string;typeId:string;name:string;kind:'visual'|'audio'|'metadata';data:Record<string,JsonValue>;hidden:boolean;locked:boolean;muted:boolean;solo:boolean}
export interface CustomClip {id:string;typeId:string;trackId:string;name:string;data:Record<string,JsonValue>;start:number;duration:number;sourceIn:number;speed:number;mediaId?:string;transform?:ClipPictureTransform;opacity:number;disabled:boolean}
export interface CustomClipPatch {name?:string;trackId?:string;start_sec?:number;duration_sec?:number;sourceIn_sec?:number;speed?:number;data?:Record<string,JsonValue>;replaceData?:boolean;transform?:ClipPictureTransform;opacity?:number;disabled?:boolean}
export type CustomTimelineOperation=
 {type:'create-track';id:string;typeId:string;name?:string;data?:Record<string,JsonValue>}|
 {type:'update-track';id:string;patch:Partial<Pick<CustomTrack,'name'|'data'|'hidden'|'locked'|'muted'|'solo'>>&{replaceData?:boolean}}|
 {type:'delete-track';id:string;removeClips?:boolean}|
 {type:'move-track';id:string;beforeId:string|null}|
 ({type:'create-clip';id:string;typeId:string;trackId:string;start_sec:number;duration_sec:number;mediaId?:string}&Omit<CustomClipPatch,'trackId'|'disabled'|'replaceData'>)|
 {type:'update-clip';id:string;patch:CustomClipPatch}|
 {type:'delete-clip';id:string}|
 {type:'duplicate-clip';id:string;newId:string;trackId?:string;start_sec?:number}|
 {type:'split-clip';id:string;newId:string;at_sec:number};
export interface CustomTimelineApi {
 types(input?:{kind?:'track'|'clip';pluginId?:string;cursor?:number;limit?:number}):Promise<{items:CustomTypeDescriptor[];total:number;next:number|null}>;
 read<S extends 'tracks'|'clips'>(input:Partial<InspectionScope>&{section:S;cursor?:number;limit?:number;trackId?:S extends 'clips'?string:never}):Promise<InspectionScope&{section:S;items:(S extends 'tracks'?CustomTrack:CustomClip)[];total:number;next:number|null}>;
 apply(input:InspectionScope&{operations:CustomTimelineOperation[]}):Promise<{applied:number;changed:boolean}>;
}
export interface ExtensionContext {
 readonly extension:{id:string;path:string;storagePath:string;generation:string};
 readonly subscriptions:Disposable[];
 timeline:CustomTimelineApi;
 rendering:{list(input?:{cursor?:number;limit?:number;kind?:'effect'|'transition';pluginId?:string;preferred?:boolean}):Promise<{items:RenderingDefinition[];total:number;next:number|null}>;validate(input:{id:string;params?:Record<string,number>}):Promise<{valid:true;id:string}>};
 host:{read():Promise<ExtensionHostInfo>;capabilities():Promise<HostCapabilities>};
 files:{publish(input:FilePublicationOptions,options?:{signal?:AbortSignal}):Promise<PublishedFile>};
 editor:{undo(input:{documentId:string;projectRevision:number}):Promise<{applied:boolean}>;read(input?:{clipIds:string[]}):Promise<EditorSnapshot>;apply(transaction:ClipTransaction):Promise<{applied:number}>;tools:EditorTools};
 projects:{status():Promise<ProjectStatus>;create(input:ProjectTarget&{format?:string;fps?:number;name?:string}):Promise<ProjectStatus>;open(input:ProjectTarget&{path?:string}):Promise<ProjectStatus|{canceled:true}>;save(input:{documentId:string;path?:string;saveAs?:boolean}):Promise<{saved:true;file:string}|{canceled:true}>;close(input:{documentId:string}):Promise<ProjectStatus>};
 workspace:{read():Promise<{documentId:string;name:string;width:number;height:number;fps:number;duration_sec:number;export_duration_sec:number}>;inspect<S extends InspectionSection>(input:InspectionRequest<S>):Promise<InspectionPage<S>>;readValue(input:InspectionValueRequest):Promise<InspectionValuePage>};
 media:{/** With bytes, name is required and its suffix selects the format. A picture that does not decode is refused. */import(input:({path:string;bytes?:never}|{path?:never;bytes:Uint8Array})&{name?:string}):Promise<MediaArtifact>;preview(input:{id:string;autoplay?:boolean}):Promise<{shown:true}>;/** handle is the public clip handle for editor.read/apply. The lane defaults to the named track's. A placement that does not fit on that track is refused. */insert(input:MediaPlacement):Promise<{mediaId:string;clipId:string;handle?:string;lane:'video'|'overlay'|'audio'}>;release(input:{id:string}):Promise<boolean>};
 captions:{read(input?:{trackId?:string;cursor?:number;limit?:number}):Promise<{documentId:string;revision:number;total:number;next:number|null;cues:(CaptionCueInput&{id:string|null})[]}>;write(input:CaptionWriteInput):Promise<{written:number;trackId?:string}>};
 markers:{apply(transaction:MarkerTransaction):Promise<{applied:number}>};
 exports:{render(input?:ExtensionExportOptions,options?:{signal?:AbortSignal;onProgress?:(progress:ExtensionExportProgress)=>void}):Promise<ExtensionExportResult>};
 ui:{showInput(input:ExtensionInputOptions,options?:{signal?:AbortSignal}):Promise<string|undefined>;registerStatus(input:{id:string;title:string;command?:string;alignment?:'left'|'right'}&NativeStatusOptions):Promise<NativeStatusRegistration>;showOpenDialog(input?:ExtensionOpenDialogOptions,options?:{signal?:AbortSignal}):Promise<string[]|undefined>;showSaveDialog(input?:ExtensionFileDialogOptions,options?:{signal?:AbortSignal}):Promise<string|undefined>;registerShortcut(input:{id:string;title:string;command:string;keys:string[];scope?:'editor'|'app'}):Promise<Disposable>;showMessage(input:ExtensionMessage,options?:{signal?:AbortSignal}):Promise<string|undefined>;registerView(input:{id:string;title:string;entry:string;placement?:ExtensionViewPlacement;bounds?:ExtensionViewDestination['bounds'];width?:number;height?:number;order?:number;icon?:NativeActionIcon}):Promise<ExtensionView>;registerSettings(input:{id:string;title:string;location:'settings.voice'|'settings.plugins';fields:NativeSettingField[];validate?:string}):Promise<Disposable>;registerAction(input:{id:string;title:string;location:NativeUiLocation;command:string}&NativeActionOptions):Promise<NativeActionRegistration>;registerInspector(input:NativeInspectorRegistration):Promise<Disposable>;registerIntegration(input:{id:string;title:string;point:'ai.engines'|'voice.engines'|'media.sources';service:string;order?:number;aliases?:string[]}):Promise<Disposable>};
 commands:{register<T=unknown,R=unknown>(id:string,handler:(input:T,context:{signal:AbortSignal})=>R|Promise<R>):Promise<Disposable>;execute<T=unknown>(id:string,input?:unknown):Promise<T>};
 events:{on<K extends keyof ExtensionEventMap>(name:K,handler:(value:ExtensionEventMap[K],context:ExtensionEventContext)=>void|Promise<void>,options?:{replay?:boolean}):EventSubscription;on<T=unknown>(name:string,handler:(value:T,context:ExtensionEventContext)=>void|Promise<void>,options?:{replay?:boolean}):EventSubscription;emit(name:string,value?:unknown):Promise<{name:string;publication:number}>};
 hooks:ExtensionHooksApi;
 services:{register(id:string,implementation:Record<string,(input:any,context:{signal:AbortSignal})=>any>,metadata?:Record<string,unknown>):Promise<Disposable>;registerTyped<const C extends ServiceContract>(id:string,contract:C,implementation:ServiceImplementation<C>,metadata?:Record<string,unknown>):Promise<Disposable>;connect<const C extends ServiceContract>(id:string,contract:C):Promise<ServiceClient<C>>;describe(id:string):Promise<ServiceDescription>;list():Promise<ServiceDescription[]>;call<T=unknown>(id:string,method:string,input?:unknown):Promise<T>;stream<T=unknown>(id:string,method:string,input?:unknown,options?:{signal?:AbortSignal}):AsyncIterable<T>};
 configuration:{get<T=unknown>(key:string,options?:ConfigurationScope):Promise<T|undefined>;update(input:{key:string;value:unknown}&ConfigurationScope):Promise<boolean>};
 secrets:{get(key:string):Promise<string|undefined>;store(input:{key:string;value:string}):Promise<boolean>;delete(key:string):Promise<boolean>};
 /** timeoutMs 1 ms–30 min (default 5 min); stdout and stderr share maxOutputBytes (default 1 MiB, at most 8 MiB); stdin at most 1 MiB. result rejects on timeout, kill, abort or output overflow. */
 processes:{spawn<E extends ProcessEncoding = 'utf8'>(input:ManagedProcessOptions<E>):Promise<ManagedProcess<E>>;startServer<E extends ProcessEncoding = 'utf8'>(input:ManagedServerOptions<E>):Promise<ManagedProcess<E>&{url:string}>};
 /** Long work belongs here: a command has five minutes, and time spent in a job, a managed process, a dialog, a message, an export, another extension or editor.tools.run does not count against it. timeoutMs 1 s–30 min. */
 jobs:{run<T>(title:string,work:(context:JobContext)=>Promise<T>,options?:{timeoutMs?:number;signal?:AbortSignal}):Promise<T>};
 log(message:string,level?:'info'|'warning'|'error'):Promise<void>;
}
export interface ExtensionModule {activate(context:ExtensionContext):void|Promise<void>;deactivate?():void|Promise<void>}
export declare function defineExtension<T extends ExtensionModule>(extension:T):T;
