// Historical built-in settings are adopted only by their optional replacement.
// Vendor names belong here and in the extension, never in runtime dispatch.
const fs=require('node:fs/promises'),path=require('node:path');
const VOICE_ENGINE='extension:clipcraft.voicestudio.speech';
function voiceDefault(value={}){
 if(value.engine==='voicestudio')return {...value,engine:VOICE_ENGINE,label:'VoiceStudio'};
 return value;
}
function settingsSeeds(data){
 if(!data.voiceStudio)return [];
 return [{extensionId:'clipcraft.voicestudio',values:{enabled:data.voiceStudio.enabled===true,address:typeof data.voiceStudio.url==='string'?data.voiceStudio.url.trim().slice(0,200):''}}];
}
async function prepare({manifest,storage},seeds){
 const seed=seeds.find(s=>s.extensionId===manifest.id);if(!seed)return;
 const file=path.join(storage,'settings.json');
 try{await fs.writeFile(file,JSON.stringify(seed.values),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
}
module.exports={voiceDefault,settingsSeeds,prepare};
