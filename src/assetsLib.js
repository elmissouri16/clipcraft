// Pure helpers for the folder-backed asset pack (electron/assets.cjs serves the manifest)
// and for the Media panel's tree (Workstream C). No React, no window — the test suite
// (scripts/test-assets.cjs) exercises this file directly.

// Assets-tab groups, in order. Music is deliberately NOT here: the pack's music lives in
// the Audio tab's Music place. Generated is not a manifest group either — it is the Forge
// shelf, read through window.api.forgeList in the panel.
export const ASSET_GROUPS = ['Sound FX', 'Transitions', 'Overlays'];

// Where a pack item goes when clicked in a library panel, as the `where` argument of
// App's addFile(path, where): audio files land on the audio lane at the playhead (addFile
// routes by media type), video files become overlay clips at the playhead. Must agree with
// electron/assets.cjs laneFor(); test-assets.cjs pins the agreement.
export const assetAddWhere = (item) => (item && item.kind === 'video' ? 'overlay' : 'main');

// ---- Media tree classification ----
// Kinds come from the media registry itself (m.type). Speech and Processed are subsets
// identified by HOW the item entered the registry:
// - Speech: text-to-speech output. TTS results carry a credit whose license is 'piper' or
//   'elevenlabs' (electron tts:speak), and App tags new ones origin: 'tts' as well. Plain
//   voice-over RECORDINGS are the user's own microphone files, not generated speech, so
//   they stay plain Audio.
// - Processed: render outputs registered as media — Detach audio, Reverse and Stabilize.
//   App tags new renders origin: 'detach' | 'reverse' | 'stabilize'; renders made before
//   the tag existed are recognised by the render cache's file naming (<hash>-detach.wav,
//   <hash>-rev.mp4, <hash>-stab.mp4 — electron/detach.cjs, reverse.cjs, stabilize.cjs).
//   Voice-enhance renders are NOT media (they hang off the clip as clip.enhance), so they
//   truthfully never appear here.
export const PROCESSED_ORIGINS = ['detach', 'reverse', 'stabilize'];
const RENDER_NAME = /-(detach|rev|stab)\.[a-z0-9]+$/i;

export const isSpeechMedia = (m) => !!m && m.type === 'audio'
  && (m.origin === 'tts' || m.credit?.license === 'piper' || m.credit?.license === 'elevenlabs');

export const isProcessedMedia = (m) => {
  if (!m) return false;
  if (PROCESSED_ORIGINS.includes(m.origin)) return true;
  const base = String(m.path || '').split(/[\\/]/).pop() || '';
  return RENDER_NAME.test(m.name || '') || RENDER_NAME.test(base);
};

// Tree nodes: 'all' | 'video' | 'audio' | 'image' | 'speech' | 'processed'.
export function mediaTreeCounts(media) {
  const c = { all: media.length, video: 0, audio: 0, image: 0, speech: 0, processed: 0 };
  for (const m of media) {
    if (m.type === 'video') c.video += 1;
    else if (m.type === 'audio') c.audio += 1;
    else if (m.type === 'image') c.image += 1;
    if (isSpeechMedia(m)) c.speech += 1;
    if (isProcessedMedia(m)) c.processed += 1;
  }
  return c;
}

export function mediaTreeFilter(media, sel) {
  switch (sel) {
    case 'video': return media.filter((m) => m.type === 'video');
    case 'audio': return media.filter((m) => m.type === 'audio');
    case 'image': return media.filter((m) => m.type === 'image');
    case 'speech': return media.filter((m) => isSpeechMedia(m));
    case 'processed': return media.filter((m) => isProcessedMedia(m));
    default: return media;
  }
}
