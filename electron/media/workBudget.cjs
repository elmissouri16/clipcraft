// One budget for proxy, thumbnail and waveform subprocesses. Foreground exports
// stop queued work; playback permits one selected proxy but defers visuals.
class MediaWorkBudget {
  constructor(limit = 2) { this.limit=limit;this.playing=false;this.exporting=false;this.active=0;this.queue=[]; }
  setState({ playing=this.playing, exporting=this.exporting, limit=this.limit } = {}) {
    this.playing=playing===true;this.exporting=exporting===true;this.limit=Math.max(1,Math.min(3,Number(limit)||2));this.pump();
  }
  run(kind, work) {
    return new Promise((resolve,reject)=>{this.queue.push({kind,work,resolve,reject});this.pump();});
  }
  pump() {
    const limit=this.playing?1:this.limit;
    while(!this.exporting&&this.active<limit) {
      let index=this.queue.findIndex(job=>job.kind==='proxy');
      if(index<0&&!this.playing)index=0;
      if(index<0||!this.queue.length)break;
      const [job]=this.queue.splice(index,1);this.active++;
      Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{this.active--;this.pump();});
    }
  }
}
const mediaWorkBudget=new MediaWorkBudget();
module.exports={MediaWorkBudget,mediaWorkBudget};
