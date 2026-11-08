// Exercise electron-builder's production dependency filter without packaging an installer.
const assert=require('node:assert/strict'),path=require('node:path');
const {getNodeModuleFileMatcher}=require('app-builder-lib/out/fileMatcher');
const root=path.resolve(__dirname,'../../..'),pkg=require('../../../package.json');
const matcher=getNodeModuleFileMatcher(root,path.join(root,'dist'),x=>x,{}, {config:pkg.build,debugLogger:{isEnabled:false}}),filter=matcher.createFilter();
const included=name=>filter(path.join(root,'node_modules',name),{isDirectory:()=>false});
for(const provider of ['@openai/codex','@anthropic-ai/claude-agent-sdk'])for(const platform of ['darwin-arm64','darwin-x64','linux-x64','linux-arm64','linux-x64-musl','win32-x64','win32-arm64']){
 assert.equal(included(`${provider}-${platform}/vendor/bin/native`),false,`${provider}-${platform} is excluded`);
}
for(const file of ['@openai/codex-sdk/dist/index.js','@anthropic-ai/claude-agent-sdk/sdk.mjs','@anthropic-ai/claude-agent-sdk/core.mjs','tar/dist/commonjs/index.js'])assert.equal(included(file),true,`${file} stays packaged`);
assert.equal(included('@anthropic-ai/claude-agent-sdk/cli.js'),false);
assert.equal(included('wrapper/node_modules/@openai/codex-darwin-arm64/vendor/bin/codex'),false);
assert.equal(included('wrapper/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),false);
console.log('Both native agent distributions are excluded; SDK adapters and extraction code remain included');
