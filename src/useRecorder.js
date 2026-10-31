import { useCallback, useEffect, useRef, useState } from 'react';

// Microphone voice-over. start(at) remembers where on the timeline the recording began; when it stops the
// audio is converted by the main process and onDone(mediaItem, at) is called.
export function useRecorder(onDone) {
  const [rec, setRec] = useState(null); // { t0 }
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  const mrRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null); // AnalyserNode on the same stream, for the live level meter
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!rec) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [rec]);

  const start = useCallback(async (at = 0) => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Live level meter: an analyser tapped off the same stream (recording is unaffected).
      try {
        const ctx = new AudioContext();
        const srcNode = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        srcNode.connect(an);
        ctxRef.current = ctx;
        analyserRef.current = an;
      } catch { /* no meter on this system — the recording itself still works */ }
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        analyserRef.current = null;
        const buf = await new Blob(chunks).arrayBuffer();
        const item = await window.api.saveRecording(new Uint8Array(buf));
        if (item.error) setError(item.error);
        else doneRef.current(item, at);
      };
      mr.start();
      mrRef.current = mr;
      setRec({ t0: Date.now() });
    } catch (e) {
      setError(`Microphone unavailable: ${e.message}`);
    }
  }, []);

  const stop = useCallback(() => {
    mrRef.current?.stop();
    mrRef.current = null;
    setRec(null);
  }, []);

  return { recording: !!rec, seconds: rec ? (Date.now() - rec.t0) / 1000 : 0, error, start, stop, analyserRef };
}
