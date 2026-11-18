// Shared selection rules for native speech controls and CraftAI. Installed engines
// are ordinary service integrations; the SDK has no speech-provider manifest type.
export const ENGINE_NAMES = { gemini: 'Gemini', eleven: 'ElevenLabs' };
export const extensionEnginesOf = (st) => Array.isArray(st?.extensions) ? st.extensions : [];
export const extensionEngine = (st, id) => extensionEnginesOf(st).find((entry) => entry.id === id);
export const voiceEngineName = (st, id) => ENGINE_NAMES[id] || extensionEngine(st, id)?.name || (st?.voiceDefault?.engine === id && st.voiceDefault.label) || id;
export const engineVoices = (st, id) => id === 'gemini' ? st?.gemini?.voices || [] : extensionEngine(st, id)?.voices || [];
export function voiceEngines(st) {
  const entries = [{ id: 'gemini', name: 'Gemini', order: 10 }, ...extensionEnginesOf(st), { id: 'eleven', name: 'ElevenLabs', order: 30 }];
  const pref = st?.voiceDefault;
  if (pref?.engine?.startsWith('extension:') && !entries.some((e) => e.id === pref.engine)) entries.push({ id: pref.engine, name: pref.label || pref.engine, order: 1000 });
  return entries.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
}
export function resolveSpeechEngine(st, id) {
  if (id === 'elevenlabs') return 'eleven';
  return extensionEnginesOf(st).find((e) => e.id === id || e.aliases?.includes(id))?.id || id;
}
export function usableEngines(st) {
  return { gemini: !!st?.geminiKey, eleven: !!st?.elevenKey, ...Object.fromEntries(extensionEnginesOf(st).map((e) => [e.id, e.available === true])) };
}
export function engineProblem(st, id) {
  if (usableEngines(st)[id]) return '';
  const entry = extensionEngine(st, id);
  if (id?.startsWith('extension:')) return entry?.error || `${voiceEngineName(st, id)} is unavailable. Install, trust and enable its extension in Settings > Plugins, then check its settings in Voice.`;
  return ENGINE_NAMES[id] ? `${voiceEngineName(st, id)} needs an API key in Settings.` : `${id} is unavailable. Choose an installed engine from list_voices.`;
}
function voiceFor(st, engine, saved) {
  if (saved) return saved;
  return engine === 'gemini' ? st?.gemini?.defaultVoice || 'Kore' : engineVoices(st, engine)[0]?.id || '';
}
export function defaultSpeech(st) {
  const pref = st?.voiceDefault || { engine: 'auto', voice: '' }, usable = usableEngines(st);
  if (pref.engine !== 'auto') {
    const missingVoice = pref.voice && pref.engine !== 'eleven' && !engineVoices(st, pref.engine).some((v) => v.id === pref.voice);
    const note = engineProblem(st, pref.engine) || (missingVoice ? `The saved voice ${pref.voice} is unavailable in ${voiceEngineName(st, pref.engine)}. Choose a voice in Settings > Voice.` : '');
    return { engine: pref.engine, voice: voiceFor(st, pref.engine, pref.voice), from: 'settings', ...(note ? { unavailable: true, note } : {}) };
  }
  const engine = voiceEngines(st).find((entry) => usable[entry.id])?.id || null;
  return { engine, voice: engine ? voiceFor(st, engine, '') : '', from: 'automatic' };
}
