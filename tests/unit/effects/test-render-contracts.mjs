import assert from 'node:assert/strict';
import { FX_TRANSITIONS, fxTransition } from '../../../src/features/effects/catalog.js';
import { pixelPasses, clipHasPixelFx } from '../../../src/features/effects/apply.js';
import { runTransition } from '../../../src/features/effects/run.js';
import { clipCss } from '../../../src/features/effects/effects.js';
const W=32,H=18;
const a=Uint8ClampedArray.from({length:W*H*4},(_,i)=>i%4===3?255:(i*17)%256);
const b=Uint8ClampedArray.from(a,(v,i)=>i%4===3?255:255-v);
for(const transition of FX_TRANSITIONS)for(const p of [0,1]){
 const out=new Uint8ClampedArray(a.length);runTransition(a,b,out,W,H,p,transition.expr);
 assert.deepEqual(out,p?b:a,transition.id+' endpoint '+p);
}
const dissolve=new Uint8ClampedArray(a.length);runTransition(a,b,dissolve,W,H,.5,fxTransition('dissolve').expr);
let fromA=0,fromB=0;
for(let i=0;i<dissolve.length;i+=4){const isA=dissolve[i]===a[i],isB=dissolve[i]===b[i];assert.ok(isA||isB,'Dissolve reveals pixels rather than averaging them');if(isA)fromA++;if(isB)fromB++;}
assert.ok(fromA>W*H*.2&&fromB>W*H*.2,'Dissolve contains both sources');
for(const fx of ['grain','pixel','blur','vignette','mirror','flipv'])for(const strength of [0,.5,1]){
 const c={id:'v',in:0,out:2,effects:[fx],fxStrength:{[fx]:strength}},p={effectClips:[]};
 const clip=pixelPasses(p,c,0,.5),track=pixelPasses({effectClips:[{fx,start:0,duration:2,strength}]},{...c,effects:[]},0,.5);
 assert.deepEqual(clip,track,fx+' shares clip/track rendering at '+strength);
 assert.equal(clipHasPixelFx(p,c,0,2),strength!==0);
 assert.equal(clipCss(c),'','shared classic effect is not duplicated by CSS');
}
console.log('Every transition endpoint is exact; classic effect strengths share clip/track rendering');
