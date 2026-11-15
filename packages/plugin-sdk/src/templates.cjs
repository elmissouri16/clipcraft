const SDK_VERSION=require('../package.json').version;
const json=value=>JSON.stringify(value,null,2)+'\n';
function templateFiles({id,name,publisher,template,sdkDependency}){
 const manifest={id,name,publisher,version:'0.1.0',apiVersion:1,minClipcraftVersion:'2.0.0',description:'A ClipCraft plugin.',permissions:[],contributes:{}};
 const files={};
 if(template==='command'||template==='panel'){
  manifest.entry='commands.js';manifest.contributes.commands=[{id:'run',name:'Run command',description:'Replace this starter handler with your plugin logic.',parameters:[]}];
  files['src/commands.ts']=`import {defineCommand} from '@clipcraft/plugin-sdk';\n\nexport const run = defineCommand({\n  async run(context, input) {\n    await context.progress(1, 'Command ready');\n    return {message: 'Command completed.'};\n  },\n});\n`;
 }
 if(template==='command')manifest.contributes.actions=[{id:'run',commandId:'run',label:name.slice(0,80),icon:'command',locations:['plugins-menu']}];
 if(template==='panel'){
  manifest.contributes.panels=[{id:'main',name,entry:'panel.html',script:'panel.js',style:'panel.css',permissions:[],commands:['run']}];
  files['src/panel.html']='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plugin panel</title><link rel="stylesheet" href="panel.css"><script src="panel.js" defer></script></head><body><main><h1 id="title">Plugin panel</h1><p id="status" role="status">Connecting…</p><button id="run" disabled>Run command</button></main></body></html>\n';
  files['src/panel.css']=':root{font:14px system-ui;color:var(--cc-text);background:var(--cc-background)}body{margin:0}main{padding:16px}h1{font-size:18px}button{font:inherit;background:var(--cc-accent);color:white;border:0;border-radius:6px;padding:10px 14px}button:disabled{opacity:.5}p{overflow-wrap:anywhere}\n';
  files['src/panel.ts']=`import {connectPanel, PluginError} from '@clipcraft/plugin-sdk';\n\nasync function main() {\n  const panel = await connectPanel();\n  const title = document.querySelector<HTMLElement>('#title')!;\n  const status = document.querySelector<HTMLElement>('#status')!;\n  const button = document.querySelector<HTMLButtonElement>('#run')!;\n  title.textContent = panel.info.name;\n  status.textContent = 'Panel ready.';\n  button.disabled = false;\n  panel.commands.onProgress(({phase}) => { status.textContent = phase; });\n  button.addEventListener('click', async () => {\n    button.disabled = true;\n    try {\n      // Request synchronously from this trusted click; host approval is always required.\n      const result = await panel.commands.run('run');\n      status.textContent = result.status === 'completed'\n        ? 'Completed. Added ' + result.markers_added + ' markers.'\n        : result.status;\n    } catch (error) {\n      status.textContent = error instanceof PluginError ? error.code + ': ' + error.message : String(error);\n    } finally { button.disabled = false; }\n  });\n  window.addEventListener('pagehide', () => panel.dispose(), {once: true});\n}\nmain().catch(error => { document.querySelector('#status')!.textContent = String(error); });\n`;
 }
 if(template==='effect')manifest.contributes.effects=[{id:'effect',name,expression:'S(X,Y)',parameters:[]}];
 if(template==='transition')manifest.contributes.transitions=[{id:'transition',name,expression:'A(X,Y)*(1-P)+B(X,Y)*P',duration:0.5,parameters:[]}];
 if(template==='export-preset')manifest.contributes.exportPresets=[{id:'preset',name,settings:{mode:'crf',crf:23,bitrateMbps:4,encoderPreset:'fast',audioKbps:128,resCap:720,fps:0,codec:'h264'}}];
 if(template==='ai-provider')manifest.contributes.aiProviders=[{id:'provider',name,protocol:'openai',baseUrl:'http://localhost:11434/v1',needsKey:false,models:[{id:'your-local-model',name:'Your local model',vision:false}],defaultModel:'your-local-model'}];
 files['plugin.json']=json(manifest);
 files['package.json']=json({name:id.replace('.','-'),version:'0.1.0',private:true,type:'module',scripts:{check:'clipcraft-plugin check .',build:'clipcraft-plugin build .',watch:'clipcraft-plugin watch .',validate:'clipcraft-plugin validate dist',pack:'clipcraft-plugin pack dist plugin.clipcraft-plugin.tgz'},devDependencies:{'@clipcraft/plugin-sdk':sdkDependency||SDK_VERSION}});
 files['tsconfig.json']=json({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,lib:['ES2022','DOM'],skipLibCheck:false},include:['src/**/*.ts']});
 files['.gitignore']='node_modules/\ndist/\n.clipcraft-build.json\n.clipcraft-build.lock\n.clipcraft-stage-*\n.clipcraft-backup-*\n*.clipcraft-plugin.tgz\n';
 files['README.md']=`# ${name}\n\nInstall the local SDK dependency with npm install, then use npm run check and\nnpm run build. Install only the dist folder through ClipCraft Settings → Plugins.\nThe source directory is not an installable plugin. npm run pack creates a new\narchive and refuses to overwrite one. Dependencies are bundled; no Node APIs or\nexternal imports are available in the installed sandbox.\n\nEdit plugin.json to declare capabilities and permissions before using them.\nIncrement its version before reinstalling changed bytes. SDK watch rebuilds the\nlocal output; it does not mutate installed packages or open editor windows.\nThe starter handler intentionally makes no editor edits.\n\nThe SDK dependency points to your local installation. For a portable project,\nuse a shared SDK tarball/path or a published release when available.\n`;
 return files;
}
module.exports={templateFiles};
