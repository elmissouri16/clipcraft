import type {ExtensionContext,HookContract} from '@clipcraft/plugin-sdk/extension';
export async function activate(context:ExtensionContext){
 const contract={version:1,input:{type:'object',properties:{label:{type:'string',maxLength:160}},required:['label']},output:{type:'object',properties:{approved:{type:'boolean'},note:{type:'string',maxLength:160}},required:['approved','note']}} as const satisfies HookContract;
 await context.ui.registerSettings({id:'review',title:'Scene review',location:'settings.plugins',fields:[{key:'allow-scenes',label:'Allow custom scenes',type:'boolean',default:true}]});
 const review=async(input:{label:string})=>({approved:(await context.configuration.get<boolean>('allow-scenes'))!==false,note:'Scene review: '+input.label.slice(0,145)});
 let registration=await context.hooks.register('clipcraft-examples.sdk-workbench.scene-review',contract,review,{order:10});
}
