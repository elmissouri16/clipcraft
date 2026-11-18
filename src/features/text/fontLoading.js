import { resolveStyle } from './style.js';

// Group by face, retaining every character that can be drawn (including uppercase).
export function textFontRequests(clips = []) {
  const requests = new Map();
  for (const clip of clips) {
    if (clip.disabled) continue;
    const style = resolveStyle(clip);
    if (!String(style.text || '').trim()) continue;
    const key = JSON.stringify([style.font, style.bold, style.italic]);
    if (!requests.has(key)) requests.set(key, { ...style, characters: new Set() });
    const request = requests.get(key);
    for (const char of style.uppercase ? String(style.text).toLocaleUpperCase() : String(style.text)) request.characters.add(char);
  }
  return [...requests.values()].map(({ characters, ...style }) => ({ ...style, text: [...characters].sort().join('') }));
}

export function createFontLoader({ fontSet, localFace, customFace, onChange = () => {} }) {
  const jobs = new Map(), availability = new Map(),epochs=new Map();
  const status = id => availability.get(id);
  const setStatus = (id, value) => {
    if (availability.get(id) === value) return;
    availability.set(id, value);
    onChange();
  };
  const load = (font, { text = 'Aa', bold = false, italic = false } = {}) => {
    const weight = bold ? font.bold ?? font.regular : font.regular;
    const epoch=epochs.get(font.id)||0;
    const key = JSON.stringify([font.id, epoch, weight, italic, [...new Set(text)].sort().join('')]);
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      if (['custom','pack'].includes(font.source)) await customFace(font);
      else if (font.source === 'system') {
        // check() also returns true for nonexistent families. A local face must decode.
        await localFace(font.family).load();
      } else if (![...fontSet].some(face => String(face.family).replace(/^["']|["']$/g, '') === font.family)) {
        throw Error('The bundled face is not registered.');
      }
      await fontSet.load(`${italic ? 'italic ' : ''}${weight} 32px ${JSON.stringify(font.family)}`, text);
      return true;
    })().then(() => {if((epochs.get(font.id)||0)!==epoch)return false;setStatus(font.id, true);return true; }, () => {
      jobs.delete(key);if((epochs.get(font.id)||0)===epoch)setStatus(font.id, false);return false;
    });
    jobs.set(key, job);
    // Bound retained text keys without interrupting pending loads.
    job.then(() => { if (jobs.size > 256) jobs.delete(jobs.keys().next().value); });
    return job;
  };
  return { load, status, invalidate(id) {
    epochs.set(id,(epochs.get(id)||0)+1);availability.delete(id);
    for (const key of jobs.keys()) if (JSON.parse(key)[0] === id) jobs.delete(key);
  } };
}
