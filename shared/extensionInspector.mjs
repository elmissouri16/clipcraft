// Declarative native controls bind to the same typed operations as editor.apply.
// No extension code runs while the inspector renders or reads a property.
import {PROPERTY_FONTS} from './pluginProperties.mjs';
import {CURVE_LIMITS,curvePoints} from './pluginAutomation.mjs';
const numeric=(min,max,step=.01)=>({type:'number',min,max,step});
const bool={type:'boolean'},colour={type:'color'},choices=options=>({type:'select',options});
const picture=['video','overlay'],sound=[...picture,'audio'],text=['text'];
const definitions={opacity:{...numeric(0,1),lanes:[...picture,'text'],default:1}};
for(const [key,rule,value] of [['scale',numeric(.05,4),1],['scaleX',numeric(.05,4),1],['scaleY',numeric(.05,4),1],['uniform',bool,true],['x',numeric(-2,2),0],['y',numeric(-2,2),0],['rot',numeric(-180,180,1),0]])definitions['transform.'+key]={...rule,lanes:picture,default:value};
for(const [key,rule,value] of [['volume',numeric(0,2),1],['muted',bool,false],['fadeIn_sec',numeric(0,5),0],['fadeOut_sec',numeric(0,5),0]])definitions['audio.'+key]={...rule,lanes:sound,default:value};
definitions['text.content']={type:'string',lanes:text};
const styles={font:choices(PROPERTY_FONTS),size:numeric(8,600,1),bold:bool,italic:bool,underline:bool,uppercase:bool,color:colour,align:choices(['left','center','right']),letterSpacing:numeric(-10,50,.1),lineHeight:numeric(.5,3),maxWidth:numeric(.05,1),x:numeric(-1,2),y:numeric(-1,2),rotation:numeric(-180,180,1),opacity:numeric(0,1),
 'stroke.width':numeric(0,24,.1),'stroke.color':colour,'shadow.on':bool,'shadow.color':colour,'shadow.blur':numeric(0,100,1),'shadow.x':numeric(-100,100,1),'shadow.y':numeric(-100,100,1),'shadow.opacity':numeric(0,1),'bg.on':bool,'bg.color':colour,'bg.opacity':numeric(0,1),'bg.radius':numeric(0,100,1),'bg.padding':numeric(0,2),'bg.mode':choices(['block','line'])};
for(const [key,rule] of Object.entries(styles))definitions['text.style.'+key]={...rule,lanes:text};
export const INSPECTOR_PROPERTIES=Object.freeze(Object.fromEntries(Object.entries(definitions).map(([key,value])=>[key,Object.freeze(value)])));
const advanced={speed:{...numeric(.25,4),lanes:sound,default:1},'effect.enabled':{...bool,lanes:[...picture,'effect']},'effect.strength':{...numeric(0,1),lanes:[...picture,'effect']},'effect.parameter':{...numeric(-1e6,1e6),lanes:[...picture,'effect']}};
for(const [property,[min,max]] of Object.entries(CURVE_LIMITS))advanced['curve.'+property]={type:'curve',min,max,lanes:property==='volume'?sound:picture};
export const inspectorRule=property=>Object.hasOwn(INSPECTOR_PROPERTIES,property)?INSPECTOR_PROPERTIES[property]:Object.hasOwn(advanced,property)?advanced[property]:null;
const label=value=>typeof value==='string'&&value.trim()&&value.length<=160&&!/[\u0000-\u001f]/.test(value);
export function inspectorField(input){
 if(!input||Object.keys(input).some(key=>!['key','label','property','type','min','max','step','options','description','readOnly','measuredWords','effect'].includes(key))||!label(input.label)||typeof input.key!=='string'||!/^[a-z][\w.-]{0,159}$/.test(input.key))throw Error('Invalid inspector field');
 const rule=typeof input.property==='string'?inspectorRule(input.property):null;if(!rule)throw Error('Unsupported inspector property');
 const type=input.type??rule.type;if(type!==rule.type&&!(rule.type==='number'&&type==='range'))throw Error('Inspector control type does not match its property');
 const result={key:input.key,label:input.label,property:input.property,type};
 if(input.property.startsWith('effect.')){
  const effect=input.effect;if(!effect||typeof effect!=='object'||Array.isArray(effect)||Object.keys(effect).some(key=>!['id','index','parameter'].includes(key))||Object.hasOwn(effect,'id')===Object.hasOwn(effect,'index')||effect.id!==undefined&&(typeof effect.id!=='string'||!effect.id.length||effect.id.length>400||/[\s\u0000-\u001f]/.test(effect.id))||Object.hasOwn(effect,'index')&&effect.index!==null&&(!Number.isInteger(effect.index)||effect.index<0||effect.index>31))throw Error('Choose an exact effect id or an explicit slot index');
  if(input.property==='effect.parameter'?(typeof effect.parameter!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(effect.parameter)):effect.parameter!==undefined)throw Error('Name a parameter only for an effect parameter binding');
  result.effect={...effect};
 }else if(input.effect!==undefined)throw Error('Effect selection only applies to effect properties');
 if(input.description!==undefined){if(typeof input.description!=='string'||input.description.length>1000||/[\u0000-\u001f]/.test(input.description))throw Error('Invalid inspector description');result.description=input.description;}
 if(input.readOnly!==undefined){if(typeof input.readOnly!=='boolean')throw Error('Invalid read-only inspector field');result.readOnly=input.readOnly;}
 if(rule.type==='number'){
  result.min=input.min??rule.min;result.max=input.max??rule.max;result.step=input.step??rule.step;
  if(![result.min,result.max,result.step].every(Number.isFinite)||result.min<rule.min||result.max>rule.max||result.min>result.max||result.step<=0)throw Error('Inspector range exceeds its property bounds');
  if(input.property==='effect.parameter'&&input.step===undefined)delete result.step;
 }else if(['min','max','step'].some(key=>input[key]!==undefined))throw Error('Only numeric inspector fields have ranges');
 if(rule.type==='curve'){result.min=rule.min;result.max=rule.max;}
 if(rule.type==='select'){
  result.options=input.options??rule.options.map(value=>({value,label:value}));
  if(!Array.isArray(result.options)||!result.options.length||Array.from(result.options).some(option=>!option||!label(option.label)||!rule.options.includes(option.value))||new Set(result.options.map(option=>option.value)).size!==result.options.length)throw Error('Invalid inspector options');
  result.options=result.options.map(({value,label})=>({value,label}));
 }else if(input.options!==undefined)throw Error('Only select inspector fields have options');
 if(input.property==='text.content'){result.measuredWords=input.measuredWords??'reject';if(!['reject','invalidate'].includes(result.measuredWords))throw Error('Invalid caption-word policy');}
 else if(input.measuredWords!==undefined)throw Error('Caption-word policy only applies to text content');
 return result;
}
export function inspectorValue(field,value,{provisional=false}={}){
 if(field.readOnly)throw Error('Inspector field is read-only');
 const rule=inspectorRule(field.property);if(!rule)throw Error('Unsupported inspector property');
 if(rule.type==='curve')return curvePoints(field.property.slice(6),value);
 if(rule.type==='number'){
  if(!Number.isFinite(value)||value<field.min||value>field.max)throw Error('Inspector value is outside its range');
  const steps=(value-field.min)/field.step;if(!(provisional&&field.property==='effect.parameter')&&Math.abs(steps-Math.round(steps))>Math.min(1e-7,Number.EPSILON*Math.max(1,Math.abs(steps))*8))throw Error('Inspector value does not match its step');
 }else if(rule.type==='boolean'){if(typeof value!=='boolean')throw Error('Inspector field requires a boolean');}
 else if(rule.type==='select'){if(!field.options.some(option=>option.value===value))throw Error('Invalid inspector option');}
 else if(rule.type==='color'){if(typeof value!=='string'||!/^#[a-fA-F0-9]{6}$/.test(value))throw Error('Inspector field requires a six-digit hex colour');}
 else if(typeof value!=='string'||!value.trim()||value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw Error('Inspector field requires bounded plain text');
 return value;
}
export function inspectorRead(field,clip,style={}){
 const property=field.property,rule=inspectorRule(property);
 if(property==='speed')return clip.speed??1;
 if(property.startsWith('curve.')){const key=property.slice(6),points=key==='volume'?clip.volumeKeys:clip.keyframes?.[key];return (points??[]).map(p=>({source_sec:p.t,value:p.v,easing:key==='volume'?'linear':p.e??'linear'}));}
 if(property==='text.content')return clip.text??'';
 if(property.startsWith('text.style.'))return property.slice(11).split('.').reduce((value,key)=>value?.[key],style);
 if(property.startsWith('transform.'))return clip.transform?.[property.slice(10)]??rule.default;
 if(property.startsWith('audio.')){const key={fadeIn_sec:'fadeIn',fadeOut_sec:'fadeOut'}[property.slice(6)]??property.slice(6);return clip[key]??rule.default;}
 return clip[property]??rule.default;
}
export function inspectorBinding(field,clip,{lane,style={},effectDefinition=()=>null,media}={}){
 const rule=inspectorRule(field.property);if(!rule||lane&&!rule.lanes.includes(lane))return null;
 const sound=media?.type==='audio'||media?.hasAudio===true;
 if(media&&(field.property.startsWith('audio.')||field.property==='curve.volume')&&!sound)return null;
 if(field.property==='speed'&&media&&(!['video','audio'].includes(media.type)||media.graphic||clip.enhance?.on))return null;
 if(!field.property.startsWith('effect.'))return {field,value:inspectorRead(field,clip,style)};
 const selector=field.effect,list=clip.effects??[],direct=lane==='effect',index=direct?null:selector.id!==undefined?list.indexOf(selector.id):selector.index;
 const id=direct?clip.fx:index===null?undefined:list[index];if(!id||selector.id!==undefined&&id!==selector.id||direct&&Object.hasOwn(selector,'index')&&selector.index!==null)return null;
 const instance=direct?clip.pluginEffect:clip.pluginEffects?.[id],strength=direct?clip.strength??1:clip.fxStrength?.[id]??1,enabled=!(direct?clip.disabled:strength===0)&&!instance?.disabled;
 const target={id,index,instance,strength,enabled};
 if(field.property==='effect.parameter'){
  const definition=effectDefinition(id),parameter=definition?.parameters.find(parameter=>parameter.id===selector.parameter);
  if(!parameter||!instance||['pluginId','contributionId','version','digest'].some(key=>instance[key]!==definition[key]))return null;
  const min=Math.max(field.min,parameter.min),max=Math.min(field.max,parameter.max);if(min>max)return null;
  return {field:{...field,min,max,step:field.step??parameter.step},value:instance.params?.[parameter.id]??parameter.default,target};
 }
 return {field,value:field.property==='effect.enabled'?enabled:strength,target};
}
export function inspectorOperation(field,value,clipId,partnerClipId,context){
 const binding=context?inspectorBinding(field,context.clip,context):null;
 if(context&&!binding)throw Error('Inspector property is unavailable for this clip');
 field=binding?.field??field;
 value=inspectorValue(field,value);const base={clipId,partnerClipId},property=field.property;
 if(property==='speed')return {...base,type:'set-speed',speed:value,timeline:'preserve-time',source:'within-media',automation:'preserve-source'};
 if(property.startsWith('curve.'))return {...base,type:'set-keyframes',property:property.slice(6),points:value,timebase:'source'};
 if(property.startsWith('effect.')){
  if(!binding?.target)throw Error('Effect binding requires its current native target');
  const {strength,enabled,index}=binding.target;
  return {...base,type:'set-effect',effectIndex:index,enabled:property==='effect.enabled'?value:property==='effect.strength'?value>0:enabled,strength:property==='effect.strength'?value:property==='effect.enabled'&&value&&strength===0?1:strength,params:property==='effect.parameter'?{[field.effect.parameter]:value}:{}};
 }
 if(property==='text.content')return {...base,type:'set-text',text:value,measuredWords:field.measuredWords};
 if(property.startsWith('text.style.')){const keys=property.slice(11).split('.');let style=value;for(const key of keys.reverse())style={[key]:style};return {...base,type:'set-text-style',style};}
 if(property.startsWith('transform.'))return {...base,type:'set-transform',transform:{[property.slice(10)]:value}};
 if(property.startsWith('audio.'))return {...base,type:'set-audio',audio:{[property.slice(6)]:value},fadePolicy:'replace-edges'};
 return {...base,type:'set-opacity',opacity:value};
}
