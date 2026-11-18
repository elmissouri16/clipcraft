window.clipcraftView.onMessage(value=>{document.getElementById('t').textContent=JSON.stringify(value);window.clipcraftView.postMessage({echo:value});});
window.clipcraftView.getInfo().then(info=>window.clipcraftView.postMessage({info:info.id}));
