import type {CustomTrackTypeDefinition,CustomClipTypeDefinition} from './extension.js';
/** ClipCraft SDK 0.8.0. Trusted Node extensions and declarative creative packs. */
export declare const SDK_VERSION:'0.8.0';
export declare const HOST_API_VERSION:1;
export type ErrorCode='MANIFEST_INVALID'|'INVALID_ARGUMENT';
export declare class PluginError extends Error {readonly code:ErrorCode;constructor(code:ErrorCode,message:string,options?:ErrorOptions);}
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface NumericParameter {id:string;name:string;min:number;max:number;step:number;default:number;integer?:boolean;}
export interface CommandDefinition {id:string;name:string;description?:string;}
export type EffectDefinition={id:string;name:string;parameters?:Omit<NumericParameter,'integer'>[]}&({expression:string;fragment?:never}|{expression?:never;/** GLSL ES 3 function vec4 effect(vec2 uv). Values use {{parameter-id}} uniforms. */fragment:string});
export type TransitionDefinition=EffectDefinition&{duration?:number};
export interface ExportSettings {mode:'crf'|'bitrate';crf:number;bitrateMbps:number;encoderPreset:'ultrafast'|'superfast'|'veryfast'|'faster'|'fast'|'medium'|'slow'|'slower'|'veryslow';audioKbps:96|128|192|256|320;resCap:0|480|720|1080|1440|2160;fps:0|24|25|30|50|60;codec:'h264'|'h265';}
export interface ExportPreset {id:string;name:string;settings:ExportSettings;}
export interface SoundContribution {id:string;name:string;license:string;file:string;kind:'music'|'sfx';}
export interface FontContribution {id:string;name:string;license:string;faces:{file:string;weight:number;style:'normal'|'italic'}[];}
export type PackBuiltinFont='montserrat'|'poppins'|'anton'|'bebas'|'oswald'|'arialblack'|'impact'|'roboto'|'rubik'|'kanit'|'archivoblack'|'barlowcond'|'lilita'|'fredoka'|'bangers'|'luckiest'|'marker'|'righteous'|'pixel'|'showcard'|'cooper'|'stencil'|'broadway'|'titan'|'russo'|'blackops'|'bungee'|'creepster'|'monoton'|'orbitron'|'audiowide'|'chewy'|'playfair'|'georgia'|'garamond'|'times'|'cinzel'|'abril'|'dmserif'|'cormorant'|'pacifico'|'lobster'|'dancing'|'caveat'|'brush'|'segoescript'|'inkfree'|'greatvibes'|'kaushan'|'satisfy'|'shadows'|'sacramento'|'yellowtail'|'cairo'|'tajawal'|'lalezar'|'amiri'|'rakkas'|'majalla'|'tahoma'|'almarai'|'changa'|'elmessiri'|'reemkufi'|'arefruqaa'|'marhey'|'lemonada'|'notokufi'|'notonaskh'|'baloo'|'readex'|'arial'|'segoe'|'segoeblack'|'bahnschrift'|'calibri'|'verdana'|'trebuchet'|'comic'|'consolas';
export interface PackTextStyle extends Omit<ClipTextStyle,'font'> {font?:PackBuiltinFont|`pack:${string}`;color2?:string;glowColor?:string;bubbleColor?:string;effect?:'none'|'glow'|'neon'|'gradient'|'chrome'|'fire'|'ice'|'shadow3d'|'retro'|'double'|'hollow'|'glitch'|'soft'|'emboss';bubble?:'none'|'rounded'|'pill'|'speech'|'thought'|'tag'|'ribbon'|'sticky'|'frame'|'marker'|'underline'|'brackets';highlight?:{mode?:'none'|'color'|'box'|'scale'|'karaoke'|'marker'|'reveal'|'single';color?:string;bg?:string};animIn?:{id?:'none'|'fade'|'pop'|'zoomIn'|'zoomOut'|'slideUp'|'slideDown'|'slideLeft'|'slideRight'|'blurIn'|'drop'|'rotateIn'|'stretch'|'flip'|'typewriter'|'wordPop'|'wordRise'|'waveIn'|'flicker'|'glitchIn'|'slideUpSmooth'|'slideDownSmooth'|'slideLeftSmooth'|'slideRightSmooth'|'slideUpBlur'|'slideDownBlur'|'zoomBlur'|'blurPop'|'softFade'|'elasticPop'|'bounceUp'|'flipSide'|'tiltIn'|'spinIn'|'trackingIn'|'fadeUp'|'fadeDown'|'fadeLeft'|'fadeRight'|'glideUp'|'settleUp'|'scaleTrack'|'growCenter'|'slideRotate'|'charSlideUp'|'charSlideDown'|'charFade'|'decode';dur?:number;unit?:'whole'|'word'|'char'};animOut?:{id?:'none'|'fade'|'pop'|'zoomIn'|'zoomOut'|'slideUp'|'slideDown'|'slideLeft'|'slideRight'|'blurIn'|'rotateIn'|'stretch'|'typewriter'|'wordPop'|'flicker'|'glitchIn'|'slideUpSmooth'|'slideDownSmooth'|'slideLeftSmooth'|'slideRightSmooth'|'slideUpBlur'|'slideDownBlur'|'zoomBlur'|'blurPop'|'softFade'|'elasticPop'|'bounceUp'|'drop'|'flip'|'flipSide'|'tiltIn'|'spinIn'|'trackingIn'|'wordRise'|'waveIn'|'fadeUp'|'fadeDown'|'fadeLeft'|'fadeRight'|'glideUp'|'settleUp'|'scaleTrack'|'growCenter'|'slideRotate'|'charSlideUp'|'charSlideDown'|'charFade'|'decode';dur?:number;unit?:'whole'|'word'|'char'};animLoop?:{id?:'none'|'pulse'|'heartbeat'|'float'|'swing'|'shake'|'wave'|'jelly'|'blink'|'rainbow'|'glitch';speed?:number};}
export interface TextStyleContribution {id:string;name:string;kind:'title'|'caption'|'lower-third';style:PackTextStyle;sampleText?:string;duration?:number;}
export interface LutContribution {id:string;name:string;license:string;file:string;}
export interface PackColorSettings {filterLut?:string;filter?:string;filterIntensity?:number;adjust?:{brightness?:number;contrast?:number;saturation?:number;hue?:number;blur?:number};grade?:Partial<Record<'temp'|'tint'|'saturation'|'exposure'|'contrast'|'highlight'|'shadow'|'whites'|'blacks'|'brilliance'|'sharpen'|'clarity'|'particles'|'fade'|'vignette',number>>&{hsl?:Partial<Record<'red'|'orange'|'yellow'|'green'|'cyan'|'blue'|'purple'|'magenta',{h?:number;s?:number;l?:number}>>;curves?:Partial<Record<'master'|'r'|'g'|'b',[number,number][]>>};lut?:string;lutIntensity?:number;}
export interface ColorPresetContribution {id:string;name:string;settings:PackColorSettings;}
export type PackMotionEase='continuous'|'linear'|'in'|'out'|'inout'|'spring'|'back'|'smooth'|'easeIn'|'easeOut'|'snapIn'|'snapOut'|'overshoot'|{p1x:number;p1y:number;p2x:number;p2y:number};
export type PackMotionInId='fade_in'|'zoom_in'|'zoom_out_in'|'slide_left'|'slide_right'|'slide_up'|'slide_down'|'slide_up_smooth'|'slide_down_smooth'|'slide_left_smooth'|'slide_right_smooth'|'spin_in'|'twist_in'|'pop_in'|'drop_in'|'swing_in'|'shake_in'|'rock_in';
export type PackMotionOutId='fade_out'|'zoom_out'|'zoom_in_out'|'slide_left_out'|'slide_right_out'|'slide_up_out'|'slide_down_out'|'slide_up_smooth_out'|'slide_down_smooth_out'|'slide_left_smooth_out'|'slide_right_smooth_out'|'spin_out'|'twist_out'|'pop_out'|'swing_out'|'shake_out'|'rock_out';
export type PackMotionComboId='pulse'|'heartbeat'|'wobble'|'sway'|'vibrate'|'bounce'|'kenburns'|'pullback'|'drift'|'orbit';
export interface MotionPresetContribution {id:string;name:string;transform?:ClipPictureTransform;opacity?:number;animation?:{in?:{type:PackMotionInId;duration?:number};out?:{type:PackMotionOutId;duration?:number};combo?:{type:PackMotionComboId}};curves?:Partial<Record<'scale'|'x'|'y'|'rot'|'opacity',{at:number;value:number;ease?:PackMotionEase}[]>>;}
export interface CreativeContributions {trackTypes?:CustomTrackTypeDefinition[];clipTypes?:CustomClipTypeDefinition[];motionPresets?:MotionPresetContribution[];luts?:LutContribution[];colorPresets?:ColorPresetContribution[];textStyles?:TextStyleContribution[];sounds?:SoundContribution[];fonts?:FontContribution[];effects?:EffectDefinition[];transitions?:TransitionDefinition[];exportPresets?:ExportPreset[]}
export type PluginManifest={permissions?:[];id:string;name:string;publisher:string;version:string;apiVersion:1;minClipcraftVersion?:string;description?:string;/** Local static PNG, at most 256 KiB and 1024×1024. */icon?:string}&(
 {main:'dist/extension.cjs';activationEvents?:string[];contributes:CreativeContributions&{commands?:CommandDefinition[];views?:{id:string;name:string}[];shortcuts?:{id:string;name:string;command:string;keys:string[];scope?:'editor'|'app'}[]}}|
 {main?:never;activationEvents?:never;contributes:CreativeContributions}
);
export declare function definePlugin<T extends PluginManifest>(manifest:T):T;
export {defineExtension,defineServiceContract,defineHookContract} from './extension.js';
export type * from './extension.js';
export interface Marker {time:number;label:string;}
export type EditorLane='video'|'overlay'|'audio'|'text'|'effect';
export interface EditorTrack {readonly id:string;readonly lane:EditorLane;readonly layer:number;readonly locked:boolean;readonly hidden:boolean;readonly muted:boolean;readonly solo:boolean;}
export interface EditorClip {readonly id:string;readonly trackId:string;readonly start_sec:number;readonly end_sec:number;readonly gap:boolean;readonly link?:{readonly groupId:string;readonly partnerId:string|null;readonly members_total:number};readonly main?:{readonly index:number;readonly transition:boolean;readonly overlap_sec:number};}
export interface EditorSnapshot {
 readonly version:1;readonly documentId:string;readonly revision:number;
 readonly playhead:{readonly time_sec:number;readonly playing:boolean};
 readonly selection:{readonly clipIds:readonly string[];readonly total:number};
 readonly timeline:{readonly tracks:readonly EditorTrack[];readonly tracks_total:number;readonly clips:readonly EditorClip[];readonly clips_total:number;readonly main_total?:number};
}
/** Two returned opaque handles of a complete picture/audio pair. */
export interface LinkedClipPair {clipId:string;partnerClipId:string;}
/** One interval removal; timeline.ripple + editor.read. Explicit free clips need
 * clips.write; complete picture/audio pairs need clips.links. Markers stay put. */
export interface RippleRemoveEdit {type:'ripple-remove';start_sec:number;end_sec:number;clipIds:readonly string[];linkedPairs:readonly LinkedClipPair[];gaps:'preserve-pieces';transitions:'reject';markers:'preserve';}
/** Explicit clip lifecycle uses clips.manage; appending tracks uses tracks.write.
 * Placement needs both; linked variants additionally need clips.links. */
export type LifecycleEdit=
 | {type:'create-track';trackId:string}
 | {type:'create-media';sourceClipId:string;trackId:string;start_sec:number;offset_sec:number;duration_sec:number;gaps:'preserve-time';transitions:'reject'}
 | {type:'create-text';trackId:string;start_sec:number;duration_sec:number;text:string}
 | {type:'create-effect';sourceClipId:string;trackId:string;start_sec:number;duration_sec:number}
 | {type:'duplicate-clip'|'place-clip';clipId:string;trackId:string;start_sec:number;gaps:'preserve-time';transitions:'reject'}
 | {type:'delete-clip';clipId:string;gaps:'preserve-time';transitions:'reject'}
 | {type:'duplicate-linked'|'place-linked';clipId:string;partnerClipId:string;pictureTrackId:string;audioTrackId:string;start_sec:number;gaps:'preserve-time';transitions:'reject'}
 | {type:'delete-linked';clipId:string;partnerClipId:string;gaps:'preserve-time';transitions:'reject'};
/** Static values only. Existing timing and unrelated curves remain unchanged. */
export interface ClipTextStyle {
 font?:'montserrat'|'poppins'|'anton'|'oswald'|'roboto';size?:number;bold?:boolean;italic?:boolean;underline?:boolean;uppercase?:boolean;color?:string;
 align?:'left'|'center'|'right';letterSpacing?:number;lineHeight?:number;maxWidth?:number;x?:number;y?:number;rotation?:number;opacity?:number;
 stroke?:{width?:number;color?:string};shadow?:{on?:boolean;color?:string;blur?:number;x?:number;y?:number;opacity?:number};bg?:{on?:boolean;color?:string;opacity?:number;radius?:number;padding?:number;mode?:'block'|'line'};
}
export interface ClipPictureTransform {scale?:number;scaleX?:number;scaleY?:number;uniform?:boolean;x?:number;y?:number;rot?:number;}
export interface ClipAudioProperties {volume?:number;muted?:boolean;fadeIn_sec?:number;fadeOut_sec?:number;}
/** partnerClipId is null for an unlinked clip; linked scope needs clips.links and both handles. */
export type ClipPropertyEdit={clipId:string;partnerClipId:string|null}&(
 | {type:'set-text';text:string;measuredWords:'reject'|'invalidate'}
 | {type:'set-text-style';style:ClipTextStyle}
 | {type:'set-transform';transform:ClipPictureTransform}
 | {type:'set-opacity';opacity:number}
 | {type:'set-audio';audio:ClipAudioProperties;fadePolicy:'replace-edges'});
/** Source windows change at fixed timeline duration; curves stay in source seconds. */
export type ClipCurveProperty='scale'|'x'|'y'|'rot'|'opacity'|'volume';
export interface ClipCurvePoint {source_sec:number;value:number;easing:'linear'|'in'|'out'|'inout'|'continuous';}
export interface ClipVolumePoint extends ClipCurvePoint {easing:'linear';}
export type ClipAutomationEdit={clipId:string;partnerClipId:string|null}&(
 | {type:'set-speed';speed:number;timeline:'preserve-time';source:'within-media';automation:'preserve-source'}
 | {type:'set-keyframes';property:Exclude<ClipCurveProperty,'volume'>;points:readonly ClipCurvePoint[];timebase:'source'}
 | {type:'set-keyframes';property:'volume';points:readonly ClipVolumePoint[];timebase:'source'}
 | {type:'attach-effect';sourceClipId:string;beforeIndex:number;strength:number;params:Record<string,number>}
 | {type:'set-effect';effectIndex:number|null;enabled:boolean;strength:number;params:Record<string,number>}
 | {type:'remove-effect';effectIndex:number}
 | {type:'move-effect';effectIndex:number;beforeIndex:number});
/** Linked split/trim use picture times, including audio-initiated calls.
 * reorder-linked requires explicit companions. */
export type ClipEdit=ClipAutomationEdit|ClipPropertyEdit|LifecycleEdit|RippleRemoveEdit|{type:'reorder-linked';clipId:string;partnerClipId:string;beforeClipId:string|null;companions:readonly LinkedClipPair[];gaps:'preserve';transitions:'reject'|'clear-boundaries'}|{type:'link'|'unlink';clipId:string;partnerClipId:string}|{type:'move-linked';clipId:string;partnerClipId:string;start_sec:number;gaps:'preserve-time';transitions:'reject'}|{type:'split-linked';clipId:string;partnerClipId:string;at_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'trim-linked';clipId:string;partnerClipId:string;start_sec:number;end_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'split';clipId:string;at_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'trim-main';clipId:string;start_sec:number;end_sec:number;gaps:'preserve-time';transitions:'reject'|'preserve-overlap'}|{type:'reorder';clipId:string;beforeClipId:string|null;gaps:'preserve';transitions:'reject'|'clear-boundaries'}|{type:'move';clipId:string;start_sec:number}|{type:'trim';clipId:string;start_sec:number;end_sec:number};
export interface ClipTransaction {documentId:string;revision:number;operations:readonly ClipEdit[];}
