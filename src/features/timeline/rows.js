class Heap {
  constructor(compare) { this.items=[];this.compare=compare; }
  get first() { return this.items[0]; }
  push(value) {
    const items=this.items;let at=items.length;items.push(value);
    while(at>0){const parent=(at-1)>>>1;if(this.compare(items[parent],value)<=0)break;items[at]=items[parent];at=parent;}items[at]=value;
  }
  pop() {
    const items=this.items,first=items[0],last=items.pop();if(!items.length)return first;
    let at=0;while(at*2+1<items.length){let next=at*2+1;if(next+1<items.length&&this.compare(items[next+1],items[next])<0)next++;if(this.compare(last,items[next])<=0)break;items[at]=items[next];at=next;}items[at]=last;return first;
  }
}
// Preserve first-free-row placement without scanning every overlapping row.
export function stackRows(clips) {
  const busy=new Heap((a,b)=>a.end-b.end||a.row-b.row),free=new Heap((a,b)=>a-b),rows={};let count=0;
  for(const clip of [...clips].sort((a,b)=>a.start-b.start)) {
    while(busy.first&&busy.first.end<=clip.start+1e-6)free.push(busy.pop().row);
    const row=free.first===undefined?count++:free.pop();rows[clip.id]=row;busy.push({row,end:clip.start+clip.duration});
  }
  return {rows,count:Math.max(1,count)};
}
export function visibleRowRange(top,height,laneTop,rowHeight,count,titleHeight=22,overscan=96) {
  const first=Math.min(count,Math.max(0,Math.floor((top-laneTop-titleHeight-overscan)/rowHeight)));
  const end=Math.min(count,Math.max(first,Math.ceil((top+height-laneTop-titleHeight+overscan)/rowHeight)));
  return {first,end};
}
