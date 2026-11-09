// The speech engine and voice used when none is named (Settings > Voice > Default voice). One rule for CraftAI
// (list_voices, add_voiceover, add_narration) and Audio > Text to speech. st: the tts:status result.
// Engines: 'gemini', 'piper', 'eleven' (CraftAI calls the last one 'elevenlabs').
export const ENGINE_NAMES = { gemini: 'Gemini', piper: 'Piper', eleven: 'ElevenLabs' };
const AUTO_ORDER = ['gemini', 'piper', 'eleven'];

// Piper voices are optional downloads: only the downloaded ones can speak.
export const piperVoicesOf = (st) => (st?.installed ? (st.voices || []).filter((v) => v.downloaded) : []);

// Whether each engine can speak now: a key, or a downloaded Piper voice.
export function usableEngines(st) {
  return { gemini: !!st?.geminiKey, piper: piperVoicesOf(st).length > 0, eleven: !!st?.elevenKey };
}

// The voice an engine starts with: the saved one when it is still valid for that engine.
function voiceFor(st, engine, saved) {
  if (engine === 'gemini') return (st?.gemini?.voices || []).some((v) => v.id === saved) ? saved : (st?.gemini?.defaultVoice || 'Kore');
  if (engine === 'piper') { const voices = piperVoicesOf(st); return voices.some((v) => v.id === saved) ? saved : voices[0]?.id || ''; }
  return saved || ''; // ElevenLabs voices belong to the account; without one CraftAI picks from list_voices
}

// -> { engine: 'gemini' | 'piper' | 'eleven' | null, voice, from: 'settings' | 'automatic', note? }
export function defaultSpeech(st) {
  const pref = st?.voiceDefault || { engine: 'auto', voice: '' };
  const usable = usableEngines(st);
  if (pref.engine !== 'auto' && usable[pref.engine]) return { engine: pref.engine, voice: voiceFor(st, pref.engine, pref.voice), from: 'settings' };
  const engine = AUTO_ORDER.find((e) => usable[e]) || null;
  const note = pref.engine !== 'auto'
    ? `The default voice in Settings (${ENGINE_NAMES[pref.engine]}) is not set up${pref.engine === 'piper' ? ' (no voice downloaded)' : ' (no key)'}, so the automatic order applies.`
    : undefined;
  return { engine, voice: engine ? voiceFor(st, engine, engine === pref.engine ? pref.voice : '') : '', from: 'automatic', ...(note ? { note } : {}) };
}
