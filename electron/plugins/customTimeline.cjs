const fs=require('node:fs/promises'),path=require('node:path');
// Original 2x2 RGBA-zero PNG, generated from an empty filtered image. This host
// input is ephemeral; custom project files never contain its machine-specific path.
const BLANK=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=','base64');
async function timelineTypes(manager){
 const [tracks,clips,effects]=await Promise.all([manager.renderContributions('trackTypes'),manager.renderContributions('clipTypes'),manager.effects()]);
 const directory=path.join(manager.root,'.render-inputs'),blankPath=path.join(directory,'transparent.png');await fs.mkdir(directory,{recursive:true});let existing;try{existing=await fs.readFile(blankPath);}catch(error){if(error.code!=='ENOENT')throw error;}if(!existing?.equals(BLANK)){const temporary=blankPath+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,BLANK);await fs.rename(temporary,blankPath);}finally{await fs.rm(temporary,{force:true});}}
 return {tracks,clips,effects,blankPath};
}
module.exports={timelineTypes};
