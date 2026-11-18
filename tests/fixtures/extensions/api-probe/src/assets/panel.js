let changes=0;
window.clipcraftView.onThemeChanged(async theme=>{changes++;await window.clipcraftView.postMessage({themeChange:changes,theme,infoTheme:(await window.clipcraftView.getInfo()).theme});});
window.clipcraftView.onMessage(async value=>{
 document.getElementById('t').textContent=JSON.stringify(value);
 await window.clipcraftView.postMessage({echo:value});
 if(value.inspect)await window.clipcraftView.postMessage({inspected:true,changes,theme:(await window.clipcraftView.getInfo()).theme});
});
(async()=>{
 const info=await window.clipcraftView.getInfo();
 let wasm=false,error;try{await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));wasm=true;}catch(e){error=e.message;}
 const asset=await fetch('panel.js?cache=2').then(r=>r.ok);
 await window.clipcraftView.postMessage({info:info.id,initialTheme:info.theme,wasm,asset,...(error?{error}:{})});
})();
