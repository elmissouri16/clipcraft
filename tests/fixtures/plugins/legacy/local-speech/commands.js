// Fixed host recipe. This worker receives no paths, executable arguments or audio.
export async function run(context,input){
 await context.local.run({toolId:'speech',operation:'transcribe',model:input.model,start_sec:input.start_sec,duration_sec:input.duration_sec,language:'auto'});
 return {message:'The host will ask for a source and review the local transcript.'};
}
