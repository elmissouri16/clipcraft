(async()=>{
 const api=window.clipcraftView,info=await api.getInfo();document.querySelector('#title').textContent=info.title;
 const send=value=>api.postMessage(value).catch(error=>{document.querySelector('#error').textContent=error.message;});
 document.querySelector('#count').addEventListener('click',()=>send({type:'count'}));
 document.querySelector('#inspect').addEventListener('click',()=>send({type:'inspect'}));
 api.onMessage(value=>{if(value.type==='count')document.querySelector('#counter').textContent=String(value.count);if(value.type==='project')document.querySelector('#project').textContent=`${value.project.name} · ${value.project.width} × ${value.project.height} · ${value.project.fps} fps`;if(value.type==='proof')document.querySelector('#project').textContent=value.message;});
 document.documentElement.dataset.ready='true';
})().catch(error=>{document.querySelector('#error').textContent=error.message;});
