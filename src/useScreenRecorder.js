import { useCallback, useEffect, useRef, useState } from 'react';

// Screen recording: the chosen screen or window (with the PC's sound and / or the microphone). The camera is
// recorded as its own file, like CapCut: the bubble on the screen is only a preview (hidden from the capture),
// and its place and shape tell where the camera clip goes on the overlay track. The WebM data is streamed to
// the main process, which saves MP4s in Videos\ClipCraft.
// onDone({ screen, camera, camShape, camStyle, camGeom }, at) gets the media items; `at` is the playhead.
// camStyle: { stroke, strokeColor, glow, glowColor } for the camera's outline and glow.
const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const mimeType = () => MIME.find((m) => window.MediaRecorder?.isTypeSupported(m)) || '';

// One MediaRecorder writing to one file in the main process. Chunks are sent in order.
function fileRecorder(stream, kind, bitrate) {
  const mr = new MediaRecorder(stream, { mimeType: mimeType(), videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 });
  let id = null;
  let chain = window.api.screenBegin(kind).then((v) => { id = v; });
  mr.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    chain = chain.then(async () => window.api.screenChunk(id, new Uint8Array(await e.data.arrayBuffer())));
  };
  const stopped = new Promise((resolve) => { mr.onstop = resolve; });
  return {
    mr,
    start: () => mr.start(1000),
    async finish() {
      if (mr.state !== 'inactive') mr.stop();
      await stopped;
      await chain;
      return window.api.screenFinish(id);
    },
    async discard() {
      if (mr.state !== 'inactive') mr.stop();
      await stopped;
      await chain;
      await window.api.screenDiscard(id);
    },
  };
}

export function useScreenRecorder(onDone) {
  // phase: 'idle' | 'countdown' | 'recording' | 'saving'
  const [state, setState] = useState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: '' });
  const live = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const cleanup = () => {
    const l = live.current;
    if (!l) return;
    clearInterval(l.timer);
    l.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    l.audioCtx?.close().catch(() => {});
    l.offs.forEach((off) => off());
    live.current = null;
  };

  const elapsed = (l) => (l.paused ? l.acc : l.acc + (Date.now() - l.since) / 1000);

  const stop = useCallback(async (discard = false) => {
    const l = live.current;
    if (!l || l.stopping) return;
    l.stopping = true;
    clearInterval(l.timer);
    l.camGeom = await window.api.screenCamGeom(l.sourceId).catch(() => null);
    window.api.screenBar(false);
    window.api.screenCamera(false);
    window.api.screenWindow('restore');
    setState((s) => ({ ...s, phase: 'saving' }));
    try {
      if (discard || !l.recorders.length) {
        await Promise.all(l.recorders.map((r) => r.discard()));
        cleanup();
        return setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: '' });
      }
      const [screen, camera] = await Promise.all(l.recorders.map((r) => r.finish()));
      cleanup();
      const bad = [screen, camera].find((x) => x && x.error);
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: bad ? bad.error : '' });
      if (screen && !screen.error) doneRef.current({ screen, camera: camera && !camera.error ? camera : null, camShape: l.camShape, camStyle: l.camStyle, camGeom: l.camGeom }, l.at);
    } catch (e) {
      cleanup();
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: e.message });
    }
  }, []);

  const togglePause = useCallback(() => {
    const l = live.current;
    if (!l || l.stopping || !l.recorders.length) return;
    if (l.paused) {
      l.recorders.forEach((r) => r.mr.resume());
      l.since = Date.now();
      l.paused = false;
    } else {
      l.recorders.forEach((r) => r.mr.pause());
      l.acc = elapsed(l);
      l.paused = true;
    }
    const s = { seconds: elapsed(l), paused: l.paused };
    setState((st) => ({ ...st, ...s }));
    window.api.screenBarState(s);
  }, []);

  // opts: { sourceId, systemAudio, mic, micId, camera, cameraId, camShape, camStroke, camStrokeColor, camGlow, camGlowColor, hideApp, at }
  const start = useCallback(async (opts) => {
    if (live.current) return;
    setState({ phase: 'countdown', count: 3, seconds: 0, paused: false, error: '' });
    const l = { streams: [], recorders: [], offs: [], at: opts.at || 0, acc: 0, paused: false, camShape: opts.camShape, sourceId: opts.sourceId,
      camStyle: { stroke: opts.camStroke || 0, strokeColor: opts.camStrokeColor || '#ffffff', glow: opts.camGlow || 0, glowColor: opts.camGlowColor || '#825cfb' } };
    live.current = l;
    try {
      await window.api.screenChoose(opts.sourceId, opts.systemAudio);
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: !!opts.systemAudio });
      l.streams.push(display);
      const mic = opts.mic ? await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: opts.micId ? { exact: opts.micId } : undefined, echoCancellation: true, noiseSuppression: true },
      }) : null;
      if (mic) l.streams.push(mic);
      const cam = opts.camera ? await navigator.mediaDevices.getUserMedia({
        video: { deviceId: opts.cameraId ? { exact: opts.cameraId } : undefined, width: 1280, height: 720, frameRate: 30 }, audio: false,
      }) : null;
      if (cam) l.streams.push(cam);

      // One sound track: the PC's sound and the microphone mixed together.
      const sounds = [display, mic].filter((s) => s && s.getAudioTracks().length);
      let audioTracks = [];
      if (sounds.length === 1) audioTracks = sounds[0].getAudioTracks();
      else if (sounds.length > 1) {
        l.audioCtx = new AudioContext();
        const dest = l.audioCtx.createMediaStreamDestination();
        sounds.forEach((s) => l.audioCtx.createMediaStreamSource(s).connect(dest));
        audioTracks = dest.stream.getAudioTracks();
      }
      const screenStream = new MediaStream([...display.getVideoTracks(), ...audioTracks]);
      // Sharing ended from outside (window closed, screen unplugged): save what was recorded.
      display.getVideoTracks()[0].addEventListener('ended', () => stop());

      for (let c = 3; c > 0; c--) {
        if (live.current !== l) return;
        setState((s) => ({ ...s, count: c }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (live.current !== l) return;
      if (opts.hideApp) {
        await window.api.screenWindow('minimize');
        await new Promise((r) => setTimeout(r, 400)); // let the minimize animation finish before recording
      }
      await window.api.screenBar(true, opts.sourceId);
      l.offs.push(window.api.onScreenStop(() => stop()), window.api.onScreenPause(() => togglePause()));
      l.recorders.push(fileRecorder(screenStream, 'screen', 8000000));
      if (cam) l.recorders.push(fileRecorder(cam, 'camera', 4000000));
      l.recorders.forEach((r) => r.start());
      l.since = Date.now();
      setState({ phase: 'recording', count: 0, seconds: 0, paused: false, error: '' });
      l.timer = setInterval(() => {
        const s = { seconds: elapsed(l), paused: l.paused };
        setState((st) => ({ ...st, ...s }));
        window.api.screenBarState(s);
      }, 250);
    } catch (e) {
      cleanup();
      window.api.screenBar(false);
      window.api.screenCamera(false);
      window.api.screenWindow('restore');
      const msg = e.name === 'NotAllowedError' ? 'Recording was not allowed (camera or microphone blocked, or the source is gone).' : e.message;
      setState({ phase: 'idle', count: 0, seconds: 0, paused: false, error: msg });
    }
  }, [stop, togglePause]);

  useEffect(() => () => { if (live.current) stop(); }, [stop]);

  return { ...state, active: state.phase !== 'idle', start, stop, togglePause, cancel: () => stop(true) };
}
