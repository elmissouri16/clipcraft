const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function projectCommandInput(method,input={}){
 const fields={status:[],create:['documentId','format','fps','name'],open:['documentId','path'],save:['documentId','path','saveAs'],close:['documentId']},name=method.replace(/^projects\./,'');
 if(!Object.hasOwn(fields,name)||!plain(input)||Object.keys(input).some(key=>!fields[name].includes(key)))throw Error('Invalid project command');
 if(name==='status')return {};
 if(!(typeof input.documentId==='string'&&input.documentId.length>0&&input.documentId.length<=100)||input.documentId===null){if(!(['create','open'].includes(name)&&input.documentId===null))throw Error('Provide the current documentId, or null when no project is open');}
 if(input.path!==undefined&&(typeof input.path!=='string'||! /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(input.path)||input.path.length>32768||input.path.includes('\0')||! /\.clipcraft\.json$/i.test(input.path)))throw Error('Provide an absolute .clipcraft.json project path');
 if(input.saveAs!==undefined&&typeof input.saveAs!=='boolean')throw Error('saveAs requires a boolean');
 if(input.path!==undefined&&input.saveAs===true)throw Error('Choose an explicit path or the Save As picker');
 if(name==='create'){
  if(input.format!==undefined&&(typeof input.format!=='string'||input.format.length>16)||input.fps!==undefined&&(!Number.isFinite(input.fps)||input.fps<1||input.fps>240)||input.name!==undefined&&(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||/[\u0000-\u001f\u007f]/.test(input.name)))throw Error('Invalid new project format, frame rate or name');
  return {...input,format:input.format??'16:9',fps:input.fps??30,name:input.name??'Untitled'};
 }
 return {...input};
}
