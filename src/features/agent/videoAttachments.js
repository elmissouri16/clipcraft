// Reference videos attached to a chat message. Saved chats keep the opaque ID and
// metadata only; the video stays where the user keeps it (electron/agents/chatVideos.cjs).
export const MAX_CHAT_VIDEOS = 3;
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi|mts|m2ts|ts|mpg|mpeg|wmv|flv|3gp|ogv)$/i;
export const isVideoFile = (file) => (file?.type || '').startsWith('video/') || VIDEO_FILE.test(file?.name || '');

export function normalizeChatVideos(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((video) => {
    if (!video || typeof video !== 'object' || typeof video.id !== 'string' || !/^[a-f0-9]{64}$/.test(video.id) || seen.has(video.id) || typeof video.name !== 'string') return false;
    seen.add(video.id); return true;
  }).slice(0, MAX_CHAT_VIDEOS).map((video) => ({ id: video.id, name: video.name.slice(0, 180),
    duration: Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0,
    width: Number.isFinite(video.width) ? Math.max(1, video.width) : 1, height: Number.isFinite(video.height) ? Math.max(1, video.height) : 1 }));
}

export const formatDuration = (sec) => { const s = Math.round(sec || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// The message part that tells the model which references exist and how to use them.
export function videoMessagePart(videos) {
  const list = normalizeChatVideos(videos);
  if (!list.length) return null;
  return `Reference videos attached by the user (examples of an editing style, not footage for the timeline unless the user says so):\n${
    list.map((v) => `- reference_id=${v.id} · ${v.name} · ${formatDuration(v.duration)} · ${v.width}×${v.height}`).join('\n')
  }\nTo learn how a reference is edited, call analyze_reference with its reference_id before copying its style.`;
}
