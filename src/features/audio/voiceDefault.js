// The speech engine and voice used when none is named (Settings > Voice > Default voice). One rule for CraftAI
// (list_voices, add_voiceover, add_narration) and Audio > Text to speech. st: the tts:status result.
// Engines: 'gemini', 'voicestudio', 'eleven' (CraftAI calls the last one 'elevenlabs').
export const ENGINE_NAMES = { gemini: 'Gemini', voicestudio: 'VoiceStudio', eleven: 'ElevenLabs' };
const AUTO_ORDER = ['gemini', 'voicestudio', 'eleven'];

// VoiceStudio is a separate app: its voices are usable while the connector is on and the app answers.
export const studioVoicesOf = (st) => (st?.studio?.enabled && st.studio.running ? st.studio.voices || [] : []);

// Why VoiceStudio cannot speak now, for messages; '' when it can.
export function studioProblem(st) {
  if (!st?.studio?.enabled) return 'the VoiceStudio connector is off';
  if (!st.studio.running) return 'VoiceStudio is not running';
  if (!(st.studio.voices || []).length) return 'VoiceStudio lists no voice';
  return '';
}

// Whether each engine can speak now: a key, or a VoiceStudio that answers with voices.
export function usableEngines(st) {
  return { gemini: !!st?.geminiKey, voicestudio: studioVoicesOf(st).length > 0, eleven: !!st?.elevenKey };
}

// The voice an engine starts with: the saved one when it is still valid for that engine.
function voiceFor(st, engine, saved) {
  if (engine === 'gemini') return (st?.gemini?.voices || []).some((v) => v.id === saved) ? saved : (st?.gemini?.defaultVoice || 'Kore');
  if (engine === 'voicestudio') { const voices = studioVoicesOf(st); return voices.some((v) => v.id === saved) ? saved : voices[0]?.id || ''; }
  return saved || ''; // ElevenLabs voices belong to the account; without one CraftAI picks from list_voices
}

// -> { engine: 'gemini' | 'voicestudio' | 'eleven' | null, voice, from: 'settings' | 'automatic', note? }
export function defaultSpeech(st) {
  const pref = st?.voiceDefault || { engine: 'auto', voice: '' };
  const usable = usableEngines(st);
  if (pref.engine !== 'auto' && usable[pref.engine]) return { engine: pref.engine, voice: voiceFor(st, pref.engine, pref.voice), from: 'settings' };
  const engine = AUTO_ORDER.find((e) => usable[e]) || null;
  const note = pref.engine !== 'auto' && ENGINE_NAMES[pref.engine]
    ? `The default voice in Settings (${ENGINE_NAMES[pref.engine]}) is not set up (${pref.engine === 'voicestudio' ? studioProblem(st) : 'no key'}), so the automatic order applies.`
    : undefined;
  return { engine, voice: engine ? voiceFor(st, engine, engine === pref.engine ? pref.voice : '') : '', from: 'automatic', ...(note ? { note } : {}) };
}
