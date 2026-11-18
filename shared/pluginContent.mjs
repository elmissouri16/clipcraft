import {validatePackCube} from './pluginColor.mjs';
import {validatePluginIcon,PLUGIN_ICON_LIMIT} from './pluginIcon.mjs';
// Data-only creative packs. Paths are deliberately flat beneath assets/.
export const CONTENT_LIMITS = Object.freeze({ files:64, icon:PLUGIN_ICON_LIMIT, sound:32*1024*1024, font:8*1024*1024, lut:16*1024*1024, total:128*1024*1024, archive:64*1024*1024 });
const fail = message => { throw Error(`Invalid content pack: ${message}`); };
const text = (v, max=160) => { if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/.test(v))fail('expected plain text');return v; };
const license = value => {if(typeof value!=='string'||!value.trim()||value.length>8000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('license must contain readable terms (at most 8000 characters)');return value;};
const keys = (v, allowed) => { if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('unsupported contribution fields'); };
export function contentPath(file) {
 if(typeof file!=='string'||!/^assets\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(wav|mp3|ogg|woff2|ttf|otf|cube)$/.test(file))fail('asset must be assets/<name> with a supported audio/font extension');
 return file;
}
export function contentContributions(input) {
 const validate = (kind, allowed, convert) => {
  const values=input[kind]??[];
  if(!Array.isArray(values)||values.length>64)fail('at most 64 contributions per kind');
  const ids=new Set();return values.map(v=>{keys(v,allowed);if(typeof v.id!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(v.id)||ids.has(v.id))fail('IDs must be unique lowercase names');ids.add(v.id);return {id:v.id,name:text(v.name),license:license(v.license),...convert(v)};});
 };
 const sounds=validate('sounds',['id','name','license','file','kind'],v=>{contentPath(v.file);if(!/\.(wav|mp3|ogg)$/.test(v.file)||!['music','sfx'].includes(v.kind))fail('sounds require WAV, MP3 or OGG and kind music or sfx');return {file:v.file,kind:v.kind};});
 const luts=validate('luts',['id','name','license','file'],v=>{contentPath(v.file);if(!v.file.endsWith('.cube'))fail('LUTs require .cube files');return {file:v.file};});
 const fonts=validate('fonts',['id','name','license','faces'],v=>{
  if(!Array.isArray(v.faces)||!v.faces.length||v.faces.length>16)fail('fonts need 1 to 16 faces');
  const styles=new Set();return {faces:v.faces.map(f=>{keys(f,['file','weight','style']);contentPath(f.file);if(!/\.(woff2|ttf|otf)$/.test(f.file)||!Number.isInteger(f.weight)||f.weight<100||f.weight>900||!['normal','italic'].includes(f.style)||styles.has(`${f.weight}/${f.style}`))fail('font faces need unique weights/styles and WOFF2/TTF/OTF files');styles.add(`${f.weight}/${f.style}`);return {...f};})};
 });
 const assets=contentAssets({contributes:{sounds,fonts,luts}});if(assets.size>CONTENT_LIMITS.files)fail('at most 64 asset files');
 return {...(luts.length?{luts}:{}),...(sounds.length?{sounds}:{}),...(fonts.length?{fonts}:{})};
}
export function contentAssets(manifest) {
 const assets=new Map(),contributes=manifest.contributes||{};
 if(manifest.icon)assets.set(manifest.icon,'icon');
 for(const lut of contributes.luts||[])assets.set(lut.file,'lut');
 for(const s of contributes.sounds||[])assets.set(s.file,'sound');
 for(const f of contributes.fonts||[])for(const face of f.faces)assets.set(face.file,'font');
 return assets;
}
// Structural checks before a decoder ever sees bytes. The native/browser decoder is still authoritative.
export function validateContentBytes(kind, input, filename) {
 const b=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength),tag=(at,n)=>String.fromCharCode(...b.subarray(at,at+n));
 if(!b.length||b.length>CONTENT_LIMITS[kind])fail('asset exceeds size limit');
 const extension=filename?.split('.').at(-1);
 if(kind==='icon'){if(b.length>PLUGIN_ICON_LIMIT)fail('icon exceeds 256 KiB');validatePluginIcon(b);
 }else if(kind==='lut'){validatePackCube(new TextDecoder('utf-8',{fatal:true}).decode(b));
 }else if(kind==='font'){
  const woff=tag(0,4)==='wOF2';
  if(extension&&!(woff?extension==='woff2':tag(0,4)==='OTTO'?extension==='otf':extension==='ttf'))fail('font bytes do not match extension');
  if(woff){
   if(b.length<48||v.getUint32(8)!==b.length||!v.getUint16(12)||v.getUint16(14)!==0||v.getUint32(16)>32*1024*1024||v.getUint32(20)>b.length-48)fail('invalid WOFF2 header');
  }else{
   if(b.length<12||!['\x00\x01\x00\x00','true','OTTO'].includes(tag(0,4)))fail('invalid TTF/OTF signature');
   const count=v.getUint16(4);if(!count||count>256||12+16*count>b.length)fail('invalid font table directory');
   const tables=new Set();for(let at=12;at<12+16*count;at+=16){const name=tag(at,4),offset=v.getUint32(at+8),length=v.getUint32(at+12);if(tables.has(name)||offset<12+16*count||offset>b.length||length>b.length-offset)fail('invalid or truncated font table');tables.add(name);}
   if(!['head','name','cmap'].every(t=>tables.has(t)))fail('font lacks required tables');
  }
 }else if(kind==='sound'&&(extension==='mp3'||(!extension&&(tag(0,3)==='ID3'||b[0]===255)))){
  let at=0;if(tag(0,3)==='ID3'){if(b.length<10||![2,3,4].includes(b[3])||[...b.subarray(6,10)].some(v=>v>127))fail('invalid ID3 tag');at=10+b[6]*2097152+b[7]*16384+b[8]*128+b[9]+(b[3]===4&&(b[5]&16)?10:0);}
  // Require a real MPEG audio frame after any bounded metadata, not a filename alone.
  if(at+4>b.length||b[at]!==255||(b[at+1]&224)!==224||((b[at+1]>>3)&3)===1||((b[at+1]>>1)&3)!==1||![1,2,3,4,5,6,7,8,9,10,11,12,13,14].includes(b[at+2]>>4)||((b[at+2]>>2)&3)===3)fail('invalid MP3 frame header');
 }else if(kind==='sound'&&(extension==='ogg'||(!extension&&tag(0,4)==='OggS'))){
  let at=0,pages=0,serial,sequence;const packet=[];let firstComplete=false;
  while(at<b.length){if(at+27>b.length||tag(at,4)!=='OggS'||b[at+4]!==0)fail('invalid OGG page');const n=b[at+26],header=at+27+n;if(header>b.length)fail('truncated OGG lacing');let total=0;for(let i=0;i<n;i++)total+=b[at+27+i];if(header+total>b.length)fail('truncated OGG payload');const currentSerial=v.getUint32(at+14,true),currentSequence=v.getUint32(at+18,true);if(!pages){if(!(b[at+5]&2)||b[at+5]&1||currentSequence!==0)fail('OGG must start with an audio stream');serial=currentSerial;}else if(currentSerial!==serial||currentSequence!==sequence+1)fail('chained/multiplexed OGG is unsupported');sequence=currentSequence;
   if(!firstComplete){let pos=header;for(let i=0;i<n;i++){const len=b[at+27+i];if(packet.length+len>512)fail('OGG audio identification is too large');packet.push(...b.subarray(pos,pos+len));pos+=len;if(len<255){firstComplete=true;break;}}}
   pages++;at=header+total;
  }
  const head=String.fromCharCode(...packet);if(!pages||!firstComplete||!(head.startsWith('\x01vorbis')||head.startsWith('OpusHead')))fail('OGG must contain Vorbis or Opus audio');
 }else{
  if(kind!=='sound'||extension&&extension!=='wav')fail('unsupported content format');
  if(b.length<44||tag(0,4)!=='RIFF'||tag(8,4)!=='WAVE'||v.getUint32(4,true)!==b.length-8)fail('invalid WAV header');
  let format=false,data=false,channels,rate,bits,align;
  let at=12;for(;at+8<=b.length;){const size=v.getUint32(at+4,true),end=at+8+size;if(end>b.length)fail('truncated WAV chunk');
   if(tag(at,4)==='fmt '){if(format||size<16||v.getUint16(at+8,true)!==1)fail('WAV must contain PCM audio');format=true;channels=v.getUint16(at+10,true);rate=v.getUint32(at+12,true);align=v.getUint16(at+20,true);bits=v.getUint16(at+22,true);if(![1,2].includes(channels)||rate<8000||rate>192000||![8,16,24,32].includes(bits)||align!==channels*bits/8||v.getUint32(at+16,true)!==rate*align)fail('unsupported PCM format');}
   if(tag(at,4)==='data'){if(!format||data||!size||size%align)fail('invalid PCM data');data=true;}
   at=end+(size%2);if(at>b.length)fail('missing WAV padding');
  }
  if(!format||!data||at!==b.length)fail('WAV must contain complete PCM chunks');
 }
 return true;
}
