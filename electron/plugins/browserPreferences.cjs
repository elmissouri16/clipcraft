const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {readRegularFile}=require('./package.cjs');
class BrowserPreferences{
 constructor(manager){this.manager=manager;this.file=path.join(manager.root,'.browser-favorites.json');}
 async read(){try{const bytes=await readRegularFile(this.file,512*1024,'Pack favorites');return (await import('../../shared/pluginBrowser.mjs')).validatePackFavorites(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 set(id,favorite){return this.manager.mutate(async()=>{
  const {validatePackFavorites}=await import('../../shared/pluginBrowser.mjs');validatePackFavorites([id]);if(typeof favorite!=='boolean')throw Error('Invalid favorite choice.');const values=new Set(await this.read());if(favorite)values.add(id);else values.delete(id);const result=validatePackFavorites([...values]);await fs.mkdir(this.manager.root,{recursive:true});const temp=this.file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(result),{flag:'wx',mode:0o600});await fs.rename(temp,this.file);}finally{await fs.rm(temp,{force:true});}return result;
 });}
}
module.exports={BrowserPreferences};
