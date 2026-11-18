export async function run(context,input){
 const snapshot=await context.editor.read();
 if(snapshot.selection.clipIds.length!==1)throw Error('Select one unlinked picture clip.');
 await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'set-opacity',clipId:snapshot.selection.clipIds[0],partnerClipId:null,opacity:input.opacity}]});
 return {message:'Picture opacity prepared for the editor.'};
}
