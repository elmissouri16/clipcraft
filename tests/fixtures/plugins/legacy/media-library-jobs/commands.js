// A picked source is captured and verified by the host after this worker exits.
export async function run(context,input){
 if(input.operation==='import-image')await context.media.import({kind:'image'});
 else if(input.operation==='resize-image')await context.media.process({operation:'resize-image',max_size:Number(input.size.replace('size-',''))});
 else await context.media.process({operation:input.operation,start_sec:input.start_sec,duration_sec:input.duration_sec});
 return {message:'A local media job was staged. The host will choose its source and verify its result.'};
}
