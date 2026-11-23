let count=0;document.querySelector('#count').onclick=()=>{document.querySelector('#count').textContent='Count: '+ ++count;};
window.clipcraftView.onMessage(value=>{document.querySelector('#label').textContent=String(value.label);});
window.clipcraftView.getInfo().then(info=>{document.body.dataset.view=info.id;return window.clipcraftView.postMessage({ready:true});});
