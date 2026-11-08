import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { motionDataPinned, motionCurvesPinned } from '../../../src/features/timeline/track.js';
import { stateAt, motionCurves } from '../../../src/features/timeline/anim.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-smooth-zoom-'));
const W = 256, H = 256, fps = 30;
const source = path.join(dir, 'stripes.png');
// A smooth textured image exposes fractional movement without codec noise.
const pixels = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
  pixels[(y * W + x) * 3 + c] = Math.round(128 + 70 * Math.sin(x * .35) + 40 * Math.cos(y * .3));
}
execFileSync(ff.ffmpegPath, ['-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-i','-','-frames:v','1',source], { input: pixels });
const clip = { id:'v', mediaId:'m', in:0, out:2, speed:1, keyframes: {
  scale:[{t:0,v:1.2},{t:2,v:1.2012}], x:[{t:0,v:0},{t:2,v:.002}], y:[{t:0,v:0},{t:2,v:-.001}],
} };
const project = { width:W,height:H,fps,background:'#000000',media:[{...await ff.probe(source),id:'m',path:source}],videoClips:[clip],overlayClips:[],audioClips:[],textClips:[] };
project.motion = motionDataPinned(project);
const raw = (p, crop) => {
  const {args} = ff.buildExportArgs(p, '/tmp/unused.mp4', {raw:true});
  // Retain the real render resolution, but collect only a small textured patch
  // for long/HD motion checks instead of buffering gigabytes of full frames.
  if (crop) {
    args[args.indexOf('-filter_complex') + 1] += `;[rawframes]crop=${crop}[motionpatch]`;
    args[args.indexOf('-map') + 1] = '[motionpatch]';
  }
  return execFileSync(ff.ffmpegPath,args,{maxBuffer:32*1024*1024});
};
const frames = raw(project), frameBytes = W*H*4;
const deltas=[];
for(let f=1;f<60;f++) {
  let sum=0;
  for(let i=0;i<frameBytes;i+=4)for(let c=0;c<3;c++)sum+=Math.abs(frames[f*frameBytes+i+c]-frames[(f-1)*frameBytes+i+c]);
  deltas.push(sum/(W*H*3));
}
const sorted=[...deltas].sort((a,b)=>a-b), median=sorted[Math.floor(sorted.length/2)];
const evidence={frameCount:frames.length/frameBytes,zeroMotionFrames:deltas.filter(x=>x===0).length,medianFrameDelta:median,maxFrameDelta:Math.max(...deltas)};
fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
assert.equal(evidence.frameCount,60);
assert.equal(evidence.zeroMotionFrames,0,'a slow fractional zoom/pan must move every frame');
assert.ok(evidence.maxFrameDelta<median*2,'fractional motion must not jump by whole pixels');
// The reported edit eases between exactly 100% and 106.5%. A single 100%
// endpoint used to disable subpixel sampling for the entire clip. Check both
// directions at its 720px export size and at full HD, on actual rendered pixels.
evidence.boundaryZooms = [];
for (const [width,height] of [[720,406],[1920,1080]]) for (const reverse of [false,true]) {
  const c={...clip,out:9,keyframes:{scale:[{t:0,v:reverse?1.065:1,e:'inout'},{t:8.96,v:reverse?1:1.065,e:'inout'}]}};
  const p={...project,width,height,fps:24,videoClips:[c]};p.motion=motionDataPinned(p);
  const data=raw(p,`64:64:${width/2+50}:${height/2-32}`), bytes=64*64*4, differences=[];
  // Easing intentionally settles at the ends; measure the moving middle.
  for(let f=2*24;f<7*24;f++) {
    let sum=0;for(let i=0;i<bytes;i+=4)for(let ch=0;ch<3;ch++)sum+=Math.abs(data[f*bytes+i+ch]-data[(f-1)*bytes+i+ch]);
    differences.push(sum/(64*64*3));
  }
  const sorted=[...differences].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
  const check={width,height,reverse,frameCount:data.length/bytes,heldFrames:differences.filter(d=>d===0).length,medianDelta:median,maxDelta:Math.max(...differences)};
  evidence.boundaryZooms.push(check);
  assert.equal(check.frameCount,216);
  assert.equal(check.heldFrames,0,`100% ${reverse?'zoom-out':'zoom-in'} moves through the eased middle at ${width}px`);
  assert.ok(check.maxDelta<median*3,`100% zoom has no resize jumps at ${width}px`);
}
// Check the actual pixel mapping against an independent bilinear reference.
// The texture is smooth, so cubic interpolation and YUV quantization differ by
// only a few byte values. This catches wrong clocks, pan signs and zoom centers.
for(const frame of [0,15,30,59]) {
  const t=frame/fps, scale=1.2+.0012*t/2, tx=.002*t/2, ty=-.001*t/2;
  let error=0,count=0;
  for(let y=20;y<H-20;y+=7)for(let x=20;x<W-20;x+=7) {
    const sx=W/2+(x-W/2-tx*W)/scale, sy=H/2+(y-H/2-ty*H)/scale;
    const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
    for(let c=0;c<3;c++) {
      const value=(xx,yy)=>pixels[(yy*W+xx)*3+c];
      const expected=(value(x0,y0)*(1-fx)+value(x0+1,y0)*fx)*(1-fy)+(value(x0,y0+1)*(1-fx)+value(x0+1,y0+1)*fx)*fy;
      error+=Math.abs(frames[frame*frameBytes+(y*W+x)*4+c]-expected);count++;
    }
  }
  assert.ok(error/count<4,'inverse mapping agrees with reference at frame '+frame+': '+error/count);
}
// The resampling path must preserve source alpha and multiply an opacity curve.
const transparent = path.join(dir,'half-alpha.png'), rgba = Buffer.alloc(W*H*4);
for(let i=0;i<W*H;i++){pixels.copy(rgba,i*4,i*3,i*3+3);rgba[i*4+3]=128;}
execFileSync(ff.ffmpegPath,['-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${W}x${H}`,'-i','-','-frames:v','1',transparent],{input:rgba});
const fade={...clip,keyframes:{...clip.keyframes,opacity:[{t:0,v:0},{t:2,v:1}]}};
const alphaProject={...project,media:[{...project.media[0],path:transparent}],videoClips:[fade]};alphaProject.motion=motionDataPinned(alphaProject);
const faded=raw(alphaProject);
for(const f of [0,15,30,59]){
  let error=0,count=0;for(let i=0;i<frameBytes;i+=4)for(let c=0;c<3;c++){error+=Math.abs(faded[f*frameBytes+i+c]-frames[f*frameBytes+i+c]*(128/255)*(f/fps/2));count++;}
  assert.ok(error/count<3,'subpixel zoom preserves source alpha and animated opacity at frame '+f);
}
// A slow eased turning point must survive export-curve simplification.
const turning={...clip,out:18,keyframes:{scale:[{t:0,v:1.055,e:'inout'},{t:9.3,v:1.19,e:'inout'},{t:18,v:1.08,e:'inout'}]}};
const p2={...project,videoClips:[turning]};
const curves=motionCurvesPinned(p2,{track:'video',clip:turning},18,fps);
const lerp=(pts,t)=>{for(let i=1;i<pts.length;i++)if(t<=pts[i][0]){const [a,va]=pts[i-1],[b,vb]=pts[i];return va+(vb-va)*(t-a)/(b-a);}return pts.at(-1)[1];};
assert.deepEqual(curves,motionCurves(turning,18,fps));
for(let f=8*fps;f<=10*fps;f++)assert.ok(Math.abs(lerp(curves.s,f/fps)-stateAt(turning,f/fps,18).transform.scale)*1920<.12,'turning point stays within a fraction of a pixel');
// Shrinking and panning beyond the image must reveal the actual background,
// rather than stretching source-edge pixels across the exposed canvas.
for(const patch of [{scale:[{t:0,v:.5},{t:2,v:.6}]},{scale:[{t:0,v:1.01},{t:2,v:.99}],x:[{t:0,v:.2},{t:2,v:.21}]},{rot:[{t:0,v:30},{t:2,v:40}]}]) {
  const c={...clip,keyframes:{...clip.keyframes,...patch}},p={...project,videoClips:[c]};p.motion=motionDataPinned(p);
  p.background='#c04080';
  const data=raw(p);
  for(const f of [0,30,59]) {
    const exposed=patch.rot ? [[0,0]] : patch.x ? [[0,H/2]] : [[0,0],[W-1,0],[0,H-1],[W-1,H-1]];
    for(const [x,y] of exposed) {
      const i=f*frameBytes+(y*W+x)*4,pixel=data.subarray(i,i+3);
      assert.ok(Math.abs(pixel[0]-192)<8&&Math.abs(pixel[1]-64)<8&&Math.abs(pixel[2]-128)<8,'exposed border retains the colored background at frame '+f);
    }
  }
}
fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
console.log('Smooth zoom: 100% boundaries, fractional movement, mapping, easing and transparent borders passed; evidence: '+dir);
