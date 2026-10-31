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
//
// One staging correction lives here: clip volume runs 0..2 in the project, but a media
// element's own volume clamps at 1 — so a clip set louder than unity used to sound (and
// meter) at unity in the preview while the export applied the full gain (the meter hid up
// to +6 dB of export level). Each wired element therefore gets a gain node between its
// source and the master, and applyElementVolume() splits the requested gain across the
// element (<= 1) and the node (the > 1 part), so preview and meter carry the true staging.
let graph = null;
const wired = new WeakSet();
const gains = new WeakMap();

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
    const gain = g.ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(g.master);
    gains.set(el, gain);
    wired.add(el);
  } catch { /* leave the element native */ }
}

// Apply a clip's effective gain (0..2, fades and muting already folded in by the player) to
// one element. Wired elements: the element's own volume takes the <= 1 part (it shapes the
// source node's signal) and the gain node takes any part above unity, so the product the
// analysers (and the speakers) see is the requested gain at every setting. Unwired elements
// keep the native clamped behaviour.
export function applyElementVolume(el, volume) {
  if (!el) return;
  const g = Math.max(0, volume || 0);
  const node = gains.get(el);
  el.volume = Math.min(1, g);
  if (node) node.gain.value = g > 1 ? g : 1;
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
