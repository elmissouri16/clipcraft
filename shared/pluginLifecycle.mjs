// Explicit lifecycle proposals. Resource references are returned clip handles,
// never media IDs, file paths, reducer patches or plugin-chosen identities.
export const LIFECYCLE_OPERATIONS=Object.freeze(['create-track','create-media','create-text','create-effect','duplicate-clip','delete-clip','place-clip','duplicate-linked','delete-linked','place-linked']);
const keys=(v,names)=>{if(Object.keys(v).some(k=>!names.includes(k))||names.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid lifecycle operation fields.');};
const time=v=>Number.isFinite(v)&&v>=0&&v<=1e9;
export function lifecycleOperation(op,clips,tracks,permissions,duration){
 const grant=p=>{if(!permissions.includes(p))throw Error(`Permission denied: ${p}`);};
 const target=id=>{const c=clips.get(id);if(!c||c.gap)throw Error('Lifecycle needs a returned non-gap clip handle.');if(tracks.get(c.trackId)?.locked)throw Error('Lifecycle source is locked.');return c;};
 const destination=id=>{if(typeof id!=='string'||!/^(video|overlay|audio|text|effect):(?:0|[1-9][0-9]{0,2})$/.test(id)||Number(id.split(':')[1])>=128||/^(video|effect):/.test(id)&&!id.endsWith(':0'))throw Error('Invalid lifecycle destination track.');if(tracks.get(id)?.locked)throw Error('Lifecycle destination is locked.');return id.split(':')[0];};
 if(op.type==='create-track'){
  grant('tracks.write');keys(op,['type','trackId']);const lane=destination(op.trackId);
  if(!['overlay','audio','text'].includes(lane)||tracks.has(op.trackId))throw Error('Create an explicit new free-track layer.');
  return {...op};
 }
 grant('clips.manage');
 const pair=op.type.endsWith('-linked'),deleting=op.type.startsWith('delete-'),placing=op.type.startsWith('place-');
 const names=op.type==='create-text'?['type','trackId','start_sec','duration_sec','text']:op.type==='create-media'?['type','sourceClipId','trackId','start_sec','offset_sec','duration_sec','gaps','transitions']:op.type==='create-effect'?['type','sourceClipId','trackId','start_sec','duration_sec']:pair?['type','clipId','partnerClipId',...(deleting?[]:['pictureTrackId','audioTrackId','start_sec']),'gaps','transitions']:['type','clipId',...(deleting?[]:['trackId','start_sec']),'gaps','transitions'];
 keys(op,names);
 if(names.includes('gaps')&&(op.gaps!=='preserve-time'||op.transitions!=='reject'))throw Error('Lifecycle requires preserve-time/reject policies.');
 if(!deleting&&(!time(op.start_sec)||op.start_sec>duration))throw Error('Lifecycle placement must stay inside the project.');
 if(placing)grant('tracks.write');
 if(pair){
  grant('clips.links');const a=target(op.clipId),b=target(op.partnerClipId);
  if(!a.link||a.link.partnerId!==b.id||b.link?.partnerId!==a.id||a.link.groupId!==b.link.groupId||a.link.members_total!==2)throw Error('Lifecycle needs both handles of one complete pair.');
  const pic=a.trackId.startsWith('audio:')?b:a;
  if(!deleting&&(destination(op.pictureTrackId)!==pic.trackId.split(':')[0]||destination(op.audioTrackId)!=='audio'))throw Error('Linked lifecycle destinations must keep their lanes.');
 }else if(op.type==='create-text'){
  if(destination(op.trackId)!=='text'||typeof op.text!=='string'||!op.text.trim()||op.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(op.text))throw Error('Create bounded plain text on a text layer.');
 }else if(op.type==='create-media'){
  const c=target(op.sourceClipId),lane=c.trackId.split(':')[0],dest=destination(op.trackId);
  if(!['video','overlay','audio'].includes(lane)||!(lane==='audio'?dest==='audio':['video','overlay'].includes(dest))||!time(op.offset_sec)||op.offset_sec+op.duration_sec>c.end_sec-c.start_sec+1e-8)throw Error('Create media from a bounded returned source window on a compatible lane.');
 }else if(op.type==='create-effect'){
  if(!target(op.sourceClipId).trackId.startsWith('effect:')||destination(op.trackId)!=='effect')throw Error('Create an effect from a returned effect resource.');
 }else{
  const c=target(op.clipId);if(c.link)throw Error('Linked lifecycle needs an explicit pair operation.');
  if(!deleting&&destination(op.trackId)!==c.trackId.split(':')[0])throw Error('Lifecycle placement must keep the source lane.');
 }
 if(names.includes('duration_sec')&&(!time(op.duration_sec)||op.duration_sec<.1-1e-9||op.start_sec+op.duration_sec>duration+1e-8))throw Error('Create at least 0.1 seconds inside the captured project.');
 return {...op};
}
