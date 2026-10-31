// The preview's shared audio graph, created for the timeline level meter (item 11).
//
// The preview player sounds through plain media elements (main slots, overlay videos, audio
// clips), each with its own volume/mute — there was no single node to meter. This module adds
// ONE AudioContext with a unity master gain: every sounding element is routed through it once
// (createMediaElementSource, guarded — an element can only ever be sourced once), and a stereo
// analyser tap hangs off the master. Playback behaviour is unchanged: an element's own
// volume/mute/speed shape the signal its source node emits, and the master adds nothing.
//
// The tap therefore meters exactly what the user hears in the preview, summed — post per-clip
// gain and muting as the player applies them. It does not touch export audio in any way.
let graph = null;
const wired = new WeakSet();

export function ensureAudioGraph() {
  if (graph) return graph;
  try {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = 2048;
    right.fftSize = 2048;
    master.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    graph = { ctx, master, left, right };
  } catch {
    graph = null; // no WebAudio (or a second context refused) — the meter rests at floor
  }
  return graph;
}

// Route one media element through the master. Safe to call repeatedly and on any element:
// already-wired elements are skipped, and an element that refuses (already sourced elsewhere)
// is left on its native output rather than breaking playback.
export function wireElement(el) {
  if (!el || wired.has(el)) return;
  const g = ensureAudioGraph();
  if (!g) return;
  try {
    const src = g.ctx.createMediaElementSource(el);
    src.connect(g.master);
    wired.add(el);
  } catch { /* leave the element native */ }
}

export function resumeAudioGraph() {
  const g = ensureAudioGraph();
  if (g && g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
}

// The stereo analysers on the master, or null before the graph exists. The meter reads peaks
// from these; buffers are the caller's (preallocated) — this never allocates per frame.
export function meterAnalysers() {
  return graph ? { left: graph.left, right: graph.right } : null;
}
