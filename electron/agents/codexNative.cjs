// Persistent Codex app-server connection. Dynamic tools are direct JSON-RPC
// callbacks; no MCP server and no JSON-tool-plan prompting are involved.
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { version } = require('../../package.json');
const { abortError, checkAbort, abortable } = require("../system/cancel.cjs");
// Codex features that can put a tool or an action in front of the model; disabled by default.
// Native editor sessions enable code_mode_host below: models using code mode need that bridge
// to invoke the registered tools, even when shell/filesystem tools are off. With these off, Codex
// 0.167 still offers request_user_input (inert outside Plan mode; ClipCraft refuses it) and keeps
// unified_exec on, which only backs the shell tool that is off. tests/unit/agents/test-agent-parity.mjs
// checks the tools the model actually receives.
const CODEX_FEATURES_OFF = Object.fromEntries(['shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'apps', 'plugins', 'image_generation',
  'multi_agent', 'memories', 'hooks', 'goals', 'view_image', 'sleep_tool', 'code_mode_host', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'browser_annotation_api', 'computer_use', 'in_app_browser', 'in_app_local_automation', 'tool_suggest', 'skill_search', 'skill_mcp_dependency_install',
  'remote_plugin', 'plugin_discovery_prefetch', 'plugin_sharing', 'workspace_dependencies'].map((name) => [name, false]));

class CodexNative {
  constructor({ executablePath, cwd, env, cfg = {}, system, tools = [], catalogOnly = false, webSearch = true, spawnImpl = spawn }) {
    this.cfg = cfg; this.cwd = cwd; this.tools = tools; this.pending = new Map(); this.nextId = 1; this.active = null; this.threadId = null; this.closed = false;
    const settings = { features: { ...CODEX_FEATURES_OFF, code_mode_host:true, skip_host_skill_discovery:true }, skills:{include_instructions:false}, mcp_servers:{} };
    const args = ['app-server'];
    const flatten = (object, prefix='') => { for (const [key, value] of Object.entries(object)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) flatten(value, name);
      else args.push('-c', `${name}=${value && typeof value === 'object' && !Array.isArray(value) ? '{}' : JSON.stringify(value)}`);
    } };
    flatten(settings);
    this.proc = spawnImpl(executablePath, args, { cwd, env, windowsHide:true, stdio:['pipe','pipe','pipe'] });
    this.proc.stderr.on('data', () => {}); // Never surface credential-bearing CLI diagnostics.
    this.proc.stdin.on('error', error => this.fail(error));
    this.proc.on('error', error => this.fail(error));
    this.proc.on('exit', () => { this.closed = true; this.fail(new Error('The Codex native session ended. Send another request to reconnect.')); });
    this.lines = readline.createInterface({ input:this.proc.stdout });
    this.lines.on('line', line => { try { this.receive(JSON.parse(line)); } catch (error) { this.fail(new Error('Codex returned an invalid protocol message.')); } });
    this.ready = (async () => {
      await this.request('initialize', { clientInfo:{name:'clipcraft',title:'ClipCraft',version}, capabilities:{experimentalApi:true} },catalogOnly?10000:30000);
      this.send({method:'initialized'});
      if (catalogOnly) return;
      const thread = await this.request('thread/start', { cwd, ...(cfg.model ? {model:cfg.model} : {}), baseInstructions:system, approvalPolicy:'never', sandbox:'read-only', ephemeral:true,
        config:{web_search:webSearch===false?'disabled':'live'},
        dynamicTools:tools.map(tool=>({type:'function',name:tool.name,description:tool.description,inputSchema:tool.parameters,deferLoading:false})) });
      this.threadId = thread.thread.id;
    })();
    this.ready.catch(() => {});
  }
  async listModels({signal}={}) {
    await abortable(this.ready,signal);checkAbort(signal);
    const entries=[],seen=new Set();let cursor;
    for(let page=0;page<10;page++) {
      const result=await abortable(this.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})},15000),signal);
      for(const model of result.data||[])if(!model.hidden&&typeof model.model==='string'&&!seen.has(model.model)){seen.add(model.model);entries.push(model);}
      if(!result.nextCursor||result.nextCursor===cursor)break;cursor=result.nextCursor;
    }
    return entries;
  }
  send(message) { if (this.closed || !this.proc.stdin.writable) throw new Error('Codex session is not connected.'); this.proc.stdin.write(`${JSON.stringify(message)}\n`); }
  request(method, params, timeoutMs=30000) {
    const id = this.nextId++;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex ${method} timed out.`));},timeoutMs);
      this.pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      try { this.send({id,method,params}); } catch(error) { this.pending.delete(id);clearTimeout(timer);reject(error); }
    });
  }
  receive(message) {
    // Token accounting reported by the app-server (cumulative for the thread and
    // per turn); kept for measurement and usage display, never sent anywhere.
    if (typeof message.method === 'string' && /tokenusage/i.test(message.method)) { this.tokenUsage = message.params?.tokenUsage || message.params; this.onTokenUsage?.(this.tokenUsage); }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message || 'Codex request failed.')) : pending.resolve(message.result); return;
    }
    const active = this.active, params = message.params || {};
    // Bind callbacks to the acknowledged turn, not just its retained thread.
    // An old callback must never acquire the next request's editor transaction.
    if (active && !active.turnId) {
      if (active.early.length >= 500) { active.reject(new Error('Codex emitted too many events before acknowledging the turn.')); return; }
      active.early.push(message); return;
    }
    if (message.id !== undefined && message.method) {
      if (message.method === 'item/tool/call' && active && params.threadId === this.threadId && params.turnId === active.turnId) {
        Promise.resolve().then(()=>{if(this.active!==active)throw new Error('The editor turn ended.');return active.onTool(params.tool,params.arguments,{nativeCallId:params.callId,turnId:params.turnId});}).then(result=>this.send({id:message.id,result:{success:!result.isError,contentItems:result.content.map(block=>block.type==='image'?{type:'inputImage',imageUrl:`data:${block.mimeType};base64,${block.data}`}:{type:'inputText',text:block.text || ''})}}),error=>{try{this.send({id:message.id,result:{success:false,contentItems:[{type:'inputText',text:error.message}]}});}catch{}}).catch(error=>this.fail(error));
      } else {
        // No shell/file permission requests, external MCP elicitations or other
        // server actions are authorized by this editor integration.
        this.send({id:message.id,error:{code:-32601,message:'Only registered ClipCraft editor tool callbacks are supported.'}});
      }
      return;
    }
    if (!active || (params.threadId && params.threadId !== this.threadId) || (params.turnId && params.turnId !== active.turnId)) return;
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') active.text = params.item.text || '';
    if (['item/started','item/completed'].includes(message.method) && params.item?.type === 'webSearch') active.onSearch?.({id:params.item.id,query:params.item.query||params.item.action?.query||params.item.action?.queries?.join('; ')||params.item.action?.url||'',status:message.method==='item/completed'?'done':'running'});
    if (message.method === 'turn/completed') {
      const turn=params.turn;
      if (turn.id !== active.turnId) return;
      if (turn.status === 'completed') active.resolve({text:active.text, ...(this.tokenUsage ? {tokenUsage:this.tokenUsage} : {})});
      else active.reject(turn.status === 'interrupted' ? abortError() : new Error(turn.error?.message || `Codex turn ${turn.status}.`));
    }
    if (message.method === 'error' && !params.willRetry) active.reject(new Error(params.error?.message || 'Codex native turn failed.'));
  }
  async run({prompt,images = [],signal,onTool,onSearch}) {
    checkAbort(signal); await abortable(this.ready, signal); checkAbort(signal);
    if (this.active) throw new Error('This Codex conversation is already running.');
    let abort;
    try {
      return await new Promise((resolve,reject)=>{
        const active = this.active={resolve,reject,onTool,onSearch,text:'',early:[]};
        abort=()=>{if(this.threadId&&this.active?.turnId)this.request('turn/interrupt',{threadId:this.threadId,turnId:this.active.turnId},3000).catch(()=>{});reject(abortError());};
        signal?.addEventListener('abort',abort,{once:true});
        this.request('turn/start',{threadId:this.threadId,input:[{type:'text',text:prompt}, ...images.map(image => ({type:'localImage',path:image.path}))],...(this.cfg.reasoningEffort?{effort:this.cfg.reasoningEffort}:{})}).then(result=>{if(this.active===active){active.turnId=result.turn.id;for(const message of active.early.splice(0))this.receive(message);}if(signal?.aborted)abort();},reject);
        if(signal?.aborted)abort();
      });
    } finally { signal?.removeEventListener('abort',abort); this.active=null; }
  }
  fail(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); this.active?.reject(error); }
  // Resolves once the app-server has exited (bounded), so its working folder can then be removed.
  close() { const exited=require('../system/childProcesses.cjs').processExited(this.proc);this.closed=true;this.fail(new Error('Codex session closed.'));this.lines.close();try{this.proc.kill();}catch{} return exited; }
}
module.exports={CodexNative,CODEX_FEATURES_OFF};
