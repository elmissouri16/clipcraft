const api=window.clipcraftView,apply=document.querySelector('#apply'),discard=document.querySelector('#discard'),search=document.querySelector('#search'),rows=document.querySelector('#cues');let review;
const theme=values=>{for(const [key,value] of Object.entries(values))document.documentElement.style.setProperty('--cc-'+key,value);};
function render(){
 rows.replaceChildren();rows.scrollTop=0;if(!review)return;const query=search.value.toLocaleLowerCase();let shown=0;
 for(const [index,cue] of review.cues.entries()){
  if(query&&!cue.text.toLocaleLowerCase().includes(query)&&!cue.translation.toLocaleLowerCase().includes(query))continue;shown++;
  const article=document.createElement('article');article.className='cue';article.dataset.cue=String(index);const time=document.createElement('p');time.className='time';time.textContent=`${index+1} · ${cue.start_sec.toFixed(3)}–${cue.end_sec.toFixed(3)} s`;article.append(time);const columns=document.createElement('div');columns.className='columns';
  for(const [label,value] of [['Original',cue.text],[review.language,cue.translation]]){const column=document.createElement('div'),heading=document.createElement('p'),text=document.createElement('p');heading.className='label';heading.textContent=label;text.className='text';text.dir='auto';text.textContent=value;column.append(heading,text);columns.append(column);}article.append(columns);rows.append(article);
 }
 document.querySelector('#count').textContent=`${shown} of ${review.cues.length} cues · Originals preserved`;
}
async function decide(type){if(!review)return;apply.disabled=discard.disabled=true;try{await api.postMessage({type,run:review.run});}catch(error){document.querySelector('#error').textContent=error.message;apply.disabled=discard.disabled=false;}}
apply.addEventListener('click',()=>decide('apply'));discard.addEventListener('click',()=>decide('discard'));search.addEventListener('input',render);
api.onMessage(value=>{if(value?.type!=='review')return;review=value;document.querySelector('#description').textContent=`Text track ${value.track} → ${value.language} · ${value.connection} · ${value.model}`;apply.disabled=discard.disabled=search.disabled=false;render();discard.focus({preventScroll:true});});api.onThemeChanged(theme);
api.getInfo().then(info=>{theme(info.theme);return api.postMessage({type:'ready'});}).catch(error=>{document.querySelector('#error').textContent=error.message;});
