// Canonical keyboard syntax shared by manifest validation, native registration
// and the editor keymap. Modifiers are ordered Ctrl, Alt, Shift; Cmd maps to Ctrl.
const MODIFIERS=new Set(['Control','Ctrl','Shift','Alt','Meta','AltGraph','CapsLock','Fn','OS']);
const VALID=/^(Ctrl\+)?(Alt\+)?(Shift\+)?([^+\s]+|\+)$/;
function validCombo(combo){
 if(typeof combo!=='string'||combo.length>40||!VALID.test(combo)||/[\u0000-\u001f\u007f]/.test(combo)||['Tab','Shift+Tab'].includes(combo))return false;
 const key=combo==='+'||combo.endsWith('++')?'+':combo.split('+').at(-1);
 return !MODIFIERS.has(key)&&!['Esc','Del','Left','Right','Up','Down','Spacebar'].includes(key)&&(key.length!==1||key===key.toUpperCase());
}
function shortcut(input){
 if(!input||typeof input.id!=='string'||!/^[a-z][\w.-]{0,127}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||/[\u0000-\u001f\u007f]/.test(input.title))throw Error('Shortcuts need an id and title');
 if(typeof input.command!=='string'||!/^[a-z][\w.-]{0,127}$/.test(input.command))throw Error('Invalid shortcut command');
 if(!Array.isArray(input.keys)||input.keys.length>4||Array.from({length:input.keys.length},(_,index)=>!Object.hasOwn(input.keys,index)).some(Boolean)||input.keys.some(key=>!validCombo(key))||new Set(input.keys).size!==input.keys.length)throw Error('Use at most four distinct shortcut keys');
 if(input.scope!==undefined&&!['editor','app'].includes(input.scope))throw Error('Invalid shortcut scope');
 return {id:input.id,title:input.title,command:input.command,keys:[...input.keys],scope:input.scope??'editor'};
}
module.exports={validCombo,shortcut};
