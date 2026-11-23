// Bounded source-time operations; identities and resources remain host-owned.
export const AUTOMATION_OPERATIONS=Object.freeze(['set-speed','set-keyframes','set-effect','attach-effect','remove-effect','move-effect']);
export const CURVE_LIMITS=Object.freeze({scale:[.05,4],x:[-2,2],y:[-2,2],rot:[-180,180],opacity:[0,1],volume:[0,2]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names)=>{if(!object(v)||Object.keys(v).some(k=>!names.includes(k))||names.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid automation edit fields.');};
const number=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
const index=v=>Number.isInteger(v)&&v>=0&&v<32;
export function curvePoints(property,points){
 const limits=Object.hasOwn(CURVE_LIMITS,property)?CURVE_LIMITS[property]:null;
 if(!limits||!Array.isArray(points)||points.length>64)throw Error('Choose a supported source-time curve of at most 64 points.');
 let previous=-Infinity;return Array.from(points,p=>{keys(p,['source_sec','value','easing']);if(!number(p.source_sec,0,1e9)||p.source_sec-previous<1e-6||!number(p.value,...limits)||!(property==='volume'?p.easing==='linear':['linear','in','out','inout','continuous'].includes(p.easing)))throw Error('Curve points need increasing source times, bounded values and supported easing.');previous=p.source_sec;return {...p};});
}
export function automationOperation(op,clips,tracks,permissions){
 const required=op.type==='set-speed'?'clips.retime':op.type==='set-keyframes'?'clips.automation':'clips.effects';
 if(!permissions.includes(required))throw Error(`Permission denied: ${required}`);
 const payload=op.type==='set-speed'?['speed','timeline','source','automation']:op.type==='set-keyframes'?['property','points','timebase']:op.type==='attach-effect'?['sourceClipId','beforeIndex','strength','params']:op.type==='set-effect'?['effectIndex','enabled','strength','params']:op.type==='move-effect'?['effectIndex','beforeIndex']:['effectIndex'];
 keys(op,['type','clipId','partnerClipId',...payload]);
 const target=id=>{const c=clips.get(id);if(!c||c.gap||tracks.get(c.trackId)?.locked)throw Error('Automation needs a returned unlocked non-gap clip.');return c;};
 const c=target(op.clipId),lane=c.trackId.split(':')[0];
 if(c.link){
  if(!permissions.includes('clips.links'))throw Error('Permission denied: clips.links for automation pair scope');
  const b=target(op.partnerClipId);
  if(c.link.partnerId!==b.id||b.link?.partnerId!==c.id||c.link.groupId!==b.link.groupId||c.link.members_total!==2)throw Error('Automation needs both handles of a complete pair.');
 }else if(op.partnerClipId!==null)throw Error('Unlinked automation requires partnerClipId:null.');
 if(op.type==='set-speed'){
  if(!['video','overlay','audio'].includes(lane)||!number(op.speed,.25,4)||op.timeline!=='preserve-time'||op.source!=='within-media'||op.automation!=='preserve-source')throw Error('Choose bounded speed with explicit fixed-time, media-bound and source-automation policies.');
 }else if(op.type==='set-keyframes'){
  const limits=Object.hasOwn(CURVE_LIMITS,op.property)?CURVE_LIMITS[op.property]:null;
  if(!limits||!['video','overlay','audio'].includes(lane)||lane==='audio'&&op.property!=='volume'||op.timebase!=='source'||!Array.isArray(op.points)||op.points.length>64)throw Error('Choose a supported source-time curve of at most 64 points.');
  return {...op,points:curvePoints(op.property,op.points)};
 }else{
  if(!['video','overlay','effect'].includes(lane)||lane==='effect'&&op.type!=='set-effect')throw Error('Effect operations need picture clips or a direct free-effect target.');
  if(op.type==='attach-effect'){
   if(target(op.sourceClipId).trackId!=='effect:0'||!index(op.beforeIndex))throw Error('Attach a returned free-effect resource at an explicit slot.');
  }else if(lane==='effect'?op.effectIndex!==null:!index(op.effectIndex))throw Error('Choose an explicit effect slot, or null for a free-effect target.');
  if(op.type==='move-effect'&&!index(op.beforeIndex))throw Error('Choose a bounded effect insertion index.');
  if(['set-effect','attach-effect'].includes(op.type)){
   if(!number(op.strength,0,1)||op.type==='set-effect'&&typeof op.enabled!=='boolean'||!object(op.params)||Object.keys(op.params).length>8||Object.entries(op.params).some(([k,v])=>!/^[a-z][a-z0-9-]{0,63}$/.test(k)||!number(v,-1e6,1e6)))throw Error('Choose bounded effect strength and numeric parameters.');
   return {...op,params:{...op.params}};
  }
 }
 return {...op};
}
