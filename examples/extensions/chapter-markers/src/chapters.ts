import type {ExtensionContext,MarkerOperation} from '@clipcraft/plugin-sdk/extension';
export async function addChapters(c:ExtensionContext,count:number){
 if(!Number.isInteger(count)||count<1||count>20)throw Error('Choose a chapter count from 1 to 20.');
 const first=await c.workspace.inspect({section:'markers',limit:200}),scope={documentId:first.documentId,projectRevision:first.projectRevision},document=await c.workspace.read();
 if(document.documentId!==scope.documentId||document.duration_sec<=0)throw Error('Open a project with timeline content first.');
 const occupied=new Set(first.items.map(marker=>Math.round((marker.time_sec??-1)*document.fps)));let next=first.next;
 while(next!==null){const page=await c.workspace.inspect({...scope,section:'markers',cursor:next,limit:200});for(const marker of page.items)occupied.add(Math.round((marker.time_sec??-1)*document.fps));next=page.next;}
 const operations:MarkerOperation[]=[];for(let index=0;index<count;index++){const time=index*document.duration_sec/count,frame=Math.round(time*document.fps);if(!occupied.has(frame)){occupied.add(frame);operations.push({type:'add',time_sec:time,label:'Chapter '+(index+1)});}}
 await c.markers.apply({...scope,operations});return {message:'Added '+operations.length+' chapter markers.',added:operations.length};
}
