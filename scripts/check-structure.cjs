// Fast path checks after moving modules; no app launch or external services.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const problems = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const exists = file => [file, ...['.js','.jsx','.cjs','.mjs','.json','/index.js','/index.cjs'].map(ext => file+ext)].some(candidate => fs.existsSync(candidate));
for (const folder of ['src','electron','tests','scripts','packages/plugin-sdk/src']) {
  for (const file of walk(path.join(root, folder)).filter(file => /\.(?:[cm]?js|jsx)$/.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    const imports = /(?:^\s*(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\b(?:require(?:\.resolve)?|import)\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/gm;
    for (const match of source.matchAll(imports)) {
      const specifier = match[2].split(/[?#]/)[0];
      if (!exists(path.resolve(path.dirname(file), specifier))) problems.push(`${path.relative(root,file)}: missing ${match[2]}`);
    }
  }
}
for (const [folder, allowed] of [['src',['main.jsx']],['electron',['main.cjs','preload.cjs']]]) {
  for (const file of fs.readdirSync(path.join(root,folder),{withFileTypes:true})) if(file.isFile() && /\.[cm]?(?:js|jsx)$/.test(file.name) && !allowed.includes(file.name)) problems.push(`${folder}/${file.name}: place implementation in its feature folder`);
}
for (const file of fs.readdirSync(__dirname)) if (/^test-/.test(file)) problems.push(`scripts/${file}: test suites belong in tests/unit/`);
problems.push(...require('./check-runtime-dependencies.cjs').runtimeDependencyProblems(root));
if (problems.length) { console.error(problems.join('\n'));process.exitCode=1; }
else console.log('Structure OK: module imports resolve; entry points, features and test suites are separated.');
