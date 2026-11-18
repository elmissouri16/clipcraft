// Package identity artwork is local PNG data, never a URL or executable SVG.
export const PLUGIN_ICON_LIMIT=256*1024;
export function pluginIconPath(value){
 if(typeof value!=='string'||!/^assets\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.png$/.test(value))throw Error('Plugin icon must be assets/<name>.png');
 return value;
}
export function validatePluginIcon(input){
 const b=new Uint8Array(input.buffer,input.byteOffset,input.byteLength),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(b.length<45||b.length>PLUGIN_ICON_LIMIT||[137,80,78,71,13,10,26,10].some((n,i)=>b[i]!==n))throw Error('Plugin icon must be a PNG of at most 256 KiB');
 const tag=at=>String.fromCharCode(...b.subarray(at,at+4));
 if(v.getUint32(8)!==13||tag(12)!=='IHDR')throw Error('Invalid PNG icon header');
 const width=v.getUint32(16),height=v.getUint32(20);
 if(!width||!height||width>1024||height>1024)throw Error('Plugin icon dimensions must be from 1 to 1024 pixels');
 let at=8,data=false,end=false;
 while(at+12<=b.length){const size=v.getUint32(at),kind=tag(at+4);if(size>b.length-at-12)throw Error('Truncated PNG icon');if(kind==='acTL')throw Error('Plugin icons must be static PNG images');if(kind==='IDAT')data=true;at+=size+12;if(kind==='IEND'){end=size===0&&at===b.length;break;}}
 if(!data||!end)throw Error('Incomplete PNG icon');
 return {width,height};
}
