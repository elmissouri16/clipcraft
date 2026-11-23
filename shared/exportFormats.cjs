// The same container/codec contract is used by the native host and renderer.
const VIDEO_FORMATS=Object.freeze(Object.fromEntries([
 ['mp4','MP4',['h264','h265'],'aac',true],
 ['mov','QuickTime MOV',['h264','h265'],'aac',false],
 ['mkv','Matroska',['h264','h265','vp9'],'aac',false],
 ['webm','WebM',['vp9'],'libopus',false],
].map(([id,name,codecs,audioCodec,cover])=>[id,Object.freeze({id,name,extension:id,muxer:id==='mkv'?'matroska':id,codecs:Object.freeze(codecs),audioCodec,cover})])));
function videoFormat(value='mp4'){if(typeof value!=='string'||!Object.hasOwn(VIDEO_FORMATS,value))throw Error('Choose MP4, MOV, Matroska or WebM');return VIDEO_FORMATS[value];}
function formatFromPath(file){const suffix=typeof file==='string'&&file.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();return suffix&&Object.hasOwn(VIDEO_FORMATS,suffix)?VIDEO_FORMATS[suffix]:null;}
function exportSelection(input={}){
 const inferred=input.file_path===undefined?null:formatFromPath(input.file_path);
 if(input.file_path!==undefined&&!inferred)throw Error('Choose an .mp4, .mov, .mkv or .webm output path');
 const format=videoFormat(input.format===undefined?inferred?.id??'mp4':input.format);
 if(inferred&&inferred.id!==format.id)throw Error('Output path extension must match the selected export format');
 if(input.codec!==undefined&&!format.codecs.includes(input.codec))throw Error('Video codec is incompatible with the selected export format');
 return format;
}
module.exports={VIDEO_FORMATS,videoFormat,formatFromPath,exportSelection};
