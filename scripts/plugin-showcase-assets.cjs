// Original procedural demonstration media. Generated PNG/WAV bytes stay outside the checkout.
const fs=require('node:fs/promises'),zlib=require('node:zlib');
function crc32(data){let c=0xffffffff;for(const v of data){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function pngChunk(name,bytes){const tag=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc32(Buffer.concat([tag,bytes])));return Buffer.concat([head,tag,bytes,tail]);}
async function picture(file,palette){const w=960,h=540,raw=Buffer.alloc((w*3+1)*h),[background,accent,light]=palette;
 for(let y=0;y<h;y++){const offset=y*(w*3+1);for(let x=0;x<w;x++){let color=background.map((n,i)=>n*(.6+.4*x/w)+accent[i]*(y/h)*.2);if((x-685)**2+(y-190)**2<115**2)color=accent;if(x>105&&x<385&&y>100&&y<390)color=light.map(n=>n*.8);if(x>465&&x<570&&y>280&&y<460)color=accent.map(n=>n*.7);if(y>470&&y<477&&x>70&&x<890)color=light;const at=offset+1+x*3;for(let c=0;c<3;c++)raw[at+c]=Math.max(0,Math.min(255,Math.round(color[c])));}}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;await fs.writeFile(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]),{flag:'wx'});return {width:w,height:h};
}
async function sound(file,kind){const rate=32000,duration={sweep:.8,click:.18,chime:1.3}[kind],count=Math.round(rate*duration),b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);let seed=73,filtered=0;
 for(let i=0;i<count;i++){const t=i/rate,p=t/duration;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;filtered=.8*filtered+.2*noise;let value;if(kind==='sweep')value=.5*filtered*Math.sin(Math.PI*p)**2+.045*Math.sin(2*Math.PI*(220*t+900*t*t))*Math.sin(Math.PI*p)**2;else if(kind==='click')value=(.3*Math.sin(2*Math.PI*920*t)+.16*noise)*Math.exp(-t*55)*Math.min(1,t*1800);else value=(.2*Math.sin(2*Math.PI*660*t)+.12*Math.sin(2*Math.PI*990*t)+.06*Math.sin(2*Math.PI*1320*t))*Math.exp(-3*t)*Math.min(1,t*100);value*=Math.min(1,(duration-t)*100);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),44+i*2);}
 await fs.writeFile(file,b,{flag:'wx'});return {duration};
}
module.exports={picture,sound};
