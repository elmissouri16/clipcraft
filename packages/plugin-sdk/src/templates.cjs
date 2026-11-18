const SDK_VERSION=require('../package.json').version;
const json=value=>JSON.stringify(value,null,2)+'\n';
function templateFiles({id,name,publisher,template,sdkDependency}){
 const manifest={id,name,publisher,version:'0.1.0',apiVersion:1,minClipcraftVersion:'2.0.0',description:'A ClipCraft plugin.',contributes:{}};
 const files={};
 if(template==='extension'){
  manifest.main='dist/extension.cjs';manifest.contributes.commands=[{id:'hello',name:'Hello from extension'}];
  files['src/extension.ts']="import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';\n\nexport async function activate(context:ExtensionContext){\n  await context.commands.register('hello',async()=>{\n    await context.log('Extension activated');\n    return {message:'Hello from your extension.'};\n  });\n}\n";
 }
 if(template==='motion-pack')manifest.contributes.motionPresets=[{id:'zoom',name,curves:{scale:[{at:0,value:1},{at:1,value:1.2,ease:'smooth'}]}}];
 if(template==='color-pack')manifest.contributes.colorPresets=[{id:'warm',name,settings:{filter:'warm',filterIntensity:75,grade:{contrast:10}}}];
 if(template==='text-style-pack')manifest.contributes.textStyles=[{id:'title',name,kind:'title',sampleText:name,duration:3,style:{font:'montserrat',size:64,bold:true,color:'#ffffff',y:.5,stroke:{width:0},shadow:{on:false},animIn:{id:'fade',dur:.3},animOut:{id:'fade',dur:.3}}}];
 if(template==='content-pack'){manifest.contributes.effects=[{id:'neutral',name:'Neutral',expression:'S(X,Y)',parameters:[]}];files['src/assets/README.txt']='Put your licensed WAV and WOFF2 files here. Declare sounds and fonts in plugin.json; only declared assets enter dist. See the SDK content pack guide.\n';}
 if(template==='effect')manifest.contributes.effects=[{id:'effect',name,expression:'S(X,Y)',parameters:[]}];
 if(template==='transition')manifest.contributes.transitions=[{id:'transition',name,expression:'A(X,Y)*(1-P)+B(X,Y)*P',duration:0.5,parameters:[]}];
 if(template==='export-preset')manifest.contributes.exportPresets=[{id:'preset',name,settings:{mode:'crf',crf:23,bitrateMbps:4,encoderPreset:'fast',audioKbps:128,resCap:720,fps:0,codec:'h264'}}];
 files['plugin.json']=json(manifest);
 files['package.json']=json({name:id.replace('.','-'),version:'0.1.0',private:true,type:'module',scripts:{check:'clipcraft-plugin check .',build:'clipcraft-plugin build .',watch:'clipcraft-plugin watch .',validate:'clipcraft-plugin validate dist',pack:'clipcraft-plugin pack dist plugin.clipcraft-plugin.tgz'},devDependencies:{'@clipcraft/plugin-sdk':sdkDependency||SDK_VERSION}});
 files['tsconfig.json']=json({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,lib:['ES2022','DOM'],skipLibCheck:false},include:['src/**/*.ts']});
 files['.gitignore']='node_modules/\ndist/\n.clipcraft-build.json\n.clipcraft-build.lock\n.clipcraft-stage-*\n.clipcraft-backup-*\n*.clipcraft-plugin.tgz\n';
 files['README.md']=`# ${name}\n\nInstall the local SDK dependency with npm install, then use npm run check and\nnpm run build. Install only the dist folder through ClipCraft Settings → Plugins.\nThe source directory is not an installable plugin. npm run pack creates a new\narchive and refuses to overwrite one. Node extensions bundle dependencies and run only after explicit Node trust.\nCreative packs contain data and assets; no executable recipes.\n\nUse the general ExtensionContext APIs, or declare creative contributions in plugin.json.\nIncrement its version before reinstalling changed bytes. SDK watch rebuilds the\nlocal output; it does not mutate installed packages or open editor windows.\nThe starter handler intentionally makes no editor edits.\n\nThe SDK dependency points to your local installation. For a portable project,\nuse a shared SDK tarball/path or a published release when available.\n`;
 return files;
}
module.exports={templateFiles};
