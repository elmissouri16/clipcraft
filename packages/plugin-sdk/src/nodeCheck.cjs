// Use the pinned compiler's CLI. TypeScript 7 does not expose the old JS compiler API.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
async function checkNodeExtension(root,typesDirectory){
 const compilerPackage=require.resolve('typescript/package.json');
 const compiler=path.resolve(path.dirname(compilerPackage),require(compilerPackage).bin.tsc);
 const nodeTypes=path.dirname(path.dirname(require.resolve('@types/node/package.json')));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-node-check-'));
 try{
  const config={compilerOptions:{strict:true,noEmit:true,target:'ES2022',module:'Preserve',moduleResolution:'Bundler',lib:['ES2022'],types:['node'],typeRoots:[path.join(root,'node_modules/@types'),nodeTypes],rootDir:root,paths:{'@clipcraft/plugin-sdk/extension':[path.join(typesDirectory,'extension.d.ts')],'@clipcraft/plugin-sdk':[path.join(typesDirectory,'index.d.ts')]}},files:[path.join(root,'src/extension.ts')]};
  const file=path.join(directory,'tsconfig.json');await fs.writeFile(file,JSON.stringify(config));
  return await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[compiler,'--project',file,'--pretty','false'],{cwd:root,stdio:['ignore','pipe','pipe']});let text='',timedOut=false;
   const record=data=>{text=(text+data).slice(-16000);};child.stdout.on('data',record);child.stderr.on('data',record);
   const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},30000);
   child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,text:timedOut?'Node type check timed out':text});});
  });
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={checkNodeExtension};
