const host=window.clipcraftPanel;
const $=id=>document.getElementById(id);
const timestamp=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
function render(project){
 $('name').textContent=project.name||'Untitled project';$('format').textContent=`${project.width}×${project.height} · ${project.fps} fps`;
 $('duration').textContent=timestamp(project.duration_sec);$('pictures').textContent=project.counts.video+project.counts.overlay;$('text').textContent=project.counts.text;$('audio').textContent=project.counts.audio;
 $('marker-count').textContent=`(${project.counts.markers})`;$('markers').replaceChildren();
 for(const marker of project.markers.slice(0,30)){const row=document.createElement('li'),time=document.createElement('span'),title=document.createElement('span');time.textContent=timestamp(marker.time);title.textContent=marker.label||'Untitled marker';row.append(time,title);$('markers').append(row);}
 if(!project.markers.length){const empty=document.createElement('li');empty.textContent='No markers yet.';$('markers').append(empty);}
}
async function refresh(){try{render(await host.project.read());$('status').textContent='Summary updated. Chapter actions require separate approval.';}catch(error){$('status').textContent=error.message;}}
host.project.onChanged(render);$('refresh').addEventListener('click',refresh);refresh();

const runButton=document.getElementById('add-chapters'),cancelButton=document.getElementById('cancel-action'),countInput=document.getElementById('chapter-count'),actionStatus=document.getElementById('action-status'),progress=document.getElementById('action-progress');
let running=false,denied=false,preferencesReady=false;runButton.disabled=true;
const showProgress=value=>{if(!running)return;progress.value=value.progress;actionStatus.textContent=({permission:'Waiting for approval…',running:'Preparing markers…',applying:'Applying markers…',canceled:'Canceled.',denied:'Approval declined.'})[value.phase]||'';cancelButton.disabled=value.phase==='applying';};
window.clipcraftPanel.commands.onProgress(showProgress);
runButton.addEventListener('click',async()=>{
 if(running||denied||!preferencesReady)return;
 const count=Number(countInput.value);if(!Number.isInteger(count)||count<1||count>20){actionStatus.textContent='Choose a whole number from 1 to 20.';return;}
 running=true;runButton.disabled=true;countInput.disabled=true;cancelButton.disabled=false;progress.hidden=false;showProgress({phase:'permission',progress:0});
 try{
  const result=await window.clipcraftPanel.commands.run('add-chapter-markers',{count});
  denied=result.status==='denied';
  actionStatus.textContent=result.status==='completed'?`Added ${result.markers_added} chapter markers.`:denied?'Approval declined. Reopen this panel to try again.':result.status==='canceled'?'Action canceled.':'Action failed. Check the editor status.';
 }catch(error){actionStatus.textContent=error.message;}
 finally{running=false;runButton.disabled=denied||!preferencesReady;countInput.disabled=false;cancelButton.disabled=true;progress.hidden=true;}
});
cancelButton.addEventListener('click',()=>{window.clipcraftPanel.commands.cancel().catch(()=>{actionStatus.textContent='Could not cancel the action.';});});

const savePreferences=$('save-preferences'),preferencesStatus=$('preferences-status'),note=$('note');
note.disabled=true;countInput.disabled=true;
(async()=>{
 try{
  const saved=await host.storage.get('preferences');
  if(saved!==null){
   if(typeof saved.note!=='string'||saved.note.length>2000||!Number.isInteger(saved.count)||saved.count<1||saved.count>20)throw Error('Saved preferences are invalid. Clear saved data in Settings to reset them.');
   note.value=saved.note;countInput.value=saved.count;
  }
  preferencesStatus.textContent=saved===null?'No saved preferences yet.':'Saved preferences loaded.';
  preferencesReady=true;note.disabled=false;countInput.disabled=false;runButton.disabled=denied;savePreferences.disabled=false;
 }catch(error){preferencesStatus.textContent=error.message;}
})();
const changed=()=>{if(preferencesReady)preferencesStatus.textContent='Unsaved preferences. Choose Save preferences to keep your changes.';};
note.addEventListener('input',changed);countInput.addEventListener('input',changed);
savePreferences.addEventListener('click',async()=>{
 const count=Number(countInput.value);
 if(!Number.isInteger(count)||count<1||count>20){preferencesStatus.textContent='Choose a whole number from 1 to 20.';return;}
 savePreferences.disabled=true;preferencesStatus.textContent='Saving preferences…';
 const savedNote=note.value;
 try{await host.storage.set('preferences',{note:savedNote,count});preferencesStatus.textContent=note.value===savedNote&&Number(countInput.value)===count?'Preferences saved.':'Earlier preferences saved. Save again to keep your latest changes.';}
 catch(error){preferencesStatus.textContent=error.message;}
 finally{savePreferences.disabled=false;}
});
