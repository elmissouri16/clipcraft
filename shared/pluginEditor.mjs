// API 1 optional read-only editor projection. No project model or platform imports.
export const EDITOR_LIMITS=Object.freeze({clips:256,tracks:128,selection:64});
export const EDITOR_LANES=Object.freeze(['video','overlay','audio','text','effect']);
const keys=(v,names,optional=[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>![...names,...optional].includes(k))||names.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid editor context fields.');};
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e6;
const time=v=>Number.isFinite(v)&&v>=0&&v<=1e9;
const handle=v=>typeof v==='string'&&/^c-[1-9][0-9]{0,14}$/.test(v);
export function editorSnapshot(value){
 keys(value,['version','documentId','revision','playhead','selection','timeline']);
 if(value.version!==1||typeof value.documentId!=='string'||!/^d-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.documentId)||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('Invalid editor context version or scope.');
 keys(value.playhead,['time_sec','playing']);if(!time(value.playhead.time_sec)||typeof value.playhead.playing!=='boolean')throw Error('Invalid editor playhead.');
 const s=value.selection,t=value.timeline;keys(s,['clipIds','total']);keys(t,['tracks','tracks_total','clips','clips_total'],['main_total']);
 if(!Array.isArray(s.clipIds)||s.clipIds.length>EDITOR_LIMITS.selection||!count(s.total)||s.total<s.clipIds.length||!Array.isArray(t.tracks)||t.tracks.length>EDITOR_LIMITS.tracks||!count(t.tracks_total)||t.tracks_total<t.tracks.length||!Array.isArray(t.clips)||t.clips.length>EDITOR_LIMITS.clips||!count(t.clips_total)||t.clips_total<t.clips.length||s.total>t.clips_total)throw Error('Invalid editor context limits.');
 if(t.main_total!==undefined&&(!count(t.main_total)||t.main_total>t.clips_total))throw Error('Invalid main sequence total.');
 const trackIds=new Set(),clipIds=new Set(),mainIndices=new Set();
 const tracks=t.tracks.map(track=>{
  keys(track,['id','lane','layer','locked','hidden','muted','solo']);
  if(!EDITOR_LANES.includes(track.lane)||!count(track.layer)||track.id!==`${track.lane}:${track.layer}`||trackIds.has(track.id)||!['locked','hidden','muted','solo'].every(k=>typeof track[k]==='boolean')||(['video','effect'].includes(track.lane)&&track.layer!==0))throw Error('Invalid editor track.');
  trackIds.add(track.id);return {...track};
 });
 const clips=t.clips.map(clip=>{
  keys(clip,['id','trackId','start_sec','end_sec','gap'],['main','link']);
  if(!handle(clip.id)||clipIds.has(clip.id)||!trackIds.has(clip.trackId)||!time(clip.start_sec)||!time(clip.end_sec)||clip.end_sec<clip.start_sec||typeof clip.gap!=='boolean')throw Error('Invalid editor clip.');
  if(clip.main!==undefined){
   keys(clip.main,['index','transition','overlap_sec']);const m=clip.main;
   if(clip.trackId!=='video:0'||t.main_total===undefined||!count(m.index)||m.index>=t.main_total||mainIndices.has(m.index)||typeof m.transition!=='boolean'||!time(m.overlap_sec)||m.overlap_sec>clip.end_sec-clip.start_sec+1e-8||(!m.transition||m.index===0)&&m.overlap_sec!==0)throw Error('Invalid main sequence metadata.');
   mainIndices.add(m.index);
  }
  if(clip.link!==undefined){keys(clip.link,['groupId','partnerId','members_total']);const l=clip.link;if(typeof l.groupId!=='string'||!/^l-[1-9][0-9]{0,14}$/.test(l.groupId)||!count(l.members_total)||l.members_total<1||l.partnerId!==null&&(!handle(l.partnerId)||l.partnerId===clip.id||l.members_total!==2))throw Error('Invalid editor link metadata.');}
  clipIds.add(clip.id);return {...clip,...(clip.main?{main:{...clip.main}}:{}),...(clip.link?{link:{...clip.link}}:{})};
 });
 const byId=new Map(clips.map(c=>[c.id,c])),groups=new Map();for(const c of clips)if(c.link){const l=c.link,seen=groups.get(l.groupId)||[];if(seen.some(v=>v.link.members_total!==l.members_total)||seen.length>=l.members_total)throw Error('Inconsistent editor link group.');seen.push(c);groups.set(l.groupId,seen);if(l.partnerId!==null){const other=byId.get(l.partnerId),a=c.trackId.split(':')[0],b=other?.trackId.split(':')[0];if(!other?.link||other.link.groupId!==l.groupId||other.link.partnerId!==c.id||other.link.members_total!==2||c.gap||other.gap||!((a==='audio'&&['video','overlay'].includes(b))||(b==='audio'&&['video','overlay'].includes(a))))throw Error('Invalid editor link partner.');}}
 if(new Set(s.clipIds).size!==s.clipIds.length||s.clipIds.some(id=>!clipIds.has(id)))throw Error('Invalid editor selection.');
 return {version:1,documentId:value.documentId,revision:value.revision,playhead:{...value.playhead},selection:{clipIds:[...s.clipIds],total:s.total},timeline:{tracks,tracks_total:t.tracks_total,clips,clips_total:t.clips_total,...(t.main_total!==undefined?{main_total:t.main_total}:{})}};
}
export function editorChanges(previous,next){
 const changes=[];
 for(const [name,key] of [['timeline','timeline'],['selection','selection'],['playhead','playhead']])if(!previous||JSON.stringify(previous[key])!==JSON.stringify(next[key]))changes.push(name);
 return changes;
}
