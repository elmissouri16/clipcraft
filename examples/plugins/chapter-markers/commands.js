// A self-contained ES module. It sees only the capability-scoped context and validated input.
export async function run(context,input){
 const project=await context.project.read();
 await context.progress(0.2,'Preparing chapter markers');
 const markers=Array.from({length:input.count},(_,index)=>({time:index*project.duration_sec/input.count,label:`Chapter ${index+1}`}));
 await context.markers.add(markers);
 await context.progress(1,'Chapter markers prepared');
 return {message:'Chapter markers prepared for the editor.'};
}
