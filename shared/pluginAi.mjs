// Caption-only data and fixed AI-service schemas, shared across editor and host.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Invalid chapter service fields.');};
const plain=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export const AI_CHAPTER_LIMITS={cues:1000,characters:24000,chapters:20,responseCharacters:8192};
export function validateCaptionSnapshot(cues,duration){
 if(!Array.isArray(cues)||!cues.length)throw Error('This command needs existing timeline captions. Add captions first.');
 if(cues.length>AI_CHAPTER_LIMITS.cues)throw Error('Caption input exceeds 1,000 cues. Use a shorter captioned project.');
 let characters=0,previous=-1;
 const result=cues.map(c=>{
  exact(c,['start_sec','end_sec','text']);
  if(typeof c.text==='string'&&c.text.length>AI_CHAPTER_LIMITS.characters)throw Error('Caption input exceeds 24,000 characters. Use a shorter captioned project.');
  if(!Number.isFinite(c.start_sec)||!Number.isFinite(c.end_sec)||c.start_sec<0||c.end_sec<=c.start_sec||c.end_sec>duration||c.start_sec<previous||!plain(c.text,24000))throw Error('Invalid caption text or timing.');
  previous=c.start_sec;characters+=c.text.length;
  return {start_sec:c.start_sec,end_sec:c.end_sec,text:c.text};
 });
 if(characters>AI_CHAPTER_LIMITS.characters)throw Error('Caption input exceeds 24,000 characters. Use a shorter captioned project.');
 return result;
}
export function captionSnapshot(project,duration,layer){
 const cues=(project.textClips||[]).filter(c=>c.caption&&(layer===undefined||(c.layer??0)===layer)&&String(c.text||'').trim()).map(c=>({start_sec:c.start,end_sec:c.start+c.duration,text:String(c.text).replace(/[\u0000-\u001f]/g,' ').trim()})).sort((a,b)=>a.start_sec-b.start_sec);
 return validateCaptionSnapshot(cues,duration);
}
export const TRANSLATION_LANGUAGES=[{value:'en',label:'English'},{value:'fr',label:'French'},{value:'es',label:'Spanish'},{value:'ar',label:'Arabic'},{value:'de',label:'German'},{value:'it',label:'Italian'},{value:'pt',label:'Portuguese'},{value:'ja',label:'Japanese'},{value:'ko',label:'Korean'},{value:'zh',label:'Chinese'},{value:'tr',label:'Turkish'},{value:'hi',label:'Hindi'}];
export function translationLanguage(value){const language=TRANSLATION_LANGUAGES.find(l=>l.value===value);if(!language)throw Error('Unsupported translation language.');return language;}
export function sourceTrack(value=1){if(!Number.isInteger(value)||value<1||value>128)throw Error('Source Text track must be from 1 to 128.');return value;}
export function validateTranslationSnapshot(cues,duration){
 const validated=validateCaptionSnapshot(cues,duration);
 if(validated.length>100||validated.reduce((n,c)=>n+c.text.length,0)>12000)throw Error('Translation supports up to 100 cues and 12,000 source characters. Use a shorter caption track.');
 if(validated.some((c,i)=>i&&c.start_sec<validated[i-1].end_sec-1e-6))throw Error('Translation requires one nonoverlapping source caption track.');
 return validated;
}
export function translationSnapshot(project,duration,track=1){return validateTranslationSnapshot(captionSnapshot(project,duration,sourceTrack(track)-1),duration);}
export function translationProposal(value,cues,language){
 exact(value,['language','translations']);translationLanguage(value.language);
 if(value.language!==language||!Array.isArray(value.translations)||value.translations.length!==cues.length||cues.length>100)throw Error('Translation must cover the complete source track in the approved language.');
 let characters=0;
 const translations=value.translations.map((c,index)=>{
  exact(c,['index','text']);if(c.index!==index||!plain(c.text,1000))throw Error('Invalid translated cue.');characters+=c.text.length;return {index,text:c.text.trim()};
 });
 if(characters>16000)throw Error('Translated text exceeds 16,000 characters.');
 return {language,translations};
}
export function translationResponse(text,cues,language){
 if(typeof text!=='string'||text.length>24000)throw Error('The model returned an oversized translation response.');
 let value;try{value=JSON.parse(text);}catch{throw Error('The model did not return valid translation JSON.');}
 exact(value,['translations']);return translationProposal({language,translations:value.translations},cues,language).translations;
}
export function reviewedCaptionResult(project,duration,input,result){
 if(result.reviewed!==true||!result.translation||result.markers?.length)throw Error('Caption proposals require host review before applying.');
 exact(result.translation,['language','translations','sourceTrack']);
 const track=sourceTrack(input.source_track),language=translationLanguage(input.language).value;
 if(result.translation.sourceTrack!==track)throw Error('The translation source track changed.');
 const proposal=translationProposal({language:result.translation.language,translations:result.translation.translations},translationSnapshot(project,duration,track),language);
 return {proposal,sourceTrack:track};
}
export function chapterCount(args){
 exact(args,['count']);
 if(!Number.isInteger(args.count)||args.count<1||args.count>AI_CHAPTER_LIMITS.chapters)throw Error('Chapter count must be an integer from 1 to 20.');
 return args.count;
}
export function chapterResponse(text,cues,count){
 if(typeof text!=='string'||text.length>AI_CHAPTER_LIMITS.responseCharacters)throw Error('The model returned an oversized chapter response.');
 let value;try{value=JSON.parse(text);}catch{throw Error('The model did not return valid chapter JSON.');}
 exact(value,['chapters']);
 if(!Array.isArray(value.chapters)||!value.chapters.length||value.chapters.length>count)throw Error('The model returned an invalid number of chapters.');
 let previous=-1;
 return value.chapters.map(c=>{
  exact(c,['time','label']);
  const anchor=cues.find(cue=>Math.abs(cue.start_sec-c.time)<1e-6);
  if(!Number.isFinite(c.time)||!anchor||anchor.start_sec<=previous||!plain(c.label,80))throw Error('The model returned an invalid chapter timestamp or title.');
  previous=anchor.start_sec;return {time:anchor.start_sec,label:c.label.trim()};
 });
}
