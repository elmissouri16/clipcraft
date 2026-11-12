// Wraps the plain UI strings of JSX files in t() and records them in shared/i18n/en.json
// (docs/design/localization.md). Splices text in place from parser positions, so files keep their
// formatting. Handles the simple, unambiguous cases: a JSX text node that is the only text in its
// element (icon siblings are fine), and title / aria-label / placeholder / alt / aria-description /
// label attributes with a literal value. Everything else (text mixed with expressions or other
// text, template literals, string literals in expressions) is listed in the report for a hand pass.
// Usage: node scripts/i18n-wrap.cjs [--apply] [files...]   (without --apply: report only)
const fs = require('node:fs'), path = require('node:path');
const parser = require('@babel/parser');
const ROOT = path.resolve(__dirname, '..');
const EN = path.join(ROOT, 'shared/i18n/en.json');
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'label']);
const AREA = { HomeScreen: 'home', TopBar: 'topbar', SettingsDialog: 'settings', SettingsLayout: 'settings', ServiceConnections: 'services', ShortcutSettings: 'shortcuts', About: 'about', CloseDialog: 'close', ExternalAgent: 'external', App: 'app', ExportDialog: 'export', LeftPanel: 'library', StockLibrary: 'stock', MediaFavorites: 'favorites', BrowserControls: 'browser', MediaCredits: 'credits', OpenverseNotice: 'openverse', Timeline: 'timeline', Inspector: 'inspector', ClipInspector: 'clip', TextInspector: 'text', GradePanel: 'grade', CraftPilot: 'pilot', ToolVisuals: 'activity', AudioLibrary: 'audio', PackMusic: 'pack', TextToSpeech: 'tts', ScreenRecordDialog: 'record', Preview: 'preview', FrameInspection: 'frames', ContextMenu: 'menu', SearchBox: 'search', Dropdown: 'dropdown', WelcomeCard: 'welcome', GraphicPanel: 'graphic', EnhanceVoice: 'enhance' };
const SKIP_TEXT = /^(ClipCraft|Clip|Craft|CraftAI|Codex|Claude|OpenCode|Gemini|Groq|Ollama|OpenAI|OpenRouter|Mistral|DeepSeek|xAI|Grok|FFmpeg|VoiceStudio|ElevenLabs|MCP|GitHub|Openverse|Pixabay|Soundza|Jamendo|Freesound|Deepgram|Whisper|LUT|HEVC|H\.26[45]|MP4|WebM|GIF|PNG|JPEG|SRT|VTT|fps|px|ms|MB|GB|KB|dB|Hz|kHz|OK|AI|API|URL|ID|CC0|CC BY)$/;
const hasWords = (s) => /[A-Za-z]{2,}/.test(s);
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&hellip;/g, '…').replace(/&middot;/g, '·').replace(/&times;/g, '×');
const norm = (s) => decode(s).replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42).replace(/_+$/, '') || 'text';
const isTextExpr = (e) => !!e && (e.type === 'StringLiteral' ? hasWords(e.value) && !SKIP_TEXT.test(e.value.trim()) : e.type === 'TemplateLiteral' ? e.quasis.some((q) => hasWords(q.value.cooked || '')) : e.type === 'ConditionalExpression' ? isTextExpr(e.consequent) || isTextExpr(e.alternate) : e.type === 'LogicalExpression' ? isTextExpr(e.right) || (e.operator !== '&&' && isTextExpr(e.left)) : e.type === 'BinaryExpression' ? e.operator === '+' && (isTextExpr(e.left) || isTextExpr(e.right)) : e.type === 'ParenthesizedExpression' ? isTextExpr(e.expression) : false);
const apply = process.argv.includes('--apply');
const checkOnly = process.argv.includes('--check');
const wanted = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--report');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = (wanted.length ? wanted.map((f) => path.resolve(f)) : walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.jsx')));
const en = JSON.parse(fs.readFileSync(EN, 'utf8'));
const byText = new Map(Object.entries(en).filter(([, v]) => typeof v === 'string').map(([k, v]) => [v, k]));
const report = [], stats = { wrapped: 0, attrs: 0, files: 0 };
function keyFor(text, area) {
  if (byText.has(text)) return byText.get(text);
  let base = `${area}.${slug(text)}`, key = base, n = 2;
  while (en[key] !== undefined && en[key] !== text) key = `${base}_${n++}`;
  en[key] = text; byText.set(text, key); return key;
}
function visit(node, fn) { if (!node || typeof node !== 'object') return; fn(node); for (const k in node) { if (k === 'loc' || k === 'extra') continue; const v = node[k]; if (Array.isArray(v)) v.forEach((c) => c && typeof c === 'object' && c.type && visit(c, fn)); else if (v && typeof v === 'object' && v.type) visit(v, fn); } }
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast; try { ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'], ranges: true }); } catch (e) { report.push({ file, line: 0, kind: 'parse-error', text: e.message }); continue; }
  const area = AREA[path.basename(file, '.jsx')] || path.basename(file, '.jsx').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const rel = path.relative(path.dirname(file), path.join(ROOT, 'src/i18n/index.js')).replace(/\\/g, '/');
  const edits = []; let usesT = /\bimport \{[^}]*\bt\b[^}]*\} from ['"][^'"]*i18n\/index\.js['"]/.test(code);
  const line = (n) => code.slice(0, n.start).split('\n').length;
  visit(ast.program, (node) => {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const kids = node.children || [];
      const texts = kids.filter((c) => c.type === 'JSXText' && hasWords(c.value));
      const exprText = kids.filter((c) => c.type === 'JSXExpressionContainer' && isTextExpr(c.expression));
      for (const tx of texts) {
        const text = norm(tx.value);
        if (SKIP_TEXT.test(text) || !hasWords(text)) continue;
        if (texts.length > 1 || exprText.length || kids.some((c) => c.type === 'JSXExpressionContainer' && c.expression?.type === 'Identifier')) { report.push({ file, line: line(tx), kind: 'mixed', text }); continue; }
        const raw = tx.value, lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
        const key = keyFor(text, area);
        edits.push({ start: tx.start + lead, end: tx.end - trail, repl: `{t('${key}')}` }); stats.wrapped++;
      }
      for (const c of exprText) report.push({ file, line: line(c), kind: 'expression', text: code.slice(c.start, Math.min(c.end, c.start + 120)).replace(/\s+/g, ' ') });
    }
    if (node.type === 'JSXAttribute' && ATTRS.has(node.name.name) && node.value) {
      if (node.value.type === 'StringLiteral') {
        const text = norm(node.value.value);
        if (!hasWords(text) || SKIP_TEXT.test(text) || /^[a-z0-9:/._\-#%]+$/.test(text)) return;
        const key = keyFor(text, area);
        edits.push({ start: node.value.start, end: node.value.end, repl: `{t('${key}')}` }); stats.attrs++;
      } else if (node.value.type === 'JSXExpressionContainer' && isTextExpr(node.value.expression)) {
        report.push({ file, line: line(node), kind: 'attr-expression', text: code.slice(node.start, Math.min(node.end, node.start + 120)).replace(/\s+/g, ' ') });
      }
    }
  });
  if (!edits.length) continue;
  stats.files++;
  if (!apply) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.repl + out.slice(e.end);
  if (!usesT) {
    const imports = [...out.matchAll(/^import [^\n]*\n/gm)];
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
    out = out.slice(0, at) + `import { t } from '${rel.startsWith('.') ? rel : './' + rel}';\n` + out.slice(at);
  }
  fs.writeFileSync(file, out);
}
if (apply) fs.writeFileSync(EN, JSON.stringify(Object.fromEntries(Object.entries(en).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
const reportArg = process.argv.indexOf('--report');
const reportFile = reportArg > 0 ? path.resolve(process.argv[reportArg + 1]) : path.join(ROOT, '.i18n-report.json');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(`${apply ? 'applied' : 'dry run'}: ${stats.wrapped} text nodes + ${stats.attrs} attributes in ${stats.files} files; ${report.length} items for the hand pass -> ${path.relative(ROOT, reportFile)}`);
const kinds = {}; for (const r of report) kinds[r.kind] = (kinds[r.kind] || 0) + 1; console.log(kinds);
if (checkOnly && (stats.wrapped + stats.attrs + report.length) > 0) { console.error('i18n: plain UI strings remain (see the report).'); process.exit(1); }
