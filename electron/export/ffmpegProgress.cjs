// FFmpeg progress records can be split anywhere across stdout chunks.
function progressReader(total,emit) {
 let carry='',record={};
 return chunk=>{
  carry+=String(chunk);let end;
  while((end=carry.indexOf('\n'))>=0){
   const line=carry.slice(0,end).trim();carry=carry.slice(end+1);
   const at=line.indexOf('=');if(at<0)continue;
   const key=line.slice(0,at),value=line.slice(at+1);record[key]=value;
   if(key==='progress'){
    const micros=Number(record.out_time_us??record.out_time_ms),frames=Number(record.frame),fps=Number(record.fps),speed=parseFloat(record.speed),bytes=Number(record.total_size);
    emit(Number.isFinite(micros)&&total>0?Math.max(0,Math.min(1,micros/1e6/total)):0,
     {frames:Number.isFinite(frames)?frames:undefined,fps:Number.isFinite(fps)?fps:undefined,speed:Number.isFinite(speed)?speed:undefined,bytes:Number.isFinite(bytes)?bytes:undefined,finalizing:value==='end'});
    record={};
   }
  }
  if(carry.length>65536)carry=carry.slice(-4096);
 };
}
module.exports={progressReader};
