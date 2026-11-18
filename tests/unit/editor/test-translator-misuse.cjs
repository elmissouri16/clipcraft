// The renderer imports the translator as `t` (and `tn`), the same short name editing code uses
// for a time. Reading the imported translator as a value — `t > start`, `{ t }`, `at: t` — is
// always a slip for a local time variable and writes NaN into the project (freeze frame did).
// This scans every renderer module and fails on any non-call use of the imported translator.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const root = path.join(__dirname, '..', '..', '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const files = walk(path.join(root, 'src'));
assert.ok(files.some((f) => f.endsWith(path.join('app', 'App.jsx'))), 'App.jsx is scanned');

const misuses = [];
for (const file of files) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    Identifier(p) {
      if (!['t', 'tn'].includes(p.node.name) || !p.isReferencedIdentifier()) return;
      const binding = p.scope.getBinding(p.node.name);
      if (!binding || binding.kind !== 'module') return;
      if (p.parentPath.isCallExpression() && p.parentPath.node.callee === p.node) return;
      misuses.push(`${path.relative(root, file)}:${p.node.loc.start.line} (${p.parentPath.type})`);
    },
  });
}
assert.deepEqual(misuses, [], `imported translator used as a value:\n${misuses.join('\n')}`);
console.log(`translator misuse scan: ${files.length} renderer modules clean`);
