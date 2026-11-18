// Static, typed property edits. No arbitrary project or clip patches.
export const PROPERTY_OPERATIONS=Object.freeze(['set-text','set-text-style','set-transform','set-opacity','set-audio']);
export const PROPERTY_FONTS=Object.freeze(['montserrat','poppins','anton','oswald','roboto']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names,required=names)=>{if(!object(v)||Object.keys(v).some(k=>!names.includes(k))||required.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid property edit fields.');};
const number=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
const color=v=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v);
export function propertyOperation(op,clips,tracks,permissions){
 if(!permissions.includes('clips.properties'))throw Error('Permission denied: clips.properties');
 const extra={ 'set-text':['text','measuredWords'],'set-text-style':['style'],'set-transform':['transform'],'set-opacity':['opacity'],'set-audio':['audio','fadePolicy']}[op.type];
 keys(op,['type','clipId','partnerClipId',...extra]);
 const c=clips.get(op.clipId),lane=c?.trackId.split(':')[0];
 if(!c||c.gap||tracks.get(c.trackId)?.locked)throw Error('Property edits need a returned unlocked non-gap target.');
 if(c.link){
  if(!permissions.includes('clips.links'))throw Error('Permission denied: clips.links for property pair scope');
  const b=clips.get(op.partnerClipId);
  if(!b||c.link.partnerId!==b.id||b.link?.partnerId!==c.id||b.link.groupId!==c.link.groupId||c.link.members_total!==2||tracks.get(b.trackId)?.locked)throw Error('Property edits need both unlocked handles of a complete pair.');
 }else if(op.partnerClipId!==null)throw Error('An unlinked property target requires partnerClipId:null.');
 const partial=(v,rules)=>{keys(v,Object.keys(rules),[]);if(!Object.keys(v).length||Object.entries(v).some(([k,x])=>!rules[k](x)))throw Error('Invalid bounded property values.');return {...v};};
 const boolean=v=>typeof v==='boolean';
 if(op.type==='set-text'){
  if(lane!=='text'||typeof op.text!=='string'||!op.text.trim()||op.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(op.text)||!['reject','invalidate'].includes(op.measuredWords))throw Error('Choose bounded plain text and an explicit measured-word policy.');
 }else if(op.type==='set-text-style'){
  if(lane!=='text')throw Error('Text styling needs a text clip.');
  const nested=(value,rules)=>{partial(value,rules);return true;};
  const rules={font:v=>PROPERTY_FONTS.includes(v),size:v=>number(v,8,600),bold:boolean,italic:boolean,underline:boolean,uppercase:boolean,color,align:v=>['left','center','right'].includes(v),letterSpacing:v=>number(v,-10,50),lineHeight:v=>number(v,.5,3),maxWidth:v=>number(v,.05,1),x:v=>number(v,-1,2),y:v=>number(v,-1,2),rotation:v=>number(v,-180,180),opacity:v=>number(v,0,1),stroke:v=>nested(v,{width:x=>number(x,0,24),color}),shadow:v=>nested(v,{on:boolean,color,blur:x=>number(x,0,100),x:x=>number(x,-100,100),y:x=>number(x,-100,100),opacity:x=>number(x,0,1)}),bg:v=>nested(v,{on:boolean,color,opacity:x=>number(x,0,1),radius:x=>number(x,0,100),padding:x=>number(x,0,2),mode:x=>['block','line'].includes(x)})};
  const style=partial(op.style,rules);for(const k of ['stroke','shadow','bg'])if(style[k])style[k]={...style[k]};return {...op,style};
 }else if(op.type==='set-transform'){
  if(!['video','overlay'].includes(lane))throw Error('Picture transforms need a main or overlay picture.');
  return {...op,transform:partial(op.transform,{scale:v=>number(v,.05,4),scaleX:v=>number(v,.05,4),scaleY:v=>number(v,.05,4),uniform:boolean,x:v=>number(v,-2,2),y:v=>number(v,-2,2),rot:v=>number(v,-180,180)})};
 }else if(op.type==='set-opacity'){
  if(!['video','overlay','text'].includes(lane)||!number(op.opacity,0,1))throw Error('Choose opacity in [0,1] for a picture or text clip.');
 }else{
  if(!['video','overlay','audio'].includes(lane)||op.fadePolicy!=='replace-edges')throw Error('Choose explicit audio fade-edge replacement on a sound-capable clip.');
  return {...op,audio:partial(op.audio,{volume:v=>number(v,0,2),muted:boolean,fadeIn_sec:v=>number(v,0,5)&&v<=c.end_sec-c.start_sec+1e-8,fadeOut_sec:v=>number(v,0,5)&&v<=c.end_sec-c.start_sec+1e-8})};
 }
 return {...op};
}
