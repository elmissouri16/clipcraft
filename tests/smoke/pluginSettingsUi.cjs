// Navigate the real settings views/disclosures before exercising their controls.
// Visibility is required: finding a mounted node in a hidden workspace is not UI proof.
module.exports=win=>{
 const q=code=>win.webContents.executeJavaScript(code);
 const show=async view=>{
  await q(`(()=>{const button=document.querySelector('[data-plugin-view="'+${JSON.stringify(view)}+'"]');if(!button)throw Error('Plugin task navigation is missing');if(button.getAttribute('aria-pressed')!=='true')button.click();})()`);
  for(let i=0;i<100;i++){if(await q(`!document.querySelector('[data-plugin-view-panel="'+${JSON.stringify(view)}+'"]').hidden`))return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw Error('Plugin task view did not open: '+view);
 };
 const reveal=async selector=>{
  const view=await q(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing UI control: '+${JSON.stringify(selector)});return node.closest('[data-plugin-view-panel]')?.dataset.pluginViewPanel;})()`);
  if(view)await show(view);
  await q(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open&&!(node.tagName==='SUMMARY'&&node.parentElement===parent))parent.open=true;node.scrollIntoView({block:'nearest'});})()`);
  if(!await q(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return !!node?.getClientRects().length&&!node.closest('[hidden]')&&getComputedStyle(node).visibility!=='hidden';})()`))throw Error('UI control is not visible: '+selector);
 };
 return {show,reveal,click:async selector=>{await reveal(selector);return q(`document.querySelector(${JSON.stringify(selector)}).click()`);}};
};
