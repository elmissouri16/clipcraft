// Check literal host/shared imports against the application source file allowlist.
// This does not evaluate code, resolve third-party dependencies or certify computed paths.
const fs=require('node:fs'),path=require('node:path'),{parse}=require('acorn');
const slash=name=>name.split(path.sep).join('/');
function glob(pattern){
 let expression='^';
 for(let i=0;i<pattern.length;i++){
  const char=pattern[i];
  if(char==='*'&&pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;expression+='(?:.*/)?';}else expression+='.*';}
  else if(char==='*')expression+='[^/]*';
  else if(char==='?')expression+='[^/]';
  else expression+=char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(expression+'$');
}
function runtimeDependencyProblems(root){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),patterns=pkg.build?.files;
 if(!Array.isArray(patterns)||patterns.some(p=>typeof p!=='string'))throw Error('Runtime dependency check requires explicit string build.files entries.');
 // Third-party dependency inclusion/exclusion belongs to the packaging tool. The
 // application source patterns currently use *, ** and ?; fail on richer syntax.
 const sourcePatterns=patterns.filter(p=>!p.includes('node_modules')).map(p=>{
  const exclude=p.startsWith('!'),value=exclude?p.slice(1):p;
  if(/[{}[\]()]/.test(value))throw Error('Unsupported application source glob: '+p);
  return {exclude,test:glob(value.replace(/^\.\//,''))};
 });
 const shipped=name=>sourcePatterns.some(p=>!p.exclude&&p.test.test(name))&&!sourcePatterns.some(p=>p.exclude&&p.test.test(name));
 const problems=[],extensions=['','.cjs','.js','.mjs','.json','.node','/index.cjs','/index.js','/index.mjs'];
 const walk=directory=>fs.existsSync(directory)?fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):e.isFile()?[path.join(directory,e.name)]:[]):[];
 const literal=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value:node?.type==='TemplateLiteral'&&node.expressions.length===0?node.quasis[0].value.cooked:null;
 const smokeGuard=node=>node?.type==='MemberExpression'&&!node.computed&&node.property.name==='FVE_SMOKE'&&node.object?.type==='MemberExpression'&&!node.object.computed&&node.object.property.name==='env'&&node.object.object?.type==='Identifier'&&node.object.object.name==='process';
 for(const file of ['electron','shared'].flatMap(dir=>walk(path.join(root,dir))).filter(f=>/\.(?:cjs|mjs|js)$/.test(f))){
  const name=slash(path.relative(root,file));if(!shipped(name))continue;
  const ast=parse(fs.readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,locations:true});
  const visit=(node,smoke=false)=>{
   if(!node||typeof node!=='object')return;
   if(node.type==='IfStatement'&&smokeGuard(node.test)){visit(node.consequent,true);visit(node.alternate,smoke);return;}
   let specifier;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type))specifier=literal(node.source);
   else if(node.type==='CallExpression'&&(node.callee.type==='Identifier'&&node.callee.name==='require'||node.callee.type==='MemberExpression'&&!node.callee.computed&&node.callee.object?.name==='require'&&node.callee.property.name==='resolve'))specifier=literal(node.arguments[0]);
   if(specifier?.startsWith('.')){
    const candidates=extensions.map(ext=>path.resolve(path.dirname(file),specifier.split(/[?#]/)[0]+ext));
    const target=candidates.find(f=>fs.existsSync(f)&&fs.statSync(f).isFile()),relative=target&&slash(path.relative(root,target));
    // The known smoke dispatcher is intentionally absent from production. This
    // exception requires its exact path, caller and positive environment guard.
    const smokeOnly=smoke&&name==='electron/main.cjs'&&relative==='tests/smoke/index.cjs';
    if(!smokeOnly&&(!target||relative.startsWith('../')||!shipped(relative)))problems.push(`${name}:${node.loc.start.line}: ${specifier} ${target?'is excluded from build.files':'does not resolve'}`);
   }
   for(const [key,value] of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(item=>visit(item,smoke));else if(value&&typeof value==='object')visit(value,smoke);}
  };
  visit(ast);
 }
 return problems;
}
if(require.main===module){try{const problems=runtimeDependencyProblems(path.resolve(__dirname,'..'));if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('Runtime source dependencies are included in build.files.');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={runtimeDependencyProblems};
