import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';
import { sections } from './navigation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'dist');
// Prism aliases share a grammar. Use the same name in the header for ts and typescript.
const languageNames = new Map([
  [Prism.languages.typescript, 'TypeScript'],
  [Prism.languages.javascript, 'JavaScript'],
  [Prism.languages.json, 'JSON'],
  [Prism.languages.bash, 'Shell'],
  [Prism.languages.html, 'HTML'],
  [Prism.languages.css, 'CSS'],
]);
const markdown = new MarkdownIt({
  html: true,
  highlight(source, language) {
    const grammar = Prism.languages[language];
    return languageNames.has(grammar) ? Prism.highlight(source, grammar, language) : '';
  },
});
const escape = markdown.utils.escapeHtml;
const nav = sections.flatMap(([group, items]) => items.map(([label, page]) => ({ group, label, page })));
const home = nav[0].page;
const pending = new Set(nav.map(item => item.page));
const documents = new Map();
const htmlPath = source => source.replace(/\.md$/i, '.html');
const localUrl = (from, to) => path.relative(path.dirname(from), to).split(path.sep).map(encodeURIComponent).join('/');
const outputFor = page => path.join(out, htmlPath(page));
const pageHref = (from, target) => localUrl(outputFor(from), outputFor(target));

function linkTo(raw, page) {
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(raw)) return raw;
  const [, name, fragment] = raw.match(/^([^?#]*)(.*)$/);
  const absolute = path.resolve(root, path.dirname(page), decodeURIComponent(name));
  const rel = path.relative(root, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return raw;
  let source = absolute;
  if (fs.existsSync(source) && fs.statSync(source).isDirectory() && fs.existsSync(path.join(source, 'README.md'))) {
    source = path.join(source, 'README.md');
  }
  if (/\.md$/i.test(source) && fs.existsSync(source)) {
    const target = path.relative(root, source);
    pending.add(target);
    return pageHref(page, target) + fragment;
  }
  return localUrl(outputFor(page), source) + fragment;
}
for (const [rule, attr] of [['link_open', 'href'], ['image', 'src']]) {
  const render = markdown.renderer.rules[rule];
  markdown.renderer.rules[rule] = (tokens, i, opts, env, renderer) => {
    const token = tokens[i];
    token.attrSet(attr, linkTo(token.attrGet(attr), env.page));
    return render ? render(tokens, i, opts, env, renderer) : renderer.renderToken(tokens, i, opts);
  };
}
// Preserve the small subset of HTML used by the GitHub README and legacy anchors.
// All other authored markup is displayed as text.
const htmlAttributes = {
  a: ['id', 'name', 'href'], img: ['src', 'alt', 'width', 'height'],
  details: [], summary: [], strong: [], em: [], kbd: [], br: [], p: [], sup: [], sub: [],
};
function renderHtml(source, page) {
  const pieces = source.split(/(<!--[\s\S]*?-->|<\/?[a-z][^>]*>)/gi);
  return pieces.map(piece => {
    if (piece.startsWith('<!--')) return '';
    const tag = /^<(\/?)([a-z]+)\b([^>]*)>$/i.exec(piece);
    if (!tag || !Object.hasOwn(htmlAttributes, tag[2])) return escape(piece);
    const [, closing, name, raw] = tag;
    if (closing) return '</' + name + '>';
    const attributes = [];
    for (const match of raw.matchAll(/\s+([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attr = match[1];
      if (!htmlAttributes[name].includes(attr)) continue;
      let value = match[2] ?? match[3];
      if (attr === 'href' || attr === 'src') {
        if (!markdown.validateLink(value)) continue;
        value = linkTo(value, page);
      }
      attributes.push(` ${attr}="${escape(value)}"`);
    }
    return '<' + name + attributes.join('') + '>';
  }).join('');
}
for (const rule of ['html_inline', 'html_block']) {
  markdown.renderer.rules[rule] = (tokens, i, opts, env) => renderHtml(tokens[i].content, env.page);
}
const fence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, i, opts, env, renderer) => {
  const language = tokens[i].info.trim().split(/\s/)[0] || 'text';
  const label = languageNames.get(Prism.languages[language]) ?? (language === 'text' ? 'Plain text' : language);
  return `<div class="sample"><div class="codebar"><span>${escape(label)}</span><button type="button" data-copy>Copy</button></div>${fence(tokens, i, opts, env, renderer)}</div>`;
};
markdown.renderer.rules.table_open = (tokens, start) => {
  let columns = 0;
  let isFirstCell = false;
  let hasCodeLabel = false;
  for (let i = start + 1; tokens[i].type !== 'table_close'; i++) {
    const token = tokens[i];
    if (token.type === 'th_open') columns++;
    if (token.type === 'td_open') isFirstCell = tokens[i - 1].type === 'tr_open';
    if (isFirstCell && token.children?.[0]?.type === 'code_inline') hasCodeLabel = true;
  }
  const kind = columns === 2 && hasCodeLabel ? ' class="reference-table"' : '';
  return '<div class="table-scroll"><table' + kind + '>';
};
markdown.renderer.rules.table_close = () => '</table></div>\n';

function readPage(page) {
  const env = { page };
  const tokens = markdown.parse(fs.readFileSync(path.join(root, page), 'utf8'), env);
  const seen = new Set();
  const headings = [];
  let section;
  for (const [i, token] of tokens.entries()) {
    if (section && token.type === 'inline' && tokens[i-1]?.type !== 'heading_open') {
      section.text += ' ' + token.children.map(child => child.content).join('');
    }
    if (token.type !== 'heading_open') continue;
    const label = tokens[i+1].children.map(child => child.content).join('');
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/\s/g, '-');
    let id = base;
    for (let n = 1; seen.has(id); n++) id = base + '-' + n;
    seen.add(id);
    token.attrSet('id', id);
    const heading = { level: token.tag, label, id };
    if (token.tag === 'h2') {
      section = heading;
      section.text = '';
    }
    headings.push(heading);
  }
  const title = headings.find(h => h.level === 'h1')?.label || path.basename(page, '.md');
  const firstParagraph = tokens.findIndex(token => token.type === 'paragraph_open');
  const intro = firstParagraph >= 0 ? tokens[firstParagraph+1].content : '';
  const body = markdown.renderer.render(tokens, markdown.options, env);
  return { title, headings, intro, body };
}
for (const page of pending) documents.set(page, readPage(page));
const hLink = (href, label, more = '') => `<a href="${escape(href)}"${more}>${escape(label)}</a>`;
function sidebar(page) {
  return sections.map(([title, items]) => `<section><h2>${escape(title)}</h2>${items.map(([label, target]) =>
    hLink(pageHref(page, target), label, page === target ? ' aria-current="page"' : '')).join('')}</section>`).join('');
}
function landing(page, doc) {
  const poster = escape(linkTo('screenshot-editor.png', page));
  const movie = escape(linkTo('media/clipcraft-demo.mp4', page));
  const hero = `<div class="hero"><div><h1>${escape(doc.title)}</h1><p>${escape(doc.intro)}</p></div><figure><video controls playsinline preload="none" poster="${poster}" aria-label="Form Studies editor walkthrough"><source src="${movie}" type="video/mp4"></video><figcaption>Form Studies · editor walkthrough</figcaption></figure></div>`;
  return doc.body.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p>[\s\S]*?<\/p>/, () => hero)
    .replace('<div class="table-scroll">', '<div class="routes-table">');
}
function adjacent(page) {
  const position = nav.findIndex(item => item.page === page);
  if (position < 0) return '';
  return `<nav class="turn" aria-label="Adjacent guides">${[[nav[position-1],'Previous'],[nav[position+1],'Next']].filter(([item])=>item).map(([item, label])=>
    `<a href="${pageHref(page, item.page)}"><small>${label}</small><strong>${escape(item.label)}</strong></a>`).join('')}</nav>`;
}
function layout(page, doc) {
  const assets = name => localUrl(outputFor(page), path.join(out, name));
  const group = nav.find(item => item.page === page)?.group || 'Project reference';
  const toc = doc.headings.filter(h => h.level === 'h2').map(h => hLink('#'+h.id, h.label)).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(doc.title)} · ClipCraft Docs</title><link rel="icon" href="${linkTo(path.relative(path.dirname(page), 'public/logo.svg'), page)}"><link rel="stylesheet" href="${assets('theme.css')}"><script defer src="${assets('search-index.js')}"></script><script defer src="${assets('reader.js')}"></script></head>
<body data-index="${assets('docs/README.html')}"><a class="skip" href="#article">Skip to content</a><header><a class="brand" href="${pageHref(page, home)}"><img alt="" src="${linkTo(path.relative(path.dirname(page),'public/logo.svg'),page)}"><b>ClipCraft</b><span>Docs</span></a><button class="menu" aria-expanded="false" aria-controls="sidebar">Browse guides</button><button class="search" type="button"><span aria-hidden="true">⌕</span> Search docs <kbd>/</kbd></button></header>
<div class="shell"><nav id="sidebar" aria-label="Documentation">${sidebar(page)}</nav><main id="article" tabindex="-1"><div class="crumb">${hLink(pageHref(page, home), 'Docs')}<span>/</span>${escape(group)}</div><article>${page===home?landing(page,doc):doc.body}</article>${adjacent(page)}</main><aside>${toc?'<h2>On this page</h2>'+toc:''}</aside></div>
<dialog aria-labelledby="search-title"><div class="dialog-head"><h2 id="search-title">Search documentation</h2><button class="close" aria-label="Close search">×</button></div><input type="search" aria-label="Search guides and sections" placeholder="Search guides and sections" autocomplete="off"><div id="results" aria-live="polite"></div></dialog></body></html>`;
}
fs.mkdirSync(out, { recursive: true });
for (const file of ['theme.css','reader.js']) fs.copyFileSync(path.join(here,file),path.join(out,file));
const index = [];
for (const [page, doc] of documents) {
  const target = outputFor(page);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, layout(page, doc));
  index.push({ title:doc.title, path:pageHref(home,page), headings:doc.headings.filter(h=>h.level==='h2'), group:nav.find(item=>item.page===page)?.group || 'Project reference' });
}
fs.writeFileSync(path.join(out,'search-index.js'), 'window.docsIndex = '+JSON.stringify(index)+';\n');
console.log(`Built ${documents.size} pages. Open ${outputFor(home)}`);
