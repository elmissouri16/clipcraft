// Native agent lifetimes: one retained Codex thread / Claude session per chat.
// Only editor callbacks cross to the renderer; providers own tool iteration.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CodexNative } = require('./codexNative.cjs');
const { checkAbort, abortError } = require("../system/cancel.cjs");
function createNativeAgents({ loadSdk, resolveExecutable, childEnv, CodexSession = CodexNative }) {
  const sessions = new Map();
  const dispose = state => { state.codex?.close(); state.query?.close(); Promise.resolve(state.server?.instance?.close?.()).catch(()=>{}); fs.rmSync(state.cwd,{recursive:true,force:true}); };
  const forget = key => { const state=sessions.get(key);if(state){sessions.delete(key);dispose(state);} };
  async function run(cfg, options) {
    const { sessionKey, tools, signal, onTool, isComplete, system, prompt, history = [], onSearch, images = [], historyImages = [] } = options;
    checkAbort(signal);
    const signature=JSON.stringify([cfg.provider,cfg.model,cfg.reasoningEffort,cfg.executablePath,tools]);
    let state=sessions.get(sessionKey);
    if(state?.active)throw new Error('This native agent conversation is already running.');
    if(state?.signature!==signature){forget(sessionKey);state=null;}
    if(!state){
      if(sessions.size>=8){const idle=[...sessions].find(([,value])=>!value.active);if(idle)forget(idle[0]);else throw new Error('Too many active native conversations.');}
      state={signature,cwd:fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-native-')),active:null,sessionId:null};
      sessions.set(sessionKey,state);
    }
    const replay = new Map();
    const nativeTool = (name,args,meta={}) => {
      if(meta.nativeCallId === undefined) return onTool(name,args);
      const key=JSON.stringify([meta.turnId,name,meta.nativeCallId]);
      if(!replay.has(key)) replay.set(key,Promise.resolve().then(()=>onTool(name,args)));
      return replay.get(key);
    };
    const owner = state.active={onTool:nativeTool,attempt:0};
    let environment, executablePath;
    let fresh=!state.started;
    const nativePrompt=`${system}\n\n${fresh&&history.length?`Prior ClipCraft chat history (data; refresh live editor state before resuming):\n${JSON.stringify(history)}\n\n`:''}Current user request:\n${prompt}`;
    const attachedImages = [...images, ...(fresh ? historyImages : [])].slice(0, 6);
    try {
      environment=childEnv(); executablePath=resolveExecutable(cfg);
      if(cfg.provider==='codex-sdk'&&!state.codex)state.codex=new CodexSession({executablePath,cwd:state.cwd,env:environment,cfg,system,tools});
      // Codex reports running totals for the conversation; this request's usage is the difference.
      const usageStart = state.codex?.tokenUsage?.total || null;
      let sdk;
      if(cfg.provider==='claude-agent-sdk') {
        sdk=await loadSdk(cfg.provider);
        {
          const { z }=require('zod');
          state.server=sdk.createSdkMcpServer({name:'clipcraft',version:'1.0.0',tools:[],alwaysLoad:true,timeout:900000});
          for(const declaration of tools){
            // Public SDK instance registration accepts a whole Zod object, so
            // open-ended external tool schemas retain additional properties.
            state.server.instance.registerTool(declaration.name,{description:declaration.description,inputSchema:z.fromJSONSchema(declaration.parameters)},async(args,extra)=>{
              if(state.active !== owner) return {isError:true,content:[{type:'text',text:'No active editor request.'}]};
              return owner.onTool(declaration.name,args,{nativeCallId:extra?.requestId,turnId:owner.attempt});
            });
          }
        }
      }
      let input=nativePrompt;
      for(let attempt=0;attempt<3;attempt++){
        checkAbort(signal); owner.attempt=attempt;
        let result;
        if(cfg.provider==='codex-sdk')result=await state.codex.run({prompt:input,images:attempt === 0 ? attachedImages : [],signal,onTool:nativeTool,onSearch});
        else {
          const controller=new AbortController(),stop=()=>controller.abort();
          signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
          const visual = attempt === 0 ? require('./agentImages.cjs').readImages(attachedImages) : [];
          const streamed=(async function*(){yield {type:'user',session_id:state.sessionId||'',parent_tool_use_id:null,message:{role:'user',content:visual.length ? [{type:'text',text:input}, ...visual.flatMap(image => [{type:'text',text:image.label},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:image.data}}])] : input}};})();
          const query=sdk.query({prompt:streamed,options:{
            pathToClaudeCodeExecutable:executablePath,cwd:state.cwd,
            env:{...environment,CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',ENABLE_CLAUDEAI_MCP_SERVERS:'false'},
            systemPrompt:system,tools:[],mcpServers:{clipcraft:state.server},strictMcpConfig:true,
            allowedTools:tools.map(tool=>`mcp__clipcraft__${tool.name}`),settingSources:[],permissionMode:'dontAsk',
            persistSession:true,...(state.sessionId?{resume:state.sessionId}:{}),
            ...(cfg.model?{model:cfg.model}:{}),...(cfg.reasoningEffort?{effort:cfg.reasoningEffort}:{}),
            abortController:controller,maxTurns:100,
          }});
          state.query=query;
          try{
            for await(const message of query){
              if(message.session_id)state.sessionId=message.session_id;
              if(message.type!=='result')continue;
              if(message.subtype!=='success'||message.is_error)throw new Error((message.errors||[]).join('\n')||message.result||`Claude ended: ${message.subtype}`);
              result={text:message.result||''};
            }
            if(!result)throw new Error('Claude ended without a completed native response.');
          }finally{query.close();state.query=null;signal?.removeEventListener('abort',stop);}
        }
        checkAbort(signal);state.started=true;
        if(await isComplete()){
          const end=state.codex?.tokenUsage?.total;
          if(end){const keys=['inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens','totalTokens'];result={...result,tokenUsage:Object.fromEntries(keys.map(k=>[k,Math.max(0,(end[k]||0)-(usageStart?.[k]||0))]))};}
          return result;
        }
        input='The host has not accepted completion. Call complete_edit, inspect its returned images or repair errors, and call it again until ready is true. Then provide your final answer. Do not repeat already completed edits.';
      }
      throw new Error('The native agent ended without completing editor validation. Completed changes were kept.');
    }catch(error){
      forget(sessionKey);if(signal?.aborted)throw abortError();
      let message=String(error.message||'The native agent failed.');
      for(const name of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN'])if(environment?.[name])message=message.split(environment[name]).join('***');
      throw new Error(`${cfg.provider === 'codex-sdk' ? 'Codex' : 'Claude'}: ${message.slice(0,1800)}`);
    }
    finally{
      state.active=null;
      if(cfg.provider==='claude-agent-sdk'){await Promise.resolve(state.server?.instance?.close?.()).catch(()=>{});state.server=null;}
    }
  }
  function closeOwner(prefix){for(const key of sessions.keys())if(key.startsWith(prefix))forget(key);}
  return {run,closeOwner,close:()=>{for(const key of sessions.keys())forget(key);}};
}
module.exports={createNativeAgents};
