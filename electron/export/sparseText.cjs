// Static text holds use timestamped PNG surfaces instead of pumping a full raw
// frame through an encoder for every unchanged/transparent timeline frame.
// Animated/dense layers keep TextStream's raw delta transport.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('../system/childProcesses.cjs');
const {deflate}=require('node:zlib'),{promisify}=require('node:util');
const compress=promisify(deflate);
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
const chunk=(name,bytes)=>{
  const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);
  let crc=0xffffffff;for(const byte of out.subarray(4,-4))crc=crcTable[(crc^byte)&255]^(crc>>>8);
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
};
async function rgbaPng(pixels,width,height) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const row=width*4,scanlines=Buffer.alloc((row+1)*height);
  for(let y=0;y<height;y++)pixels.copy(scanlines,y*(row+1)+1,y*row,(y+1)*row);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',await compress(scanlines,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
class SparseTextStream {
  constructor(ffmpegPath,dir,width,height,fps) {
    this.ffmpegPath=ffmpegPath;this.dir=dir;this.width=width;this.height=height;this.fps=fps;
    this.file=path.join(dir,'text.mov');this.size=width*height*4;this.blank=Buffer.alloc(this.size);this.last=this.blank;
    this.count=0;this.surfaces=0;this.entries=[];this.blankFile=null;this.lastFile=null;this.proc=null;this.canceled=false;
  }
  async surface(pixels,blank=false) {
    if(blank&&this.blankFile)return this.blankFile;
    const name=`surface-${this.surfaces++}.png`,file=path.join(this.dir,name);
    await fs.promises.writeFile(file,await rgbaPng(pixels,this.width,this.height));
    if(this.canceled)throw new Error('Text layer canceled.');
    if(blank)this.blankFile=name;return name;
  }
  hold(file,count) {
    if(!Number.isSafeInteger(count)||count<1)throw new Error('Text layer: bad frame run');
    const previous=this.entries.at(-1);if(previous?.file===file)previous.count+=count;else this.entries.push({file,count});
    this.count+=count;this.lastFile=file;
  }
  async add(frame) {
    if(this.canceled)throw new Error('Text layer canceled.');
    if(frame?.blank>0) {this.last=this.blank;this.hold(await this.surface(this.blank,true),frame.blank);return;}
    if(frame?.same>0) {this.hold(this.lastFile||await this.surface(this.blank,true),frame.same);return;}
    let pixels;
    if(frame?.data) {
      const {x,y,w,h}=frame;
      if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<1||h<1||x+w>this.width||y+h>this.height||frame.data.byteLength!==w*h*4)throw new Error('Text layer: bad frame patch');
      pixels=Buffer.from(this.last);const source=Buffer.from(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength);
      for(let row=0;row<h;row++)source.copy(pixels,((y+row)*this.width+x)*4,row*w*4,(row+1)*w*4);
    } else {
      pixels=Buffer.from(frame.buffer,frame.byteOffset,frame.byteLength);if(pixels.length!==this.size)throw new Error('Text layer: wrong frame size');
    }
    this.last=Buffer.from(pixels);this.hold(await this.surface(this.last),1);
  }
  async finish() {
    if(this.canceled)throw new Error('Text layer canceled.');
    if(!this.entries.length)throw new Error('Text layer has no frames.');
    const entries=this.entries.map(entry=>({...entry})),last=entries.at(-1);
    // An explicit final frame gives MOV the correct final sample duration.
    if(last.count>1){last.count--;entries.push({file:last.file,count:1});}
    const list=path.join(this.dir,'surfaces.ffconcat');
    await fs.promises.writeFile(list,'ffconcat version 1.0\n'+entries.map(entry=>`file '${entry.file}'\noption framerate ${this.fps}\nduration ${(entry.count/this.fps).toFixed(9)}\n`).join(''));
    if(this.canceled)throw new Error('Text layer canceled.');
    this.proc=spawn(this.ffmpegPath,['-v','error','-y','-f','concat','-safe','0','-i',list,'-fps_mode','vfr','-c:v','qtrle','-pix_fmt','argb','-video_track_timescale',String(this.fps*1000),'-t',String(this.count/this.fps),this.file],{windowsHide:true});
    let error='';this.proc.stderr.on('data',bytes=>{error=(error+bytes).slice(-3000);});
    await new Promise((resolve,reject)=>{this.proc.on('error',reject);this.proc.on('close',code=>code===0?resolve():reject(new Error(error||'Sparse text encoder stopped.')));});
    return this.file;
  }
  kill() {this.canceled=true;if(this.proc?.exitCode===null)this.proc.kill();}
}
module.exports={SparseTextStream,rgbaPng};
