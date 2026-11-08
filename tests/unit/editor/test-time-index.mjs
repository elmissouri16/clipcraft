import assert from 'node:assert/strict';
import { createTimeIndex } from '../../../src/features/timeline/timeIndex.js';

let seed = 72;const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32);
const clips = Array.from({length: 1200}, (_, id) => { const start=random()*100;return {id,start,end:start+random()*15}; });
clips.push({id:'long',start:0,end:1000},{id:'boundary',start:50,end:51});
const index = createTimeIndex(clips, c=>c.start, c=>c.end);
for(const time of [0,50,51,100,1001,...Array.from({length:100},()=>random()*130)]) {
  assert.deepEqual(index.at(time),clips.filter(c=>c.start<=time&&c.end>time));
  assert.deepEqual(index.range(time,time+2),clips.filter(c=>c.start<=time+2&&c.end>time));
}
assert.deepEqual(createTimeIndex([],c=>c.start,c=>c.end).at(1),[]);
assert.deepEqual(createTimeIndex([{start:0,end:0},{start:NaN,end:10}],c=>c.start,c=>c.end).at(0),[]);
console.log('Timeline index preserves overlapping layers, ordering, boundaries, gaps and arbitrary seeks.');
