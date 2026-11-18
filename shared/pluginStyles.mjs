// Declarative title/caption styles. Interpret only existing ClipCraft text capabilities.
import {FONT_LIST} from './fontCatalog.mjs';
import {TEXT_EFFECTS,BUBBLES,ANIM_IN,ANIM_OUT,ANIM_LOOP,HIGHLIGHTS} from './textCatalog.mjs';
const fonts=new Set(FONT_LIST.map(f=>f.id));
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=message=>{throw Error('Invalid text style pack: '+message);};
const keys=(v,list)=>{if(!record(v)||Object.keys(v).some(k=>!list.includes(k)))fail('unknown style fields');};
const num=(lo,hi)=>v=>Number.isFinite(v)&&v>=lo&&v<=hi;
const bool=v=>typeof v==='boolean',color=v=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v),one=values=>v=>values.includes(v);
const nested=rules=>value=>{keys(value,Object.keys(rules));if(Object.entries(value).some(([k,v])=>!rules[k](v)))fail('out-of-range nested value');return true;};
const anim=(list)=>nested({id:one(list.map(v=>v.id)),dur:num(0,10),unit:one(['whole','word','char'])});
export const TEXT_STYLE_RULES={
 font:v=>typeof v==='string'&&(fonts.has(v)||/^pack:[a-z][a-z0-9-]{0,63}$/.test(v)),
 size:num(8,600),bold:bool,italic:bool,underline:bool,uppercase:bool,color,color2:color,glowColor:color,
 letterSpacing:num(-10,50),lineHeight:num(.5,3),align:one(['left','center','right']),maxWidth:num(.05,1),x:num(-1,2),y:num(-1,2),rotation:num(-180,180),opacity:num(0,1),
 stroke:nested({width:num(0,24),color}),shadow:nested({on:bool,color,blur:num(0,100),x:num(-100,100),y:num(-100,100),opacity:num(0,1)}),
 bg:nested({on:bool,color,opacity:num(0,1),radius:num(0,100),padding:num(0,2),mode:one(['block','line'])}),
 effect:one(TEXT_EFFECTS.map(v=>v.id)),bubble:one(BUBBLES.map(v=>v.id)),bubbleColor:color,
 highlight:nested({mode:one(HIGHLIGHTS.map(v=>v.id)),color,bg:color}),
 animIn:anim(ANIM_IN),animOut:anim(ANIM_OUT),animLoop:nested({id:one(ANIM_LOOP.map(v=>v.id)),speed:num(.1,10)}),
};
export function validateTextStyle(input,{localFonts=[],runtime=false}={}){
 keys(input,Object.keys(TEXT_STYLE_RULES));if(!Object.keys(input).length)fail('empty style');
 for(const [key,value] of Object.entries(input)){
  if(key==='font'&&runtime&&/^pack-font:[a-f0-9]{64}:[a-z][a-z0-9-]{0,63}$/.test(value))continue;
  if(!TEXT_STYLE_RULES[key](value))fail('unsupported '+key);
  if(key==='font'&&value.startsWith('pack:')&&!localFonts.includes(value.slice(5)))fail('font must reference a font in this package');
 }
 return structuredClone(input);
}
export function validateTextStyleContributions(input,localFonts=[]){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>100)fail('at most 100 text styles');
 const ids=new Set();return input.map(v=>{
  keys(v,['id','name','kind','style','sampleText','duration']);
  if(typeof v.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(v.id)||ids.has(v.id))fail('unique lowercase IDs required');ids.add(v.id);
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>160||/[\u0000-\u001f]/.test(v.name))fail('invalid name');
  if(!['title','caption','lower-third'].includes(v.kind))fail('choose title, caption or lower-third');
  if(v.sampleText!==undefined&&(typeof v.sampleText!=='string'||!v.sampleText.trim()||v.sampleText.length>200||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v.sampleText)))fail('invalid sample text');
  if(v.duration!==undefined&&!num(.1,60)(v.duration))fail('duration must be 0.1 to 60 seconds');
  return {id:v.id,name:v.name,kind:v.kind,style:validateTextStyle(v.style,{localFonts}),...(v.sampleText!==undefined?{sampleText:v.sampleText}:{}),...(v.duration!==undefined?{duration:v.duration}:{})};
 });
}
export function textStylePatch(definition){
 const style=validateTextStyle(definition.style,{runtime:true});
 const font=style.font?.match(/^pack-font:([a-f0-9]{64}):([a-z][a-z0-9-]{0,63})$/);
 return {...style,...(style.font!==undefined?{fontDependency:font?{pluginId:definition.pluginId,digest:font[1],version:definition.version,id:font[2],name:font[2]}:undefined}:{}),template:`pack-style:${definition.digest}:${definition.id}`,packStyle:{pluginId:definition.pluginId,digest:definition.digest,version:definition.version,id:definition.id,name:definition.name}};
}
