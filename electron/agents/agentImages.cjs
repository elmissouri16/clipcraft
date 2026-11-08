// Image bytes are transport-only. Never put them in saved tool/chat JSON.
const fs = require('node:fs');
function readImages(images = []) {
  if (!Array.isArray(images) || images.length > 6) throw new Error('Use at most six inspected frames.');
  return images.map((image, index) => {
    const bytes = fs.readFileSync(image.path);
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('The inspected frame is not a readable JPEG.');
    return { data: bytes.toString('base64'), label: String(image.label || `Frame ${index + 1}`).slice(0, 600) };
  });
}
function attachImages(contents, images) {
  const data = readImages(images);
  if (!data.length) return contents;
  const extra = data.flatMap(image => [{ text: image.label }, { inlineData: { mimeType: 'image/jpeg', data: image.data } }]);
  const copy = contents.map(turn => ({ ...turn, parts: [...(turn.parts || [])] }));
  if (copy.at(-1)?.role === 'user') copy.at(-1).parts.push(...extra);
  else copy.push({ role: 'user', parts: extra });
  return copy;
}
const openAiParts = parts => parts.filter(p => p.text || p.inlineData).map(p => p.inlineData
  ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, detail: 'auto' } }
  : { type: 'text', text: p.text });
const anthropicParts = parts => parts.filter(p => p.inlineData).map(p => ({ type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } }));
module.exports = { readImages, attachImages, openAiParts, anthropicParts };
