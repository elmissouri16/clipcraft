const host=window.clipcraftView,$=id=>document.getElementById(id);
const timestamp=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
function render(project){
 $('name').textContent=project.name||'Untitled project';$('format').textContent=`${project.width}×${project.height} · ${project.fps} fps`;
 $('duration').textContent=timestamp(project.duration_sec);$('pictures').textContent=project.counts.video;$('text').textContent=project.counts.text;$('audio').textContent=project.counts.audio;
 $('marker-count').textContent=`(${project.counts.markers})`;$('markers').replaceChildren();
 for(const marker of project.markers){const row=document.createElement('li'),time=document.createElement('span'),title=document.createElement('span');time.textContent=timestamp(marker.time);title.textContent=marker.label||'Untitled marker';row.append(time,title);$('markers').append(row);}
 if(!project.markers.length){const row=document.createElement('li');row.textContent='No markers yet.';$('markers').append(row);}
 $('status').textContent='Summary updated.';
}
let busy=false,ready=false;
const controls=()=>{for(const id of ['save-preferences','add-chapters'])$(id).disabled=busy||!ready;};controls();
const send=async value=>{busy=true;controls();try{await host.postMessage(value);}catch(error){$('status').textContent=error.message;}finally{busy=false;controls();}};
host.onMessage(value=>{
 if(value.type==='project')render(value.project);
 else if(value.type==='preferences'){$('note').value=value.preferences.note;$('chapter-count').value=value.preferences.count;ready=true;controls();$('preferences-status').textContent='Preferences loaded.';}
 else if(value.type==='saved')$('preferences-status').textContent='Preferences saved.';
 else if(value.type==='chapters')$('action-status').textContent=value.message;
 else if(value.type==='error')$('status').textContent=value.message;
 else if(value.type==='empty'){$('name').textContent='No project';$('status').textContent=value.message;}
});
$('save-preferences').addEventListener('click',()=>send({type:'save',preferences:{note:$('note').value,count:Number($('chapter-count').value)}}));
$('add-chapters').addEventListener('click',()=>send({type:'chapters',count:Number($('chapter-count').value)}));
$('refresh').addEventListener('click',()=>send({type:'refresh'}));
for(const id of ['note','chapter-count'])$(id).addEventListener('input',()=>{$('preferences-status').textContent='Unsaved preferences.';});
host.getInfo().then(()=>send({type:'ready'})).catch(error=>{$('status').textContent=error.message;});
