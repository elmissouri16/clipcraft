export const MAX_CHAT_IMAGES = 6;
export function normalizeChatImages(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter(image => {
    if (!image || typeof image !== 'object' || typeof image.id !== 'string' || !/^[a-f0-9]{64}$/.test(image.id) || seen.has(image.id) || typeof image.name !== 'string') return false;
    seen.add(image.id); return true;
  }).slice(0, MAX_CHAT_IMAGES).map(image => ({ id: image.id, name: image.name.slice(0, 180),
    bytes: Number.isFinite(image.bytes) ? Math.max(0, image.bytes) : 0,
    width: Number.isFinite(image.width) ? Math.max(1, image.width) : 1,
    height: Number.isFinite(image.height) ? Math.max(1, image.height) : 1 }));
}
export const imageMessageParts = images => normalizeChatImages(images).map(({ id, name }) => ({ chatImage: { id, name } }));
