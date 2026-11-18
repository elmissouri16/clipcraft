import shortcutsContract from './pluginShortcuts.cjs';
// Executable extensions share the pack identity; `main` selects the Node host.
export {extensionFile} from './pluginExtensionFiles.cjs';
export function extensionManifest(input){
 if(input.main!=='dist/extension.cjs')throw Error('Extension main must be dist/extension.cjs');
 if(input.entry||input.permissions?.length)throw Error('Node extensions use package trust, not command permissions');
 // No declaration means "start with the app", so runtime registrations (actions, hooks, listeners)
 // are present after a restart. Declare an explicit list, or [], to activate lazily instead.
 const events=input.activationEvents??['startup'];
 if(!Array.isArray(events)||events.length>128||events.some(e=>typeof e!=='string'||!(/^(startup|command:[\w.-]+|event:[\w.-]+|service:[\w.-]+|hook:[\w.-]+|view:[\w.-]+|ui:[\w.-]+)$/.test(e)))||new Set(events).size!==events.length)throw Error('Invalid extension activationEvents');
 const c=input.contributes||{};
 if(Object.keys(c).some(k=>['aiProviders','localTools','exportDestinations','panels'].includes(k)))throw Error('Use extension registrations instead of specialized executable contributions');
 const commands=c.commands??[];
 if(!Array.isArray(commands)||commands.length>128||commands.some(x=>!x||typeof x.id!=='string'||!/^[a-z][\w.-]{0,127}$/.test(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>160||x.description!==undefined&&(typeof x.description!=='string'||x.description.length>1000))||new Set(commands.map(x=>x.id)).size!==commands.length)throw Error('Invalid extension command declarations');
 const views=c.views??[];if(!Array.isArray(views)||views.length>8||views.some(view=>!view||Object.keys(view).some(key=>!['id','name'].includes(key))||typeof view.id!=='string'||!/^[a-z][\w.-]{0,127}$/.test(view.id)||typeof view.name!=='string'||!view.name.trim()||view.name.length>160)||new Set(views.map(view=>view.id)).size!==views.length)throw Error('Invalid extension view declarations');
 const shortcuts=c.shortcuts??[];if(!Array.isArray(shortcuts)||shortcuts.length>64)throw Error('Use at most 64 shortcut declarations');
 const bindings=shortcuts.map(input=>{if(!input||Object.keys(input).some(key=>!['id','name','command','keys','scope'].includes(key)))throw Error('Invalid shortcut declaration');const binding=shortcutsContract.shortcut({...input,title:input.name});if(!commands.some(command=>command.id===binding.command))throw Error('Shortcut must reference a declared command');return {id:binding.id,name:binding.title,command:binding.command,keys:binding.keys,scope:binding.scope};});if(new Set(bindings.map(binding=>binding.id)).size!==bindings.length)throw Error('Duplicate shortcut declaration');
 return {shortcuts:bindings,views:views.map(({id,name})=>({id,name})),main:input.main,activationEvents:[...events],commands:commands.map(({id,name,description})=>({id,name,parameters:[],...(description===undefined?{}:{description})}))};
}
