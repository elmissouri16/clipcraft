// Bundled templates: template packages that ship with the app (created by
// scripts/make-bundled-templates.cjs with the same pack() the store uses) in
// <app root>/bundled-templates/<slug>/. They list and open with no network at all.
// Each package's template.json carries an extra `info` block (title, category,
// description, tags) written by the generator; pack() itself stays untouched.
const fs = require('fs');
const path = require('path');

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

const rootOf = (appRoot) => path.join(appRoot, 'bundled-templates');

function readDoc(dir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
    // Only the current format id is accepted on read.
    if (doc.format !== 'clipcraft-template' || doc.version !== 1 || !doc.project) return null;
    return doc;
  } catch {
    return null;
  }
}

function describe(slug, dir, doc) {
  const info = doc.info || {};
  const meta = doc.meta || {};
  const thumbPath = path.join(dir, 'thumb.jpg');
  const previewPath = path.join(dir, 'preview.mp4');
  return {
    id: `bundled:${slug}`,
    slug,
    bundled: true,
    title: info.title || doc.project.name || slug,
    category: info.category || 'Bundled',
    description: info.description || '',
    tags: info.tags || [],
    ratio: meta.ratio || doc.project.ratio || '16:9',
    clips: meta.slots || 0,
    // The slot contract (the packer's Details line): computed counts stored in meta by the packer.
    texts: meta.texts ?? (doc.project.textClips || []).length,
    media: meta.media ?? meta.slots ?? 0,
    duration: meta.duration || 0,
    thumb: fs.existsSync(thumbPath) ? thumbPath : null,
    preview: fs.existsSync(previewPath) ? previewPath : null,
  };
}

function list(appRoot) {
  const root = rootOf(appRoot);
  if (!fs.existsSync(root)) return { templates: [], categories: [] };
  const templates = [];
  for (const slug of fs.readdirSync(root).sort()) {
    if (!SLUG.test(slug)) continue;
    const dir = path.join(root, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const doc = readDoc(dir);
    if (doc) templates.push(describe(slug, dir, doc));
  }
  const categories = [...new Set(templates.map((t) => t.category))];
  return { templates, categories };
}

// Same return shape as templates.download(): the descriptor + the project as JSON text
// with media pointing at the package's own files.
function use(appRoot, slug) {
  if (!SLUG.test(String(slug))) throw new Error('Unknown template.');
  const dir = path.join(rootOf(appRoot), slug);
  const doc = readDoc(dir);
  if (!doc) throw new Error('This template is damaged.');
  const media = (doc.project.media || []).map((m) => {
    const name = path.basename(String(m.path));
    if (!fs.existsSync(path.join(dir, name))) throw new Error('This template is incomplete.');
    return { ...m, path: path.join(dir, name) };
  });
  const t = describe(slug, dir, doc);
  return { template: t, json: JSON.stringify({ ...doc.project, media, template: { id: t.id, title: t.title } }) };
}

module.exports = { list, use, rootOf };
