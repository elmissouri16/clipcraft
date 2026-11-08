import assert from 'node:assert/strict';
import {stackRows,visibleRowRange} from '../../../src/features/timeline/rows.js';
let seed=27;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
for(let trial=0;trial<50;trial++) {
  const clips=Array.from({length:300},(_,id)=>({id,start:Math.floor(random()*100)/10,duration:.1+random()*10}));
  const ends=[],rows={};for(const clip of [...clips].sort((a,b)=>a.start-b.start)){let row=ends.findIndex(end=>end<=clip.start+1e-6);if(row<0){row=ends.length;ends.push(0);}ends[row]=clip.start+clip.duration;rows[clip.id]=row;}
  assert.deepEqual(stackRows(clips),{rows,count:Math.max(1,ends.length)},'heap allocation retains the first-free-row contract');
}
assert.deepEqual(visibleRowRange(0,300,1000,34,200),{first:0,end:0},'lanes below the viewport mount no rows');
const late=visibleRowRange(6000,300,100,34,200);assert.ok(late.first>150&&late.end-late.first<20);
assert.deepEqual(stackRows([]),{rows:{},count:1});
console.log('Timeline row allocation retains overlap semantics and virtual row windows stay bounded.');
