const host=window.clipcraftView,$=id=>document.getElementById(id),fields=['label','accent','density'];
function paint(){const colors={violet:'#9c80ff',amber:'#ffd06b',teal:'#62d7c2'};$('sample').style.borderColor=colors[$('accent').value];$('sample-label').style.color=colors[$('accent').value];$('sample-label').textContent=$('label').value;$('sample').style.gap=$('density').value==='compact'?'4px':'14px';}
fields.forEach(id=>$(id).addEventListener('input',()=>{paint();$('status').textContent='Unsaved preferences.';}));
host.onMessage(value=>{
 if(value.type==='preferences'||value.type==='saved'){for(const key of fields)$(key).value=value.preferences[key];paint();$('save').disabled=false;$('status').textContent=value.type==='saved'?'Preferences saved.':'Preferences loaded.';}
 else if(value.type==='error'){$('status').textContent=value.message;$('save').disabled=false;}
});
$('preferences').addEventListener('submit',async event=>{event.preventDefault();$('save').disabled=true;try{await host.postMessage({type:'save',preferences:Object.fromEntries(fields.map(key=>[key,$(key).value]))});}catch(error){$('status').textContent=error.message;}finally{$('save').disabled=false;}});
host.getInfo().then(()=>host.postMessage({type:'ready'})).catch(error=>{$('status').textContent=error.message;});
